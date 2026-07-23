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

func StartSession(ctx context.Context, wg *sync.WaitGroup, sessionName string, env map[string]string, onActivity func()) (*exec.Cmd, error) {
	cmd := exec.CommandContext(ctx, "tmux", "-2", "new-session", "-s", sessionName)

	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	cmd.Env = append(cmd.Env, os.Environ()...)

	cmd.Stdin = os.Stdin

	throttleInterval := 1 * time.Second
	monitor := NewOutputMonitor(ctx, wg, onActivity, throttleInterval)

	cmd.Stdout = io.MultiWriter(os.Stdout, monitor)
	cmd.Stderr = io.MultiWriter(os.Stderr, monitor)

	if err := cmd.Start(); err != nil {
		slog.Error("failed to start tmux session", "error", err, "session_name", sessionName)
		return nil, err
	}

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
