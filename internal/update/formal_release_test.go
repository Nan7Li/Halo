package update

import (
	"context"
	"testing"
)

// A formal fusion release (halo-X.Y.Z-cellbridge) is on the cellbridge
// channel and is offered to NAS installs running an older preview.
func TestFormalCellbridgeReleaseIsOffered(t *testing.T) {
	version, ok := cellbridgeReleaseVersion("halo-1.2.0-cellbridge")
	if !ok || version != "1.2.0-cellbridge" {
		t.Fatalf("version = %q ok=%v", version, ok)
	}
	newer, err := IsNewerVersion("1.1.15-cellbridge-preview.20261109165738", version)
	if err != nil || !newer {
		t.Fatalf("formal release not newer than old preview: %v %v", newer, err)
	}
	best, latest, err := newestCellbridgeRelease([]Release{
		{TagName: "halo-1.1.15-cellbridge-preview.20261109165738"},
		{TagName: "halo-1.2.0-cellbridge"},
		{TagName: "halo-1.3.0-cellbridge", Draft: true},
	})
	if err != nil || best.TagName != "halo-1.2.0-cellbridge" || latest != "1.2.0-cellbridge" {
		t.Fatalf("best = %+v latest=%q err=%v", best, latest, err)
	}
}

// Exercise the same ordering contract through comparison, release selection,
// and the HTTP update check, including both GitHub release list orders.
func TestCellbridgeFormalPreviewOrdering(t *testing.T) {
	const formal = "1.2.0-cellbridge"
	const preview = "1.2.0-cellbridge-preview.20261109165738"
	const higherPreview = "1.2.1-cellbridge-preview.20261109165738"
	formalRelease := Release{TagName: "halo-" + formal}
	previewRelease := Release{TagName: "halo-" + preview, Prerelease: true}
	higherPreviewRelease := Release{TagName: "halo-" + higherPreview, Prerelease: true}
	previewFirst := []Release{previewRelease, formalRelease}
	formalFirst := []Release{formalRelease, previewRelease}

	tests := []struct {
		name      string
		current   string
		releases  []Release
		latest    string
		available bool
	}{
		{"preview upgrades to formal preview first", preview, previewFirst, formal, true},
		{"preview upgrades to formal formal first", preview, formalFirst, formal, true},
		{"formal ignores same-base preview", formal, []Release{previewRelease}, preview, false},
		{"formal stays formal preview first", formal, previewFirst, formal, false},
		{"formal stays formal formal first", formal, formalFirst, formal, false},
		{"formal upgrades to higher-base preview first", formal, []Release{higherPreviewRelease, formalRelease}, higherPreview, true},
		{"formal upgrades to higher-base preview last", formal, []Release{formalRelease, higherPreviewRelease}, higherPreview, true},
	}
	for _, item := range tests {
		t.Run(item.name, func(t *testing.T) {
			t.Run("comparison", func(t *testing.T) {
				newer, err := IsNewerVersion(item.current, item.latest)
				if err != nil || newer != item.available {
					t.Fatalf("IsNewerVersion(%q, %q) = %v, %v; want %v", item.current, item.latest, newer, err, item.available)
				}
			})
			t.Run("release_selection", func(t *testing.T) {
				best, latest, err := newestCellbridgeRelease(item.releases)
				if err != nil || best == nil || best.TagName != "halo-"+item.latest || latest != item.latest {
					t.Fatalf("best = %+v latest=%q err=%v; want %q", best, latest, err, item.latest)
				}
			})
			t.Run("CheckLatest", func(t *testing.T) {
				server := cellbridgeListServer(t, item.releases)
				defer server.Close()
				ctx := WithGitHubForTest(WithChannel(context.Background(), ChannelCellbridge), server.URL, server.Client())
				result, err := CheckLatest(ctx, "Nan7Li/Halo", "", item.current)
				if err != nil {
					t.Fatal(err)
				}
				if result.Available != item.available || result.Latest != item.latest || result.Current != item.current || result.Channel != ChannelCellbridge || result.Release == nil || result.Release.TagName != "halo-"+item.latest {
					t.Fatalf("result = %+v; want latest=%q available=%v", result, item.latest, item.available)
				}
			})
		})
	}
}
