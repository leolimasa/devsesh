package client

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"
)

func isTerminal() bool {
	return os.Getenv("TERM") != "" && os.Stdin != nil
}

func TestNewOutputMonitor_NonBlocking(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	wg := &sync.WaitGroup{}

	mon := NewOutputMonitor(ctx, wg, func() {}, 50*time.Millisecond)

	n, err := mon.Write([]byte("test data"))
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if n != len("test data") {
		t.Errorf("expected %d bytes written, got %d", len("test data"), n)
	}

	cancel()
	wg.Wait()
}

func TestNewOutputMonitor_TriggersCallback(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	wg := &sync.WaitGroup{}

	var called bool
	callCh := make(chan struct{}, 1)

	mon := NewOutputMonitor(ctx, wg, func() {
		called = true
		select {
		case callCh <- struct{}{}:
		default:
		}
	}, 50*time.Millisecond)

	mon.Write([]byte("test"))

	select {
	case <-callCh:
	case <-time.After(200 * time.Millisecond):
		t.Error("callback was not called")
	}

	if !called {
		t.Error("expected callback to be called")
	}

	cancel()
	wg.Wait()
}

func TestNewOutputMonitor_Debounce(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	wg := &sync.WaitGroup{}

	var count int
	callCh := make(chan struct{}, 1)

	mon := NewOutputMonitor(ctx, wg, func() {
		count++
		select {
		case callCh <- struct{}{}:
		default:
		}
	}, 100*time.Millisecond)

	mon.Write([]byte("data1"))
	time.Sleep(20 * time.Millisecond)
	mon.Write([]byte("data2"))
	time.Sleep(20 * time.Millisecond)
	mon.Write([]byte("data3"))

	select {
	case <-callCh:
	case <-time.After(300 * time.Millisecond):
	}

	if count != 1 {
		t.Errorf("expected 1 call due to debounce, got %d", count)
	}

	cancel()
	wg.Wait()
}

func TestNewOutputMonitor_ContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	wg := &sync.WaitGroup{}

	mon := NewOutputMonitor(ctx, wg, func() {}, 50*time.Millisecond)

	cancel()
	wg.Wait()

	_, err := mon.Write([]byte("test after cancel"))
	if err != nil {
		t.Errorf("error after cancel: %v", err)
	}
}

func TestStartSession_SetsEnvVars(t *testing.T) {
	t.Skip("requires interactive terminal")
}

func TestStartSession_ConnectsStdio(t *testing.T) {
	t.Skip("requires interactive terminal")
}

func TestKillSession(t *testing.T) {
	t.Skip("requires interactive terminal")
}

func TestListSessions(t *testing.T) {
	t.Skip("requires interactive terminal")
}

func TestSessionExists_True(t *testing.T) {
	t.Skip("requires interactive terminal")
}

func TestSessionExists_False(t *testing.T) {
	if SessionExists("non-existent-session-12345") {
		t.Error("expected session to not exist")
	}
}
