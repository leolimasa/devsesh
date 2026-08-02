package client

import (
	"bufio"
	"context"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/leolimasa/devsesh/internal/util"
	"golang.org/x/term"
)

type OutputMonitor struct {
	onActivity func()
	throttle   *util.Throttle
	ctx        context.Context
}

func NewOutputMonitor(ctx context.Context, wg *sync.WaitGroup, onActivity func(), throttleInterval time.Duration) io.Writer {
	wg.Add(1)

	m := &OutputMonitor{
		onActivity: onActivity,
		ctx:        ctx,
	}

	m.throttle = util.NewThrottle(throttleInterval, func() {
		m.onActivity()
	})

	go func() {
		defer wg.Done()
		<-ctx.Done()
		m.throttle.Stop()
	}()

	return m
}

func (m *OutputMonitor) Write(p []byte) (n int, err error) {
	if len(p) == 0 {
		return 0, nil
	}

	m.throttle.Call()
	return len(p), nil
}

// StartSession launches `tmux new-session` attached to a real pty rather
// than to the process's inherited stdio. tmux needs genuine terminal
// semantics on its output fd to keep pushing screen updates: if that fd is
// just a plain pipe (e.g. an io.Writer passed via cmd.Stdout), tmux writes
// its initial handshake and then stops actively redrawing to it, even
// though the session keeps producing real output. Routing through a pty
// keeps tmux's rendering behavior correct while still letting us observe
// every byte it writes (for the activity monitor) and forward it to the
// real terminal.
func StartSession(ctx context.Context, wg *sync.WaitGroup, sessionName string, env map[string]string, onActivity func()) (*exec.Cmd, error) {
	cmd := exec.CommandContext(ctx, "tmux", "-2", "new-session", "-s", sessionName)

	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	cmd.Env = append(cmd.Env, os.Environ()...)

	ptmx, err := pty.Start(cmd)
	if err != nil {
		slog.Error("failed to start tmux session", "error", err, "session_name", sessionName)
		return nil, err
	}

	if err := pty.InheritSize(os.Stdin, ptmx); err != nil {
		slog.Warn("failed to set initial pty size", "error", err)
	}

	// Wire tmux copy-to-clipboard for this session (best-effort, non-blocking).
	go ConfigureClipboard(sessionName)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGWINCH)
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer signal.Stop(sigCh)
		for {
			select {
			case <-ctx.Done():
				return
			case <-sigCh:
				if err := pty.InheritSize(os.Stdin, ptmx); err != nil {
					slog.Warn("failed to resize pty", "error", err)
				}
			}
		}
	}()

	// Put the real terminal into raw mode so keystrokes pass through to
	// tmux untranslated, restoring it once the session ends.
	if oldState, err := term.MakeRaw(int(os.Stdin.Fd())); err == nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-ctx.Done()
			term.Restore(int(os.Stdin.Fd()), oldState)
		}()
	}

	throttleInterval := 1 * time.Second
	monitor := NewOutputMonitor(ctx, wg, onActivity, throttleInterval)

	// Forward tmux's output to the real terminal and the activity monitor.
	wg.Add(1)
	go func() {
		defer wg.Done()
		io.Copy(io.MultiWriter(os.Stdout, monitor), ptmx)
	}()

	// Forward keystrokes from the real terminal to tmux. Not tracked in wg:
	// a blocking read on the real stdin has no way to be interrupted on
	// session end short of closing the process's stdin, so this goroutine
	// is left to exit on its own (it errors out once ptmx is closed below).
	go io.Copy(ptmx, os.Stdin)

	go func() {
		<-ctx.Done()
		ptmx.Close()
	}()

	return cmd, nil
}

// NewSessionDetached creates a new detached tmux session. Because the session
// lives in the tmux server daemon (which is reparented to init), it outlives
// whatever process created it -- unlike a foreground `new-session` client. The
// env map is injected into the session environment via `-e` so tools running
// inside the session (e.g. `devsesh set`) can read DEVSESH_* variables.
func NewSessionDetached(sessionName string, env map[string]string) error {
	args := []string{"-2", "new-session", "-d", "-s", sessionName}
	for k, v := range env {
		args = append(args, "-e", k+"="+v)
	}
	cmd := exec.Command("tmux", args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		slog.Error("failed to create detached tmux session", "error", err, "session_name", sessionName, "output", string(out))
		return err
	}
	// Wire clipboard synchronously: `devsesh start` follows this with an
	// AttachSession that syscall.Exec-replaces the process, which would kill a
	// background goroutine before its set-options land. The session already
	// exists (created -d above), so this returns almost immediately.
	ConfigureClipboard(sessionName)
	return nil
}

