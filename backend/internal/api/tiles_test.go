package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
)

func tilesRouter(t *testing.T, dir string) http.Handler {
	t.Helper()
	r := chi.NewRouter()
	if h := tileHandler(dir); h != nil {
		r.Handle("/tiles/*", http.StripPrefix("/tiles/", h))
	}
	return r
}

func TestTileHandler_EmptyDirDoesNotMount(t *testing.T) {
	if h := tileHandler(""); h != nil {
		t.Fatal("tileHandler(\"\") should return nil so the route is never mounted")
	}
}

func TestTileHandler_ServesFileWithCacheControl(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "kenya.pmtiles"), []byte("fake-tile-data"), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/tiles/kenya.pmtiles", nil)
	tilesRouter(t, dir).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", rr.Code, rr.Body.String())
	}
	if got := rr.Body.String(); got != "fake-tile-data" {
		t.Fatalf("body = %q, want %q", got, "fake-tile-data")
	}
	if got := rr.Header().Get("Cache-Control"); got != "public, max-age=604800, immutable" {
		t.Fatalf("Cache-Control = %q", got)
	}
}

func TestTileHandler_MissingFileIs404NotPanic(t *testing.T) {
	dir := t.TempDir()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/tiles/does-not-exist.pmtiles", nil)
	tilesRouter(t, dir).ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
}

func TestTileHandler_NonexistentDirIs404NotPanic(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/tiles/kenya.pmtiles", nil)
	tilesRouter(t, filepath.Join(t.TempDir(), "does-not-exist")).ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
}

func TestTileHandler_DirectoryRequestIsNotAListing(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "kenya.pmtiles"), []byte("fake"), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/tiles/", nil)
	tilesRouter(t, dir).ServeHTTP(rr, req)

	if rr.Code == http.StatusOK {
		t.Fatalf("directory request returned 200 (a listing), want a non-200 status")
	}
}

func TestTileHandler_PathTraversalNeverEscapesDir(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "kenya.pmtiles"), []byte("fake"), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	// A file that genuinely exists one level above dir, so a successful
	// traversal would be observable (a 200 with this body) rather than
	// merely "some 404, who knows why".
	secretPath := filepath.Join(filepath.Dir(dir), "secret.txt")
	if err := os.WriteFile(secretPath, []byte("should-not-be-served"), 0o644); err != nil {
		t.Fatalf("write secret fixture: %v", err)
	}
	t.Cleanup(func() { os.Remove(secretPath) })

	router := tilesRouter(t, dir)
	for _, path := range []string{
		"/tiles/../secret.txt",
		"/tiles/..%2Fsecret.txt",
		"/tiles/%2e%2e/secret.txt",
	} {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		router.ServeHTTP(rr, req)

		if rr.Body.String() == "should-not-be-served" {
			t.Fatalf("path %q escaped the tiles directory: got secret file contents", path)
		}
	}
}
