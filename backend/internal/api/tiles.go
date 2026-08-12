package api

import (
	"io/fs"
	"log/slog"
	"net/http"
	"os"
)

// tileHandler serves a self-hosted map tile directory (a single .pmtiles
// basemap file, see docs/TILES.md) at /tiles. Returns nil when dir is
// unset, so the route is simply never mounted rather than mounted onto an
// empty path.
//
// A missing or unreadable directory never crashes the server: http.Dir.Open
// just 404s per-request (the pmtiles client falls back to a plain
// background, see frontend fleet-map.tsx), and the map still shows status
// pins with no basemap underneath. The os.Stat here is purely diagnostic —
// one boot-time log line instead of a "why is the map blank" debugging
// session later.
func tileHandler(dir string) http.Handler {
	if dir == "" {
		return nil
	}
	if _, err := os.Stat(dir); err != nil {
		slog.Warn("tiles directory not readable; the fleet map will render without a basemap",
			"dir", dir, "error", err)
	}

	fileServer := http.FileServer(noListingFS{http.Dir(dir)})

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Tiles are immutable for the life of a generation run. Without this,
		// the browser still round-trips a conditional GET per range request
		// on every reload — defeating the entire point of self-hosting for a
		// kiosk display that should stop touching the network after first
		// load.
		w.Header().Set("Cache-Control", "public, max-age=604800, immutable")
		fileServer.ServeHTTP(w, r)
	})
}

// noListingFS suppresses http.FileServer's default directory-listing page.
// Deliberately does NOT hand-roll path resolution: http.Dir.Open already
// rejects ".." segments, and duplicating that logic is exactly where
// traversal bugs get introduced. This wrapper only changes directory
// behavior, nothing else.
type noListingFS struct {
	http.FileSystem
}

func (fsys noListingFS) Open(name string) (http.File, error) {
	f, err := fsys.FileSystem.Open(name)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	if info.IsDir() {
		f.Close()
		return nil, fs.ErrNotExist
	}
	return f, nil
}