// leadingInt returns the integer formed by the leading digits of s (0 if none),
// so "3a" -> 3. Used to tolerate tmux version suffixes like "3.3a".
func leadingInt(s string) int {
	i := 0
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	n, _ := strconv.Atoi(s[:i])
	return n
}

// tmuxVersionAtLeast reports whether the installed tmux is >= major.minor.
// Returns false if tmux is absent or unparseable.
func tmuxVersionAtLeast(major, minor int) bool {
	out, err := exec.Command("tmux", "-V").Output()
	if err != nil {
		return false
	}
	return tmuxOutputAtLeast(string(out), major, minor)
}

// tmuxOutputAtLeast parses `tmux -V` output (e.g. "tmux 3.4" or "tmux 3.3a") and
// reports whether it is >= major.minor. A non-numeric suffix on the minor is
// tolerated. Pure/testable (no exec).
func tmuxOutputAtLeast(vOutput string, major, minor int) bool {
	fields := strings.Fields(vOutput)
	if len(fields) < 2 {
		return false
	}
	parts := strings.SplitN(fields[1], ".", 2)
	maj := leadingInt(parts[0])
	if maj != major {
		return maj > major
	}
	min := 0
	if len(parts) == 2 {
		min = leadingInt(parts[1])
	}
	return min >= minor
}

// ConfigureClipboard wires the devsesh-created tmux session so a copy action
// (mouse drag-release, or a copy-mode confirm) pipes the selection to
// `devsesh copy`, bridging it to the browser clipboard. All state is scoped to
// the given session via `set-option -t` so the user's global tmux config is
// untouched. Best-effort: every failure is logged and never blocks session
// start. The session may not be registered the instant StartSession returns, so
// it waits briefly for it (a no-op for NewSessionDetached, which already waited).
func ConfigureClipboard(sessionName string) {
	for i := 0; i < 20 && !SessionExists(sessionName); i++ {
		time.Sleep(50 * time.Millisecond)
	}

	set := func(args ...string) {
		full := append([]string{"set-option", "-t", sessionName}, args...)
		if out, err := exec.Command("tmux", full...).CombinedOutput(); err != nil {
			slog.Warn("tmux clipboard set-option failed", "args", args, "error", err, "output", string(out))
		}
	}

	// Drag-to-select in the terminal.
	set("mouse", "on")

	if tmuxVersionAtLeast(3, 2) {
		// tmux >= 3.2: copy-pipe / copy-pipe-and-cancel (mouse release and the
		// copy-mode confirm keys) use this command by default.
		set("copy-command", "devsesh copy")
		return
	}

	// Legacy tmux: bind the copy-mode confirm keys and mouse drag-end directly.
	// Key tables are server-global in old tmux, so this is the one unavoidable
	// non-session-local bit -- gated behind the old-version branch only.
	bind := func(args ...string) {
		if out, err := exec.Command("tmux", args...).CombinedOutput(); err != nil {
			slog.Warn("tmux clipboard bind failed", "args", args, "error", err, "output", string(out))
		}
	}
	bind("bind-key", "-T", "copy-mode-vi", "y", "send", "-X", "copy-pipe-and-cancel", "devsesh copy")
	bind("bind-key", "-T", "copy-mode", "Enter", "send", "-X", "copy-pipe-and-cancel", "devsesh copy")
	bind("bind-key", "-T", "copy-mode", "MouseDragEnd1Pane", "send", "-X", "copy-pipe-and-cancel", "devsesh copy")
}

// SetSessionEnv sets an environment variable on an existing tmux session. This
// only affects newly created windows/panes, so it is best-effort for sessions
// that already have running shells.
func SetSessionEnv(sessionName, key, value string) error {
	cmd := exec.Command("tmux", "set-environment", "-t", sessionName, key, value)
	if err := cmd.Run(); err != nil {
		slog.Warn("failed to set tmux session env", "error", err, "session_name", sessionName, "key", key)
		return err
	}
	return nil
}

