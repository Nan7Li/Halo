package airsim

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"
)

// Storage keeps the one pairing Halo has with a phone.
type Storage interface {
	LoadPairing(context.Context) (Pairing, bool, error)
	SavePairing(context.Context, Pairing) error
	DeletePairing(context.Context) error
}

// SMSSink stores a received message durably. Only after it returns nil is
// the message acknowledged and dropped from the phone's queue.
type SMSSink func(context.Context, Pairing, SMS) error

// Status is what Halo shows about the phone.
type Status struct {
	Paired       bool      `json:"paired"`
	State        string    `json:"state"` // unpaired | connecting | online | offline
	Error        string    `json:"error,omitempty"`
	Host         string    `json:"host,omitempty"`
	ControlPort  int       `json:"control_port,omitempty"`
	PCMPort      int       `json:"pcm_port,omitempty"`
	AgentID      string    `json:"agent_id,omitempty"`
	DeviceName   string    `json:"device_name,omitempty"`
	Manufacturer string    `json:"manufacturer,omitempty"`
	Model        string    `json:"model,omitempty"`
	PhoneNumber  string    `json:"phone_number,omitempty"`
	PairedAt     time.Time `json:"paired_at,omitzero"`
	LastSeen     time.Time `json:"last_seen,omitzero"`
	Battery      *Battery  `json:"battery,omitempty"`
	SIMSlots     []SIMSlot `json:"sim_slots"`
	Call         *Call     `json:"call"`
	History      []Call    `json:"history"`
	Revision     uint64    `json:"revision"`
}

// Manager keeps Halo connected to the paired phone: it follows the phone's
// event stream, mirrors its call state, and moves received texts into Halo.
type Manager struct {
	storage Storage
	sink    SMSSink
	logger  *slog.Logger

	mu       sync.Mutex
	pairing  Pairing
	client   *Client
	status   Status
	cancel   context.CancelFunc
	done     chan struct{}
	changed  chan struct{}
	lifetime context.Context
}

// NewManager loads the saved pairing; Start begins following the phone.
func NewManager(storage Storage, sink SMSSink, logger *slog.Logger) *Manager {
	if logger == nil {
		logger = slog.Default()
	}
	return &Manager{
		storage: storage,
		sink:    sink,
		logger:  logger.With("component", "airsim"),
		status:  Status{State: "unpaired", SIMSlots: []SIMSlot{}, History: []Call{}},
		changed: make(chan struct{}),
	}
}

// Start resumes the saved pairing, if any, for the life of ctx.
func (m *Manager) Start(ctx context.Context) {
	m.mu.Lock()
	m.lifetime = ctx
	m.mu.Unlock()
	pairing, ok, err := m.storage.LoadPairing(ctx)
	if err != nil {
		m.logger.Warn("load AirSIM pairing failed", "error", err)
		return
	}
	if ok {
		m.use(pairing)
	}
}

// Pair claims the phone's pairing window and switches Halo to that phone.
func (m *Manager) Pair(ctx context.Context, host string, port int, code string) (Status, error) {
	pairing, err := Pair(ctx, host, port, code)
	if err != nil {
		return m.Status(), err
	}
	client, err := NewClient(pairing)
	if err != nil {
		return m.Status(), err
	}
	// The pairing window hands back ports only once the gateway is live, so
	// the first signed health check normally succeeds right away.
	if health, healthErr := client.Health(ctx); healthErr == nil {
		pairing.DeviceName = health.DeviceName
		pairing.Manufacturer = health.Manufacturer
		pairing.Model = health.Model
	}
	if err := m.storage.SavePairing(ctx, pairing); err != nil {
		return m.Status(), err
	}
	m.logger.Info("paired with AirSIM phone", "model", pairing.Model, "host", pairing.Host)
	m.use(pairing)
	return m.Status(), nil
}

// Unpair forgets the phone. The phone keeps its record of Halo until its
// pairing list is cleared there.
func (m *Manager) Unpair(ctx context.Context) error {
	m.stop()
	if err := m.storage.DeletePairing(ctx); err != nil {
		return err
	}
	m.update(func(s *Status) {
		*s = Status{State: "unpaired", SIMSlots: []SIMSlot{}, History: []Call{}, Revision: s.Revision}
	})
	return nil
}

// Status is a snapshot of the phone.
func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	status := m.status
	status.SIMSlots = append([]SIMSlot(nil), status.SIMSlots...)
	status.History = append([]Call(nil), status.History...)
	if status.Call != nil {
		call := *status.Call
		status.Call = &call
	}
	return status
}

// Changed is closed at the next status change.
func (m *Manager) Changed() <-chan struct{} {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.changed
}

// ErrNotPaired is returned while Halo has no phone.
var ErrNotPaired = errors.New("还没有配对安卓手机")

// Client is the signed client for the paired phone.
func (m *Manager) Client() (*Client, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.client == nil {
		return nil, ErrNotPaired
	}
	return m.client, nil
}

// Pairing is the current pairing.
func (m *Manager) Pairing() (Pairing, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.pairing, m.client != nil
}

