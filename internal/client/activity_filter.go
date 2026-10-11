package client

import (
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"os/exec"
	"strings"
	"sync"
)

// SessionScreenFingerprint returns a hash of what every pane in the tmux
// session currently shows. Two calls return the same value when nothing
// visible changed, even if programs redrew the same content in between.
func SessionScreenFingerprint(sessionName string) (string, error) {
	out, err := exec.Command("tmux", "list-panes", "-s", "-t", sessionName, "-F", "#{pane_id}").Output()
	if err != nil {
		return "", err
	}
	h := sha256.New()
	for _, pane := range strings.Fields(string(out)) {
		content, err := exec.Command("tmux", "capture-pane", "-p", "-t", pane).Output()
		if err != nil {
			// The pane may have closed between the two calls; skip it.
			continue
		}
		h.Write([]byte(pane))
		h.Write([]byte{0})
		h.Write(content)
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// NewChangeFilter wraps report so it only runs when fingerprint() differs from
// the previous call. Programs such as nvim redraw an unchanged status line on a
// timer; that produces pane output but no visible change, and must not count
// as session activity. The first fingerprint is taken immediately, so the state
// at creation counts as "seen". If fingerprint fails, report runs anyway --
// better a false activity signal than a missed one.
func NewChangeFilter(fingerprint func() (string, error), report func()) func() {
	var mu sync.Mutex
	last, err := fingerprint()
	if err != nil {
		last = ""
	}
	return func() {
		mu.Lock()
		cur, err := fingerprint()
		if err != nil {
			slog.Debug("screen fingerprint failed, reporting activity", "error", err)
			last = ""
			mu.Unlock()
			report()
			return
		}
		changed := cur != last
		last = cur
		mu.Unlock()
		if changed {
			report()
		}
	}
}