// GetSessionEnv reads an environment variable from a named tmux session's
// environment (as recorded by `-e` at creation or `set-environment`). Unlike
// GetSessionEnvCurrent it does not require the caller to be attached, so
// `devsesh start` can recover a running session's DEVSESH_SESSION_ID from
// outside tmux. Returns "" when the session or variable is absent.
func GetSessionEnv(sessionName, key string) string {
	out, err := exec.Command("tmux", "show-environment", "-t", sessionName, key).Output()
	if err != nil {
		return ""
	}
	line := strings.TrimSpace(string(out))
	prefix := key + "="
	// tmux reports an unset variable as "-KEY".
	if !strings.HasPrefix(line, prefix) {
		return ""
	}
	return strings.TrimPrefix(line, prefix)
}

// GetSessionEnvCurrent reads an environment variable from the tmux session the
// calling process is attached to (via $TMUX). Returns "" when not inside tmux,
// the variable is unset, or tmux errors. `devsesh watch` records the
// authoritative DEVSESH_* values in the session environment, so this recovers
// them for a shell whose own inherited copy is stale or missing -- tmux
// set-environment can't update a shell that was already running when watch
// (re)attached.
func GetSessionEnvCurrent(key string) string {
	if os.Getenv("TMUX") == "" {
		return ""
	}
	out, err := exec.Command("tmux", "show-environment", key).Output()
	if err != nil {
		return ""
	}
	line := strings.TrimSpace(string(out))
	// tmux reports an unset variable as "-KEY".
	prefix := key + "="
	if !strings.HasPrefix(line, prefix) {
		return ""
	}
	return strings.TrimPrefix(line, prefix)
}

// WatchControlMode attaches to an existing tmux session as a read-only control
// mode client and invokes onActivity for every chunk of pane output the session
// produces. Control mode gives a second, non-interactive view of the session
// that is independent of any interactive attach: its lifetime tracks the tmux
// session itself, so this call blocks until the session is destroyed, the tmux
// server exits, or ctx is cancelled -- then returns nil.
//
// The client attaches read-only (`-r`) so it is excluded from tmux's window
// sizing calculation and never disturbs the size the human's terminal drives.
func WatchControlMode(ctx context.Context, sessionName string, onActivity func()) error {
	cmd := exec.CommandContext(ctx, "tmux", "-C", "attach-session", "-r", "-t", sessionName)

	// Control mode reads commands from stdin; it exits on stdin EOF. Hold the
	// pipe open for the life of the client so the session isn't detached out
	// from under us. We never need to write to it.
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = nil

	if err := cmd.Start(); err != nil {
		slog.Error("failed to start tmux control-mode client", "error", err, "session_name", sessionName)
		return err
	}

	// Read notifications line by line. %output / %extended-output lines carry
	// pane output and mean the session is producing activity.
	r := bufio.NewReader(stdout)
	for {
		line, err := r.ReadString('\n')
		if len(line) > 0 {
			if strings.HasPrefix(line, "%output") || strings.HasPrefix(line, "%extended-output") {
				onActivity()
			}
		}
		if err != nil {
			break
		}
	}

	stdin.Close()
	cmd.Wait()
	return nil
}

func KillSession(sessionName string) error {
	cmd := exec.Command("tmux", "kill-session", "-t", sessionName)
	if err := cmd.Run(); err != nil {
		slog.Error("failed to kill tmux session", "error", err, "session_name", sessionName)
		return err
	}
	return nil
}

func ListSessions() ([]string, error) {
	cmd := exec.Command("tmux", "list-sessions", "-F", "#{session_name}")
	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && len(exitErr.Stderr) == 0 {
			return []string{}, nil
		}
		slog.Error("failed to list tmux sessions", "error", err)
		return nil, err
	}

	var sessions []string
	for _, line := range strings.Split(string(output), "\n") {
		if line != "" {
			sessions = append(sessions, line)
		}
	}
	return sessions, nil
}

func AttachSession(sessionName string) error {
	tmuxPath, err := exec.LookPath("tmux")
	if err != nil {
		slog.Error("tmux not found", "error", err)
		return err
	}

	args := []string{"tmux", "-2", "attach-session", "-t", sessionName}

	syscall.Exec(tmuxPath, args, os.Environ())

	return nil
}

func SessionExists(sessionName string) bool {
	cmd := exec.Command("tmux", "has-session", "-t", sessionName)
	return cmd.Run() == nil
}
