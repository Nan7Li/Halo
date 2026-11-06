package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

// These tests pin the overlapping Halo 1.1.14 and VoCat v0.3.15 schema
// numbers. user_version 24 and 25 were both used, for different changes.
// Opening either database, or their common user_version 22 ancestor, must
// reach schemaVersion without dropping Halo phone/WireGuard rows or VoCat
// SMS identity, MBN, and cellular_attach tasks.

func TestHaloSchema24GainsUpstreamColumns(t *testing.T) {
	ctx := context.Background()
	raw, path := openLineageDB(t)
	applySchemaVersions(t, raw, 1, 24)
	mustSeedDevice(t, raw, "modem")
	if _, err := raw.ExecContext(ctx, `
		INSERT INTO wireguard_tunnels (id, name, interface, config_text, autostart, created_at, updated_at)
		VALUES ('wg1', 'home', 'wg-halo', 'config', 1, 10, 10)
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `
		INSERT INTO call_records (
			device_id, call_id, number, direction, state, started_at, created_at, updated_at
		) VALUES ('modem', 'call-1', '+15551212', 'incoming', 'missed', 10, 10, 10)
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `
		INSERT INTO sms_messages (
			device_id, peer, direction, body, message_time, created_at, updated_at
		) VALUES ('modem', '+10086', 'inbound', 'keep-me', 10, 10, 10)
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `
		INSERT INTO card_policies (iccid, source, created_at, updated_at)
		VALUES ('8901410', 'manual', 1, 1)
	`); err != nil {
		t.Fatal(err)
	}
	mustSeedLegacyTask(t, raw, "Halo SMS", "sms", "{\"phone\":\"10086\",\"message\":\"test\"}")
	if _, err := raw.ExecContext(ctx, `PRAGMA user_version = 24`); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	database := openTestStore(t, path)
	assertSchemaVersion(t, database)
	assertTable(t, database, "wireguard_tunnels")
	var (
		tunnelName string
		callNumber string
		body       string
		iccid      string
		localPhone string
		mbn        string
	)
	if err := database.db.QueryRowContext(ctx, `SELECT name FROM wireguard_tunnels WHERE id = 'wg1'`).Scan(&tunnelName); err != nil || tunnelName != "home" {
		t.Fatalf("wireguard tunnel = %q, %v", tunnelName, err)
	}
	if err := database.db.QueryRowContext(ctx, `SELECT number FROM call_records WHERE call_id = 'call-1'`).Scan(&callNumber); err != nil || callNumber != "+15551212" {
		t.Fatalf("call record = %q, %v", callNumber, err)
	}
	if err := database.db.QueryRowContext(ctx, `SELECT body, iccid, local_phone FROM sms_messages`).Scan(&body, &iccid, &localPhone); err != nil || body != "keep-me" || iccid != "" || localPhone != "" {
		t.Fatalf("sms = %q iccid=%q phone=%q err=%v", body, iccid, localPhone, err)
	}
	if err := database.db.QueryRowContext(ctx, `SELECT mbn_profile FROM card_policies WHERE iccid = '8901410'`).Scan(&mbn); err != nil || mbn != "" {
		t.Fatalf("mbn = %q, %v", mbn, err)
	}
	saved, err := database.SaveAutomaticTask(ctx, AutomaticTask{
		Name: "Attach", Enabled: true, DeviceID: "modem", ProfileICCID: "8901410",
		TaskType: "cellular_attach", Environment: "cellular", IntervalDays: 1,
		StartDate: "2026-10-02", RunTime: "13:00", Timezone: "UTC",
		Payload: []byte(`{}`), NextRunAt: time.Now().Add(time.Hour),
	})
	if err != nil || saved.TaskType != "cellular_attach" {
		t.Fatalf("cellular_attach = %+v, %v", saved, err)
	}
	tasks, err := database.ListAutomaticTasks(ctx)
	if err != nil || len(tasks) != 2 {
		t.Fatalf("tasks = %+v, %v", tasks, err)
	}
}

func TestUpstreamSchema25GainsHaloTables(t *testing.T) {
	ctx := context.Background()
	raw, path := openLineageDB(t)
	// VoCat v0.3.15 is migrations 1–19 plus its own 20–25. Those last steps
	// are this tree's 22–27. Halo's 20 and 21 (WireGuard, calls, ePDG) are
	// absent, and user_version is already 25.
	applySchemaVersions(t, raw, 1, 19)
	applySchemaVersions(t, raw, 22, 27)
	mustSeedDevice(t, raw, "modem")
	if _, err := raw.ExecContext(ctx, `
		INSERT INTO sms_messages (
			device_id, peer, direction, body, message_time, iccid, local_phone, created_at, updated_at
		) VALUES ('modem', '+10086', 'inbound', 'upstream', 10, '8901410', '+1555', 10, 10)
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `
		INSERT INTO card_policies (iccid, source, mbn_profile, created_at, updated_at)
		VALUES ('8901410', 'manual', 'ROW_Generic_3GPP', 1, 1)
	`); err != nil {
		t.Fatal(err)
	}
	mustSeedLegacyTask(t, raw, "Attach", "cellular_attach", "{}")
	var tunnels int
	if err := raw.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'wireguard_tunnels'`).Scan(&tunnels); err != nil || tunnels != 0 {
		t.Fatalf("upstream database already has wireguard_tunnels: count=%d err=%v", tunnels, err)
	}
	if _, err := raw.ExecContext(ctx, `PRAGMA user_version = 25`); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	database, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	assertSchemaVersion(t, database)
	for _, table := range []string{"wireguard_tunnels", "call_records", "epdg_probe_status"} {
		assertTable(t, database, table)
	}
	var body, iccid, localPhone, mbn, taskType string
	if err := database.db.QueryRowContext(ctx, `SELECT body, iccid, local_phone FROM sms_messages`).Scan(&body, &iccid, &localPhone); err != nil || body != "upstream" || iccid != "8901410" || localPhone != "+1555" {
		t.Fatalf("sms = %q iccid=%q phone=%q err=%v", body, iccid, localPhone, err)
	}
	if err := database.db.QueryRowContext(ctx, `SELECT mbn_profile FROM card_policies WHERE iccid = '8901410'`).Scan(&mbn); err != nil || mbn != "ROW_Generic_3GPP" {
		t.Fatalf("mbn = %q, %v", mbn, err)
	}
	if err := database.db.QueryRowContext(ctx, `SELECT task_type FROM automatic_tasks WHERE name = 'Attach'`).Scan(&taskType); err != nil || taskType != "cellular_attach" {
		t.Fatalf("task = %q, %v", taskType, err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	reopened := openTestStore(t, path)
	assertSchemaVersion(t, reopened)
	if err := reopened.db.QueryRowContext(ctx, `SELECT task_type FROM automatic_tasks WHERE name = 'Attach'`).Scan(&taskType); err != nil || taskType != "cellular_attach" {
		t.Fatalf("task after second open = %q, %v", taskType, err)
	}
}

func TestSharedSchema22AndPreHalo20BothConverge(t *testing.T) {
	for _, version := range []int{20, 22} {
		t.Run("user_version_"+strconv.Itoa(version), func(t *testing.T) {
			raw, path := openLineageDB(t)
			applySchemaVersions(t, raw, 1, 19)
			// Original VoCat steps: 20 cellular IMS columns, 21 clear managed,
			// 22 delete virtual PCD readers. Only the steps at or below the
			// stamped version are already applied.
			switch version {
			case 20:
				applySchemaVersions(t, raw, 22, 22)
			case 22:
				applySchemaVersions(t, raw, 22, 24)
			}
			if _, err := raw.ExecContext(context.Background(), `PRAGMA user_version = `+strconv.Itoa(version)); err != nil {
				t.Fatal(err)
			}
			if err := raw.Close(); err != nil {
				t.Fatal(err)
			}
			database := openTestStore(t, path)
			assertSchemaVersion(t, database)
			for _, table := range []string{"wireguard_tunnels", "call_records", "epdg_probe_status"} {
				assertTable(t, database, table)
			}
			for _, column := range []struct{ table, name string }{
				{"sms_messages", "iccid"},
				{"sms_messages", "local_phone"},
				{"card_policies", "mbn_profile"},
				{"card_policies", "cellular_ims_enabled"},
			} {
				if !columnExists(t, database.db, column.table, column.name) {
					t.Fatalf("%s.%s missing after upgrade from %d", column.table, column.name, version)
				}
			}
		})
	}
}

func openLineageDB(t *testing.T) (*sql.DB, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "lineage.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.ExecContext(context.Background(), `PRAGMA foreign_keys = ON`); err != nil {
		t.Fatal(err)
	}
	return db, path
}

func applySchemaVersions(t *testing.T, db *sql.DB, from, to int) {
	t.Helper()
	ctx := context.Background()
	for version := from; version <= to; version++ {
		for _, statement := range migrationStatements(version) {
			if _, err := db.ExecContext(ctx, statement); err != nil {
				t.Fatalf("schema %d: %v\n%s", version, err, statement)
			}
		}
	}
}

func mustSeedDevice(t *testing.T, db *sql.DB, id string) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(), `
		INSERT INTO devices (id, name, created_at, updated_at) VALUES (?, ?, 1, 1)
	`, id, id); err != nil {
		t.Fatal(err)
	}
}

func assertSchemaVersion(t *testing.T, database *Store) {
	t.Helper()
	var version int
	if err := database.db.QueryRowContext(context.Background(), `PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != schemaVersion {
		t.Fatalf("schema version = %d, want %d", version, schemaVersion)
	}
}

