package client

import (
	"context"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
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
