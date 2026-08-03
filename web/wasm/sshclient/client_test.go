package main

import (
	"fmt"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

// TestOpenPTYSessionDoesNotHoldMuDuringBlockingCall reproduces the "whole PWA
// freezes" bug. The SSH client runs as wasm on the main thread, so a blocking
// SSH channel-open (NewSession / RequestPty are network round-trips) must NOT
// run while holding the global mu: SendInput and Resize — invoked synchronously
// from JS keydown/resize handlers — also take mu, so if it were held the event
// loop would block, the WebSocket onmessage carrying the round-trip reply could
// never be delivered, and mu would never be released → permanent main-thread
// deadlock (frozen app, must restart the PWA). This asserts mu is free while the
// blocking call runs. The buggy version held mu across NewSession → fails here.
func TestOpenPTYSessionDoesNotHoldMuDuringBlockingCall(t *testing.T) {
	orig := sshNewSession
	defer func() { sshNewSession = orig }()

	muHeldDuringBlock := false
	called := false
	sshNewSession = func(_ *ssh.Client) (*ssh.Session, error) {
		called = true
		if mu.TryLock() {
			mu.Unlock()
		} else {
			muHeldDuringBlock = true
		}
		// Stop before RequestPty, which would touch a real *ssh.Session.
		return nil, fmt.Errorf("stub: stop before RequestPty")
	}

	c := &hostConn{key: "h", connected: true, client: &ssh.Client{}}
	if _, _, _, err := openPTYSession(c); err == nil {
		t.Fatal("expected the stub error from sshNewSession")
	}
	if !called {
		t.Fatal("sshNewSession was never called")
	}
	if muHeldDuringBlock {
		t.Fatal("mu was held across the blocking SSH NewSession call — wasm main-thread deadlock risk (whole PWA freezes)")
	}
}

// TestCanReuse reproduces the "stuck on connecting" bug at the pool-reuse
// decision level. The old condition reused any entry with connecting==true, so
// a handshake wedged by an iOS background freeze was reused forever — the
// terminal never re-handshaked, never re-authenticated, and never prompted to
// unlock the master key again. canReuse must treat a stale "connecting" entry
// as NOT reusable so Connect tears it down and starts a fresh handshake.
func TestCanReuse(t *testing.T) {
	now := time.Now()

	cases := []struct {
		name string
		c    *hostConn
		want bool
	}{
		{"connected is reusable", &hostConn{connected: true}, true},
		{
			"fresh in-flight connecting is reusable",
			&hostConn{connecting: true, connectingSince: now},
			true,
		},
		{
			"connecting still within the stale cushion is reusable",
			&hostConn{connecting: true, connectingSince: now.Add(-30 * time.Second)},
			true,
		},
		{
			// The bug: a wedged connecting entry (frozen mid-handshake) used to
			// be reused indefinitely, pinning the UI at "connecting".
			"stale wedged connecting is NOT reusable",
			&hostConn{connecting: true, connectingSince: now.Add(-connectStaleAfter - time.Second)},
			false,
		},
		{"dead entry is NOT reusable", &hostConn{}, false},
	}

	for _, tc := range cases {
		if got := canReuse(tc.c, now); got != tc.want {
			t.Errorf("%s: canReuse = %v, want %v", tc.name, got, tc.want)
		}
	}
}
