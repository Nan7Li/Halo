package qdc507

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// errCardZeroAbsent means the module has no ALSA card 0 yet. On a freshly
// booted module the tomtom machine driver only registers its card once the
// QDC507 APR and voice modules are loaded (upstream CellBridge checks the
// card after insmod), so this is not a mismatch before bootstrap.
var errCardZeroAbsent = errors.New("QDC507 card0 尚未注册")

// cardZero reads /proc/asound/cards and reports card 0's lines. A card 0
// that exists under another name is a mismatch; no card 0 at all is
// errCardZeroAbsent.
func cardZero(ctx context.Context, runner Runner, cfg Config, transport string) error {
	cards, err := runADB(ctx, runner, cfg, "-t", transport, "shell", "cat /proc/asound/cards")
	if err != nil {
		return fmt.Errorf("QDC507 声卡识别失败: %w", err)
	}
	lines := strings.Split(strings.ReplaceAll(cards, "\r", ""), "\n")
	for index, line := range lines {
		fields := strings.Fields(line)
		if len(fields) == 0 || fields[0] != "0" {
			continue
		}
		// card 0's entry is its index line plus the indented long name.
		entry := line
		if index+1 < len(lines) {
			if next := strings.Fields(lines[index+1]); len(next) > 0 && !isCardIndex(next[0]) {
				entry += "\n" + lines[index+1]
			}
		}
		if strings.Contains(entry, expectedCardName) {
			return nil
		}
		return fmt.Errorf("QDC507 card0 不匹配: 需要 %s，实际 %q", expectedCardName, strings.TrimSpace(entry))
	}
	return fmt.Errorf("%w（/proc/asound/cards: %q）", errCardZeroAbsent, strings.TrimSpace(cards))
}

// verifyCardZero requires card 0 to be the tomtom card.
func verifyCardZero(ctx context.Context, runner Runner, cfg Config, transport string) error {
	return cardZero(ctx, runner, cfg, transport)
}

// waitCardZero gives the card a few seconds to register after insmod.
func waitCardZero(ctx context.Context, rt *Runtime) error {
	var err error
	for attempt := 0; attempt < 5; attempt++ {
		if err = cardZero(ctx, rt.runner, rt.cfg, rt.transport); err == nil || !errors.Is(err, errCardZeroAbsent) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(cardRetryDelay):
		}
	}
	return err
}

func isCardIndex(field string) bool {
	if field == "" {
		return false
	}
	for _, char := range field {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}
