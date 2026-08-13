package client

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/leolimasa/devsesh/internal/util"
	"gopkg.in/yaml.v3"
)

type SessionFile struct {
	SessionID string            `yaml:"session_id"`
	Name      string            `yaml:"name"`
	StartTime time.Time         `yaml:"start_time"`
	Hostname  string            `yaml:"hostname"`
	Cwd       string            `yaml:"cwd"`
	Extra     map[string]string `yaml:",inline"`
}

func NewSessionFile(sessionID, name string) (*SessionFile, error) {
	hostname, err := os.Hostname()
	if err != nil {
		slog.Error("failed to get hostname", "error", err)
		hostname = "unknown"
	}
	cwd, err := os.Getwd()
	if err != nil {
		slog.Error("failed to get current working directory", "error", err)
		cwd = "unknown"
	}

	return &SessionFile{
		SessionID: sessionID,
		Name:      name,
		StartTime: time.Now(),
		Hostname:  hostname,
		Cwd:       cwd,
		Extra:     make(map[string]string),
	}, nil
}

// SessionFileFromServer reconstructs a local SessionFile from a session's
// server-side record. When `devsesh start` re-adopts a session under its
// original id (its tmux died but the server session lingers), this rehydrates
// the local .yml -- status line, cwd, hostname -- from what the server last
// knew, keeping the id and name authoritative from the record.
//
// The stored metadata may carry a nested "extra" object (as POSTed at session
// start) or extra keys flattened alongside the core fields (as POSTed by later
// `devsesh set` meta updates), so both shapes are folded into Extra.
func SessionFileFromServer(s ServerSession) *SessionFile {
	sf := &SessionFile{
		SessionID: s.ID,
		Name:      s.Name,
		StartTime: s.StartedAt,
		Extra:     make(map[string]string),
	}

	if s.Metadata != nil && *s.Metadata != "" {
		var meta map[string]any
		if err := json.Unmarshal([]byte(*s.Metadata), &meta); err != nil {
			slog.Error("failed to parse server session metadata", "error", err, "session_id", s.ID)
		} else {
			applyMetaToSessionFile(sf, meta)
		}
	}

	// Fall back to this host's values when the metadata didn't carry them.
	if sf.Hostname == "" {
		if h, err := os.Hostname(); err == nil {
			sf.Hostname = h
		}
	}
	if sf.Cwd == "" {
		if cwd, err := os.Getwd(); err == nil {
			sf.Cwd = cwd
		}
	}
	return sf
}

func applyMetaToSessionFile(sf *SessionFile, meta map[string]any) {
	for k, v := range meta {
		switch k {
		case "session_id", "start_time", "name":
			// id/name are authoritative from the record; start_time already set.
		case "hostname":
			sf.Hostname = metaValueToString(v)
		case "cwd":
			sf.Cwd = metaValueToString(v)
		case "extra":
			if nested, ok := v.(map[string]any); ok {
				for nk, nv := range nested {
					sf.Extra[nk] = metaValueToString(nv)
				}
			}
		default:
			sf.Extra[k] = metaValueToString(v)
		}
	}
}

func metaValueToString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	default:
		return fmt.Sprintf("%v", t)
	}
}

func WriteSessionFile(path string, sf *SessionFile) error {
	data, err := yaml.Marshal(sf)
	if err != nil {
		slog.Error("failed to marshal session file", "error", err, "path", path)
		return err
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		slog.Error("failed to write session file", "error", err, "path", path)
		return err
	}
	return nil
}

func ReadSessionFile(path string) (*SessionFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		slog.Error("failed to read session file", "error", err, "path", path)
		return nil, err
	}
	var sf SessionFile
	if err := yaml.Unmarshal(data, &sf); err != nil {
		slog.Error("failed to parse session file", "error", err, "path", path)
		return nil, err
	}
	return &sf, nil
}

func UpdateSessionFile(path, key, value string) error {
	sf, err := ReadSessionFile(path)
	if err != nil {
		return err
	}

	if sf.Extra == nil {
		sf.Extra = make(map[string]string)
	}
	sf.Extra[key] = value

	return WriteSessionFile(path, sf)
}

func WatchSessionFile(ctx context.Context, wg *sync.WaitGroup, path string, debounceDelay time.Duration, onChange func(SessionFile)) error {
	wg.Add(1)

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		slog.Error("failed to create file watcher", "error", err, "path", path)
		wg.Done()
		return err
	}

	dir := filepath.Dir(path)
	slog.Debug("watching directory for session file changes", "dir", dir, "path", path)
	if err := watcher.Add(dir); err != nil {
		slog.Error("failed to add watcher", "error", err, "dir", dir)
		watcher.Close()
		wg.Done()
		return err
	}

	fileName := filepath.Base(path)

	go func() {
		defer wg.Done()
		defer watcher.Close()

		debouncer := util.NewDebouncer(debounceDelay, func() {
			sf, err := ReadSessionFile(path)
			if err != nil {
				slog.Error("failed to read session file", "error", err)
				return
			}
			slog.Debug("session file changed, triggering callback", "file", path, "extra", sf.Extra)
			onChange(*sf)
		})

		for {
			select {
			case <-ctx.Done():
				debouncer.Stop()
				return
			case event, ok := <-watcher.Events:
				if !ok {
					debouncer.Stop()
					return
				}
				slog.Debug("fsnotify event", "name", event.Name, "fileName", fileName, "op", event.Op)
				eventName := filepath.Base(event.Name)
				if eventName == fileName {
					slog.Debug("detected session file change, triggering debouncer", "event", event.Op)
					debouncer.Call()
				}
			case err, ok := <-watcher.Errors:
				if !ok {
					debouncer.Stop()
					return
				}
				slog.Error("watch error", "error", err)
			}
		}
	}()

	return nil
}