func assertTable(t *testing.T, database *Store, name string) {
	t.Helper()
	var found string
	err := database.db.QueryRowContext(context.Background(), `
		SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?
	`, name).Scan(&found)
	if err != nil || found != name {
		t.Fatalf("table %q missing: %v", name, err)
	}
}

func columnExists(t *testing.T, db *sql.DB, table, column string) bool {
	t.Helper()
	rows, err := db.QueryContext(context.Background(), `PRAGMA table_info(`+table+`)`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			cid        int
			name       string
			kind       string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &name, &kind, &notNull, &defaultVal, &pk); err != nil {
			t.Fatal(err)
		}
		if name == column {
			return true
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return false
}

// mustSeedLegacyTask inserts a task with only the columns that existed before
// Halo migration 29 (VoCat 26) added revert_profile.
func mustSeedLegacyTask(t *testing.T, db *sql.DB, name, taskType, payload string) {
	t.Helper()
	next := time.Now().Add(time.Hour).Unix()
	if _, err := db.ExecContext(context.Background(), `
		INSERT INTO automatic_tasks (
			name, enabled, device_id, profile_iccid, task_type, environment,
			interval_days, start_date, run_time, timezone, payload_json,
			next_run_at, created_at, updated_at
		) VALUES (?, 1, 'modem', '8901410', ?, 'cellular', 1, '2026-10-02', '12:00', 'UTC', ?, ?, 1, 1)
	`, name, taskType, payload, next); err != nil {
		t.Fatalf("seed legacy automatic task: %v", err)
	}
}

// A Halo 1.1.14 database (user_version 28) gains the VoCat v0.3.16-v0.3.42
// schema as Halo 29-34 without losing rows.
func TestHaloSchema28GainsVoCat042Schema(t *testing.T) {
	ctx := context.Background()
	raw, path := openLineageDB(t)
	applySchemaVersions(t, raw, 1, 28)
	mustSeedDevice(t, raw, "modem")
	if _, err := raw.ExecContext(ctx, `
		INSERT INTO wireguard_tunnels (id, name, interface, config_text, autostart, created_at, updated_at)
		VALUES ('wg1', 'home', 'wg-halo', 'config', 1, 10, 10)
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `
		INSERT INTO card_policies (iccid, source, created_at, updated_at) VALUES ('8901410', 'manual', 1, 1)
	`); err != nil {
		t.Fatal(err)
	}
	mustSeedLegacyTask(t, raw, "Halo SMS", "sms", `{}`)
	if _, err := raw.ExecContext(ctx, `PRAGMA user_version = 28`); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	database := openTestStore(t, path)
	assertSchemaVersion(t, database)
	for _, table := range []string{"wireguard_tunnels", "call_records", "epdg_probe_status", "sms_raw_records", "api_tokens", "sso_bindings", "sso_flows"} {
		assertTable(t, database, table)
	}
	var revert int
	if err := database.db.QueryRowContext(ctx, `SELECT revert_profile FROM automatic_tasks WHERE name = 'Halo SMS'`).Scan(&revert); err != nil || revert != 1 {
		t.Fatalf("revert_profile = %d, %v", revert, err)
	}
	var secure int
	if err := database.db.QueryRowContext(ctx, `SELECT count(*) FROM pragma_table_info('sessions') WHERE name IN ('login_method', 'sso_binding_id', 'secure_cookies')`).Scan(&secure); err != nil || secure != 3 {
		t.Fatalf("session columns = %d, %v", secure, err)
	}
	var tunnel string
	if err := database.db.QueryRowContext(ctx, `SELECT name FROM wireguard_tunnels WHERE id = 'wg1'`).Scan(&tunnel); err != nil || tunnel != "home" {
		t.Fatalf("wireguard tunnel = %q, %v", tunnel, err)
	}
}

// A VoCat v0.3.42 database is at user_version 30 after VoCat migrations
// 26-30 (Halo 29-33), and never ran Halo 20/21/28. Halo 31-34 must tolerate
// the VoCat columns and restore the Halo-only tables.
func TestVoCat042Schema30GainsHaloTables(t *testing.T) {
	ctx := context.Background()
	raw, path := openLineageDB(t)
	applySchemaVersions(t, raw, 1, 19)
	applySchemaVersions(t, raw, 22, 27)
	applySchemaVersions(t, raw, 29, 33)
	mustSeedDevice(t, raw, "modem")
	if _, err := raw.ExecContext(ctx, `INSERT INTO api_tokens (name, token_hash, created_at) VALUES ('agent', X'4321', 1)`); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `PRAGMA user_version = 30`); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	database := openTestStore(t, path)
	assertSchemaVersion(t, database)
	for _, table := range []string{"wireguard_tunnels", "call_records", "epdg_probe_status", "sso_bindings"} {
		assertTable(t, database, table)
	}
	var name string
	if err := database.db.QueryRowContext(ctx, `SELECT name FROM api_tokens`).Scan(&name); err != nil || name != "agent" {
		t.Fatalf("api token = %q, %v", name, err)
	}
}
