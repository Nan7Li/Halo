package update

import (
	"fmt"
	"strconv"
	"strings"
	"testing"
)

// nextCellbridgePreview returns a cellbridge preview one patch release ahead
// of the running build, so channel tests do not break on every version bump.
func nextCellbridgePreview(t *testing.T) string {
	t.Helper()
	core := strings.SplitN(runningVersion(), "-", 2)[0]
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		t.Fatalf("running version %q is not semantic", runningVersion())
	}
	patch, err := strconv.Atoi(parts[2])
	if err != nil {
		t.Fatalf("running version %q: %v", runningVersion(), err)
	}
	return fmt.Sprintf("%s.%s.%d-cellbridge-preview.1", parts[0], parts[1], patch+1)
}
