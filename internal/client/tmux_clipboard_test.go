package client

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestTmuxOutputAtLeast(t *testing.T) {
	cases := []struct {
		out      string
		maj, min int
		want     bool
	}{
		{"tmux 3.4\n", 3, 2, true},
		{"tmux 3.3a\n", 3, 2, true},
		{"tmux 3.2\n", 3, 2, true},
		{"tmux 3.1c\n", 3, 2, false},
		{"tmux 2.9\n", 3, 2, false},
		{"tmux 4.0\n", 3, 2, true},
		{"garbage", 3, 2, false},
		{"", 3, 2, false},
	}
	for _, c := range cases {
		if got := tmuxOutputAtLeast(c.out, c.maj, c.min); got != c.want {
			t.Errorf("tmuxOutputAtLeast(%q, %d.%d) = %v, want %v", c.out, c.maj, c.min, got, c.want)
		}
	}
}

// TestConfigureClipboardRealTmux creates a real detached tmux session and
// asserts ConfigureClipboard wires copy-command to `devsesh copy`. Skipped when
// tmux is absent or older than 3.2 (where copy-command does not exist).
func TestConfigureClipboardRealTmux(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not installed")
	}
	if !tmuxVersionAtLeast(3, 2) {
		t.Skip("tmux < 3.2; copy-command not available")
	}

	name := fmt.Sprintf("devsesh-clip-test-%d", os.Getpid())
	if err := NewSessionDetached(name, "", nil); err != nil {
		t.Fatalf("create session: %v", err)
	}
	defer KillSession(name)

	// NewSessionDetached must wire copy-command SYNCHRONOUSLY before returning:
	// `devsesh start` immediately AttachSession-execs, which would kill a
	// background goroutine before its set-options land. No extra call here --
	// assert the option is already set purely from NewSessionDetached.
	out, err := exec.Command("tmux", "show-options", "-t", name, "copy-command").Output()
	if err != nil {
		t.Fatalf("show-options: %v", err)
	}
	if !strings.Contains(string(out), "devsesh copy") {
		t.Errorf("copy-command not set to devsesh copy: %q", out)
	}

	// Buffers set outside copy-mode (e.g. neovim's `tmux load-buffer`) must be
	// bridged too, via after-set-buffer / after-load-buffer hooks that pipe the
	// buffer through `devsesh copy`.
	hout, err := exec.Command("tmux", "show-hooks", "-t", name).Output()
	if err != nil {
		t.Fatalf("show-hooks: %v", err)
	}
	hooks := string(hout)
	for _, hook := range []string{"after-set-buffer", "after-load-buffer"} {
		if !strings.Contains(hooks, hook) {
			t.Errorf("%s hook not set: %q", hook, hooks)
		}
	}
	if !strings.Contains(hooks, "devsesh copy") {
		t.Errorf("buffer hooks not wired to devsesh copy: %q", hooks)
	}
}
