package update

import "testing"

func TestLegacyRepositoryMapsToHalo(t *testing.T) {
	for _, in := range []string{"Nan7Li/VoCat", "nan7li/vocat", " Nan7Li/VoCat "} {
		got, err := validateRepo(in)
		if err != nil || got != DefaultRepository {
			t.Fatalf("validateRepo(%q) = %q, %v; want %q", in, got, err, DefaultRepository)
		}
	}
	if got, _ := validateRepo("someone/fork"); got != "someone/fork" {
		t.Fatalf("other repositories must pass through, got %q", got)
	}
}
