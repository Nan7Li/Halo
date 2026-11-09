package update

import "testing"

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
