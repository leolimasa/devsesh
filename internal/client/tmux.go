package client

import (
	"context"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"sync"
	"time"

	"github.com/leolimasa/devsesh/internal/util"
)

type OutputMonitor struct {
	onOutput   func()
	debouncer *util.Debouncer
	ctx        context.Context
	mu         sync.Mutex
	lastWrite  time.Time
}

func NewOutputMonitor(ctx context.Context, wg *sync.WaitGroup, onOutput func(), debounceDelay time.Duration) io.Writer {
	wg.Add(1)
	
	m := &OutputMonitor{
		onOutput: onOutput,
		ctx:      ctx,
	}
	
	m.debouncer = util.NewDebouncer(debounceDelay, func() {
		m.mu.Lock()
		m.onOutput()
		m.mu.Unlock()
	})
	
	go func() {
		defer wg.Done()
		<-ctx.Done()
		m.debouncer.Stop()
	}()
	
	return m
}

func (m *OutputMonitor) Write(p []byte) (n int, err error) {
	if len(p) == 0 {
		return 0, nil
	}
	
	m.debouncer.Call()
	return len(p), nil
}

func StartSession(ctx context.Context, wg *sync.WaitGroup, sessionID string, env map[string]string, onOutput func()) (*exec.Cmd, error) {
	cmd := exec.CommandContext(ctx, "tmux", "-2", "new-session", "-s", sessionID)
	
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	cmd.Env = append(cmd.Env, os.Environ()...)
	
	cmd.Stdin = os.Stdin
	
	debounceDelay := 500 * time.Millisecond
	monitor := NewOutputMonitor(ctx, wg, onOutput, debounceDelay)
	
	cmd.Stdout = io.MultiWriter(os.Stdout, monitor)
	cmd.Stderr = io.MultiWriter(os.Stderr, monitor)
	
	if err := cmd.Start(); err != nil {
		slog.Error("failed to start tmux session", "error", err, "session_id", sessionID)
		return nil, err
	}
	
	return cmd, nil
}

func KillSession(sessionID string) error {
	cmd := exec.Command("tmux", "kill-session", "-t", sessionID)
	if err := cmd.Run(); err != nil {
		slog.Error("failed to kill tmux session", "error", err, "session_id", sessionID)
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

func AttachSession(sessionID string) error {
	tmuxPath, err := exec.LookPath("tmux")
	if err != nil {
		slog.Error("tmux not found", "error", err)
		return err
	}
	
	args := []string{"tmux", "-2", "attach-session", "-t", sessionID}
	
	syscall.Exec(tmuxPath, args, os.Environ())
	
	return nil
}

func SessionExists(sessionID string) bool {
	cmd := exec.Command("tmux", "has-session", "-t", sessionID)
	return cmd.Run() == nil
}
