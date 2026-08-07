package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// stubHandler writes a fixed body so tests can tell a 200 (served) from a 304.
var stubHandler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
	_, _ = w.Write([]byte("BODY"))
})

func TestStaticETagStable(t *testing.T) {
	if staticETag == `""` || !strings.HasPrefix(staticETag, `"`) {
		t.Fatalf("staticETag should be a non-empty quoted validator, got %q", staticETag)
	}
	if computeStaticETag() != staticETag {
		t.Fatal("computeStaticETag is not deterministic across calls")
	}
}

// TestServeCachedRevalidates covers the fix for the "re-downloads the ~7MB wasm
// every load" bug: a non-content-hashed asset must carry a revalidatable ETag so
// a repeat load with If-None-Match gets a tiny 304 instead of the whole body.
func TestServeCachedRevalidates(t *testing.T) {
	// First load: no validator on the request → full body + ETag + no-cache.
	req := httptest.NewRequest(http.MethodGet, "/sshclient.wasm", nil)
	rr := httptest.NewRecorder()
	serveCached(rr, req, stubHandler)

	if got := rr.Header().Get("ETag"); got != staticETag {
		t.Errorf("ETag = %q, want %q", got, staticETag)
	}
	if got := rr.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("Cache-Control = %q, want no-cache", got)
	}
	if rr.Code != http.StatusOK || rr.Body.String() != "BODY" {
		t.Errorf("first load: code=%d body=%q, want 200/BODY", rr.Code, rr.Body.String())
	}

	// Repeat load with the matching validator → 304, no body re-sent.
	req = httptest.NewRequest(http.MethodGet, "/sshclient.wasm", nil)
	req.Header.Set("If-None-Match", staticETag)
	rr = httptest.NewRecorder()
	serveCached(rr, req, stubHandler)

	if rr.Code != http.StatusNotModified {
		t.Errorf("revalidation code = %d, want 304", rr.Code)
	}
	if rr.Body.Len() != 0 {
		t.Errorf("304 should not resend the body, got %q", rr.Body.String())
	}
}

func TestServeCachedImmutableForHashedAssets(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/assets/index-CA0sbnod.js", nil)
	rr := httptest.NewRecorder()
	serveCached(rr, req, stubHandler)

	if got := rr.Header().Get("Cache-Control"); !strings.Contains(got, "immutable") {
		t.Errorf("content-hashed asset Cache-Control = %q, want immutable", got)
	}
}
