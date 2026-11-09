package qdc507

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

func TestWrongCardCannotLoadOrAdoptRoute(t *testing.T) {
	previous := append([]runtimeArtifact(nil), trustedRuntimeArtifacts...)
	restoreHashes(t, previous)
	dir := writeRuntime(t, nil)
	for _, cards := range []string{"0 [unrelated]: wrong sound card", "0 [other]: other\n1 [" + expectedCardName + "]"} {
		t.Run(cards, func(t *testing.T) {
			runner := &scriptRunner{reply: func(argv []string) (string, error) {
				args := strings.Join(argv, " ")
				switch {
				case strings.Contains(args, "devices -l"):
					return "serial device usb:1-4.2 transport_id:7", nil
				case strings.Contains(args, "id -u"):
					return "0", nil
				case strings.Contains(args, "uname -r"):
					return expectedKernel, nil
				case strings.Contains(args, "asound/cards"):
					return cards, nil
				default:
					return "ready", nil
				}
			}}
			status, err := Prepare(context.Background(), Config{OptIn: true, Bootstrap: true, DeviceType: "dji_4g", USBPath: "1-4.2", RuntimeDir: dir, ADBPath: "adb", Runner: runner})
			if err == nil || status.Ready || !strings.Contains(status.Reason, "card0") {
				t.Fatalf("status=%+v err=%v", status, err)
			}
			for _, argv := range runner.calls {
				args := strings.Join(argv, " ")
				if strings.Contains(args, "push") || strings.Contains(args, "insmod") || strings.Contains(args, "halo-cellbridge-route.pid") {
					t.Fatalf("unverified target touched: %s", args)
				}
			}
		})
	}
}

func TestMain(m *testing.M) {
	pcmRetryDelay = time.Millisecond
	cardRetryDelay = time.Millisecond
	os.Exit(m.Run())
}

// /proc/asound/cards as the module prints it once the voice modules are in.
const realCards = " 0 [mdm9607tomtomi]: mdm9607-tomtom- - " + expectedCardName + "\n" +
	"                      " + expectedCardName + "\n"

func TestFreshModuleRegistersCardAfterVoiceModules(t *testing.T) {
	cfg, fake, _ := newFixture(t)
	fake.cards = "--- no soundcards ---"
	fake.cardsAfterInsmod = realCards
	status, err := Prepare(context.Background(), cfg)
	if err != nil || !status.Ready {
		t.Fatalf("status=%+v err=%v", status, err)
	}
	if len(fake.insmod) != 2 {
		t.Fatalf("insmod = %v", fake.insmod)
	}
	_ = status.Runtime.Close(context.Background())
}

func TestCardThatNeverAppearsFailsAfterBootstrap(t *testing.T) {
	cfg, fake, _ := newFixture(t)
	fake.cards = "--- no soundcards ---"
	status, err := Prepare(context.Background(), cfg)
	if err == nil || status.Ready || !strings.Contains(status.Reason, "card0 尚未注册") || !strings.Contains(status.Reason, "no soundcards") {
		t.Fatalf("status=%+v err=%v", status, err)
	}
}

func TestMissingCardWithoutBootstrapSaysWhy(t *testing.T) {
	cfg, fake, _ := newFixture(t)
	cfg.Bootstrap = false
	fake.cards = "--- no soundcards ---"
	status, err := Prepare(context.Background(), cfg)
	if err == nil || status.Ready || !strings.Contains(status.Reason, "card0 尚未注册") || len(fake.insmod) != 0 {
		t.Fatalf("status=%+v err=%v insmod=%v", status, err, fake.insmod)
	}
}

func TestWrongCardNamesWhatWasFound(t *testing.T) {
	cfg, fake, _ := newFixture(t)
	fake.cards = " 0 [Audio]: USB-Audio - Some USB Audio\n"
	status, _ := Prepare(context.Background(), cfg)
	if !strings.Contains(status.Reason, "Some USB Audio") {
		t.Fatalf("reason = %q", status.Reason)
	}
}

func TestRealCardsFormatMatches(t *testing.T) {
	cfg, fake, _ := newFixture(t)
	fake.cards = realCards
	status, err := Prepare(context.Background(), cfg)
	if err != nil || !status.Ready {
		t.Fatalf("status=%+v err=%v", status, err)
	}
	_ = status.Runtime.Close(context.Background())
}
