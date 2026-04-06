package client

import (
	"context"
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
	if err := watcher.Add(dir); err != nil {
		slog.Error("failed to add watcher", "error", err, "dir", dir)
		watcher.Close()
		wg.Done()
		return err
	}

	fileName := filepath.Base(path)

	go func() {
		defer wg.Done()
		watcher.Close()

		debouncer := util.NewDebouncer(debounceDelay, func() {
			sf, err := ReadSessionFile(path)
			if err != nil {
				slog.Error("failed to read session file", "error", err)
				return
			}
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