// Refresh re-reads the phone's calls now, after Halo acted on one.
func (m *Manager) Refresh(ctx context.Context) {
	client, err := m.Client()
	if err != nil {
		return
	}
	if snapshot, err := client.Calls(ctx); err == nil {
		m.applyCalls(snapshot)
	}
}

func (m *Manager) use(pairing Pairing) {
	client, err := NewClient(pairing)
	if err != nil {
		m.logger.Warn("saved AirSIM pairing is unusable", "error", err)
		return
	}
	m.stop()
	m.mu.Lock()
	parent := m.lifetime
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	done := make(chan struct{})
	m.pairing, m.client, m.cancel, m.done = pairing, client, cancel, done
	m.mu.Unlock()
	m.update(func(s *Status) {
		*s = Status{
			Paired: true, State: "connecting", Host: pairing.Host,
			ControlPort: pairing.ControlPort, PCMPort: pairing.PCMPort, AgentID: pairing.AgentID,
			DeviceName: pairing.DeviceName, Manufacturer: pairing.Manufacturer, Model: pairing.Model,
			PairedAt: pairing.PairedAt, SIMSlots: []SIMSlot{}, History: []Call{}, Revision: s.Revision,
		}
	})
	go func() {
		defer close(done)
		m.follow(ctx, client)
	}()
}

func (m *Manager) stop() {
	m.mu.Lock()
	cancel, done := m.cancel, m.done
	m.cancel, m.done, m.client = nil, nil, nil
	m.mu.Unlock()
	if cancel != nil {
		cancel()
		<-done
	}
}

// follow is the connection loop: prove identity, then long-poll events,
// backing off while the phone is unreachable.
func (m *Manager) follow(ctx context.Context, client *Client) {
	backoff := time.Second
	for ctx.Err() == nil {
		err := m.session(ctx, client)
		if ctx.Err() != nil {
			return
		}
		message := "连不上安卓手机"
		if err != nil {
			message = err.Error()
		}
		m.update(func(s *Status) { s.State, s.Error = "offline", message })
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, 30*time.Second)
	}
}

func (m *Manager) session(ctx context.Context, client *Client) error {
	health, err := client.Health(ctx)
	if err != nil {
		return err
	}
	m.update(func(s *Status) {
		s.State, s.Error, s.LastSeen = "online", "", time.Now().UTC()
		s.DeviceName, s.Manufacturer, s.Model = health.DeviceName, health.Manufacturer, health.Model
		s.PhoneNumber, s.Battery = health.PhoneNumber, health.Battery
		if health.SIMSlots != nil {
			s.SIMSlots = health.SIMSlots
		}
	})
	if snapshot, err := client.Calls(ctx); err == nil {
		m.applyCalls(snapshot)
	}
	m.drainSMS(ctx, client)
	lastHealth := time.Now()
	var revision, smsRevision int64
	for ctx.Err() == nil {
		events, err := client.WaitEvents(ctx, revision)
		if err != nil {
			return err
		}
		revision = events.Revision
		m.applyCalls(events.Call)
		m.update(func(s *Status) {
			s.State, s.Error, s.LastSeen = "online", "", time.Now().UTC()
			if events.SIMSlots != nil {
				s.SIMSlots = events.SIMSlots
			}
		})
		if events.SMSRevision != smsRevision || events.SMSPending > 0 {
			smsRevision = events.SMSRevision
			m.drainSMS(ctx, client)
		}
		// Battery and identity only come with health; refresh them now and then.
		if time.Since(lastHealth) > 5*time.Minute {
			lastHealth = time.Now()
			if health, err := client.Health(ctx); err == nil {
				m.update(func(s *Status) { s.Battery, s.PhoneNumber = health.Battery, health.PhoneNumber })
			} else {
				return err
			}
		}
	}
	return ctx.Err()
}

func (m *Manager) applyCalls(snapshot CallSnapshot) {
	m.update(func(s *Status) {
		s.Call = snapshot.Active
		if s.Call != nil && s.Call.State == "ended" {
			s.Call = nil
		}
		if snapshot.History != nil {
			history := snapshot.History
			if len(history) > 50 {
				history = history[len(history)-50:]
			}
			s.History = history
		}
	})
}

func (m *Manager) drainSMS(ctx context.Context, client *Client) {
	if m.sink == nil {
		return
	}
	messages, err := client.PendingSMS(ctx)
	if err != nil || len(messages) == 0 {
		return
	}
	pairing, _ := m.Pairing()
	stored := make([]string, 0, len(messages))
	for _, message := range messages {
		if message.DeliveryID == "" {
			continue
		}
		if err := m.sink(ctx, pairing, message); err != nil {
			m.logger.Warn("store AirSIM SMS failed", "error", err)
			continue
		}
		stored = append(stored, message.DeliveryID)
	}
	if len(stored) > 0 {
		if err := client.AckSMS(ctx, stored); err != nil {
			m.logger.Warn("acknowledge AirSIM SMS failed", "error", err)
		}
	}
}

func (m *Manager) update(change func(*Status)) {
	m.mu.Lock()
	change(&m.status)
	m.status.Revision++
	close(m.changed)
	m.changed = make(chan struct{})
	m.mu.Unlock()
}
