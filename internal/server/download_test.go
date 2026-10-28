package server

import "testing"

func TestVersionedFilename(t *testing.T) {
	for _, c := range []struct {
		name string
		n    int
		want string
	}{
		{"Contract.pdf", 2, "Contract_v2.pdf"},
		{"annual report.final.PDF", 1, "annual report.final_v1.PDF"},
		{"noext", 3, "noext_v3.pdf"},
		{".pdf", 4, "document_v4.pdf"},
	} {
		if got := versionedFilename(c.name, c.n); got != c.want {
			t.Errorf("versionedFilename(%q, %d) = %q, want %q", c.name, c.n, got, c.want)
		}
	}
	if got, want := contentDisposition("attachment", `Ugovor "č" v2.pdf`), `attachment; filename="Ugovor ___ v2.pdf"; filename*=UTF-8''Ugovor%20%22%C4%8D%22%20v2.pdf`; got != want {
		t.Errorf("contentDisposition = %s, want %s", got, want)
	}
}
