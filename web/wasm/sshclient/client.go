package main

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"
	"syscall/js"
	"time"

	"golang.org/x/crypto/ssh"
)

// certData holds the certificate and private key for SSH authentication.
type certData struct {
	certificate string
	privateKey  string
}

// hostConn is a pooled SSH connection to a single host. Devsesh sessions on the
// same host reuse it; switching to a session on a different host activates that
// host's connection (establishing it once, then reusing it on later returns).
// Authentication therefore happens once per host, not on every session switch.
type hostConn struct {
	key        string
	client     *ssh.Client
	transport  *WSTransport
	session    *ssh.Session // current tmux-attach channel, if any
	stdin      chan []byte
	sshHost    string
	sshPort    int
	connecting bool
	connected  bool
	executing  bool
	// switching marks that the current session channel is being closed to run a
	// new command on the SAME connection (a same-host session switch), so the
	// preempted goroutine does not report an error (which would trigger a full
	// reconnect + re-auth).
	switching bool
}

var (
	// pool holds one connection per host, keyed by a caller-provided host key.
	pool = map[string]*hostConn{}
	// activeKey is the host whose session the terminal currently shows. Input,
	// resize and (gated) output route to this connection.
	activeKey string

	// Last terminal size pushed from JS. New ptys open at this size so tmux
	// draws full-size immediately on attach/session-switch instead of rendering
	// at the default 24x80 and then jumping (the small-then-grow flash). Seeded
	// with the SSH defaults until the first resize arrives. Guarded by mu.
	lastRows = 24
	lastCols = 80

	passwordCallback       js.Value
	outputCallback         js.Value
	statusCallback         js.Value
	certificateCallback    js.Value
	certAuthFailedCallback js.Value
	passwordResolver       chan string
	passwordRejecter       chan struct{}
	certResolver           chan certData
	certRejecter           chan struct{}
	mu                     sync.Mutex // guards pool, activeKey and hostConn fields
	connectMu              sync.Mutex // serializes handshakes (auth resolvers are global)
	lastCertPrincipals     []string
)

func updateStatus(status string, errorMsg ...string) {
	if !statusCallback.IsNull() && !statusCallback.IsUndefined() {
		if len(errorMsg) > 0 && errorMsg[0] != "" {
			statusCallback.Invoke(status, errorMsg[0])
		} else {
			statusCallback.Invoke(status)
		}
	}
}

// emitStatus reports a status change only for the currently active host — the
// terminal reflects the active connection, so a background host's transitions
// must not clobber the visible status.
func emitStatus(key, status string, errorMsg ...string) {
	mu.Lock()
	isActive := key == activeKey
	mu.Unlock()
	if isActive {
		updateStatus(status, errorMsg...)
	}
}

// parseCertificateAndKey parses an OpenSSH certificate and Ed25519 private key,
// returning a Signer that can be used for SSH authentication.
// certStr: base64-encoded certificate wire format
// privateKeyStr: base64-encoded Ed25519 private key seed (32 bytes)
func parseCertificateAndKey(certStr string, privateKeyStr string) (ssh.Signer, error) {
	// Parse certificate
	certStr = strings.TrimSpace(certStr)
	privateKeyStr = strings.TrimSpace(privateKeyStr)

	js.Global().Get("console").Call("log", "[SSH WASM] Parsing certificate, base64 len:", len(certStr))

	var certBytes []byte
	var err error

	// If it looks like an authorized keys line, parse it
	if strings.HasPrefix(certStr, "ssh-") {
		parts := strings.Fields(certStr)
		if len(parts) < 2 {
			return nil, fmt.Errorf("invalid certificate format")
		}
		certBytes, err = base64.StdEncoding.DecodeString(parts[1])
		if err != nil {
			return nil, fmt.Errorf("failed to decode certificate: %w", err)
		}
	} else {
		// Assume it's just base64 data
		certBytes, err = base64.StdEncoding.DecodeString(certStr)
		if err != nil {
			return nil, fmt.Errorf("failed to decode certificate: %w", err)
		}
	}

	// Debug: log certificate bytes
	if len(certBytes) >= 8 {
		js.Global().Get("console").Call("log",
			"[SSH WASM] Certificate bytes len:", len(certBytes),
			"first_8:", fmt.Sprintf("%x", certBytes[:8]),
			"last_8:", fmt.Sprintf("%x", certBytes[len(certBytes)-8:]))
	}

	// Parse the certificate
	pubKey, err := ssh.ParsePublicKey(certBytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse certificate: %w", err)
	}

	cert, ok := pubKey.(*ssh.Certificate)
	if !ok {
		return nil, fmt.Errorf("key is not a certificate")
	}

	// Store the principals for use in error messages
	lastCertPrincipals = cert.ValidPrincipals

	// Debug: log parsed certificate details including signature and signature key
	if cert.Signature != nil && len(cert.Signature.Blob) >= 8 {
		js.Global().Get("console").Call("log",
			"[SSH WASM] Parsed cert signature:",
			"format:", cert.Signature.Format,
			"sig_len:", len(cert.Signature.Blob),
			"sig_first_8:", fmt.Sprintf("%x", cert.Signature.Blob[:8]),
			"sig_last_8:", fmt.Sprintf("%x", cert.Signature.Blob[len(cert.Signature.Blob)-8:]))
	}
	// Log the certificate's signature key (CA public key)
	sigKeyBytes := cert.SignatureKey.Marshal()
	js.Global().Get("console").Call("log",
		"[SSH WASM] Certificate signature key (CA):",
		"type:", cert.SignatureKey.Type(),
		"key_bytes:", fmt.Sprintf("%x", sigKeyBytes))

	// Parse private key
	privateKeyBytes, err := base64.StdEncoding.DecodeString(privateKeyStr)
	if err != nil {
		return nil, fmt.Errorf("failed to decode private key: %w", err)
	}

	// Ed25519 private key is 32 bytes seed or 64 bytes (seed + public key)
	var privateKey ed25519.PrivateKey
	if len(privateKeyBytes) == 32 {
		// Seed format - derive full key
		privateKey = ed25519.NewKeyFromSeed(privateKeyBytes)
	} else if len(privateKeyBytes) == 64 {
		// Full key format
		privateKey = privateKeyBytes
	} else {
		return nil, fmt.Errorf("invalid private key length: %d (expected 32 or 64)", len(privateKeyBytes))
	}

	// Create SSH signer from private key
	signer, err := ssh.NewSignerFromKey(privateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to create signer: %w", err)
	}

	// Create certificate signer that combines the certificate with the private key
	certSigner, err := ssh.NewCertSigner(cert, signer)
	if err != nil {
		return nil, fmt.Errorf("failed to create certificate signer: %w", err)
	}

	// Debug: verify the private key matches the certificate's public key
	derivedPubKey := privateKey.Public().(ed25519.PublicKey)
	certPubKey := cert.Key.(ssh.CryptoPublicKey).CryptoPublicKey().(ed25519.PublicKey)
	if !bytes.Equal(derivedPubKey, certPubKey) {
		js.Global().Get("console").Call("error", "[SSH WASM] Private key DOES NOT match certificate public key!")
		js.Global().Get("console").Call("error", fmt.Sprintf("[SSH WASM] Derived pub:  %x", derivedPubKey[:8]))
		js.Global().Get("console").Call("error", fmt.Sprintf("[SSH WASM] Cert pub key: %x", certPubKey[:8]))
		return nil, fmt.Errorf("private key does not match certificate public key")
	}
	js.Global().Get("console").Call("log", "[SSH WASM] Private key matches certificate public key")

	return certSigner, nil
}

// Connect activates (or establishes) a pooled SSH connection for a host.
// Args: [hostKey, wsURL, user, token]. If a live connection for hostKey already
// exists it is simply made active — no reconnect and no re-authentication.
func Connect(this js.Value, args []js.Value) interface{} {
	key := args[0].String()
	wsURL := args[1].String()
	user := args[2].String()
	token := args[3].String()

	mu.Lock()
	if c, ok := pool[key]; ok && (c.connected || c.connecting) {
		// Reuse: just make this host active. No reconnect, no re-auth.
		activeKey = key
		wasConnected := c.connected
		mu.Unlock()
		if wasConnected {
			updateStatus("connected")
		} else {
			updateStatus("connecting")
		}
		return nil
	}
	c := &hostConn{key: key, connecting: true}
	pool[key] = c
	activeKey = key
	mu.Unlock()

	go func() {
		defer func() {
			if r := recover(); r != nil {
				js.Global().Get("console").Call("error", "[SSH WASM] PANIC in Connect goroutine:", fmt.Sprint(r))
			}
		}()

		// Serialize handshakes: the cert/password resolvers are global.
		connectMu.Lock()
		defer connectMu.Unlock()

		emitStatus(key, "connecting")

		transport, err := NewWSTransportWithAuth(wsURL, token)
		if err != nil {
			mu.Lock()
			c.connecting = false
			mu.Unlock()
			emitStatus(key, "error", err.Error())
			return
		}

		host, port, err := transport.WaitForConnected()
		if err != nil {
			transport.Close()
			mu.Lock()
			c.connecting = false
			mu.Unlock()
			emitStatus(key, "error", "failed to get connection info: "+err.Error())
			return
		}

		mu.Lock()
		c.transport = transport
		c.sshHost = host
		c.sshPort = port
		mu.Unlock()

		addr := net.JoinHostPort(host, strconv.Itoa(port))

		emitStatus(key, "authenticating")

		// Build auth methods - certificate first if available, then password fallback
		var authMethods []ssh.AuthMethod

		// Try to get certificate if callback is set
		if !certificateCallback.IsNull() && !certificateCallback.IsUndefined() {
			certResolver = make(chan certData, 1)
			certRejecter = make(chan struct{}, 1)

			// Request certificate from JavaScript
			certificateCallback.Invoke()

			// Wait for certificate or rejection with timeout
			select {
			case data := <-certResolver:
				if data.certificate != "" && data.privateKey != "" {
					signer, err := parseCertificateAndKey(data.certificate, data.privateKey)
					if err != nil {
						js.Global().Get("console").Call("warn", "[SSH WASM] Certificate parse error:", err.Error())
					} else {
						// Certificate auth is the primary method
						authMethods = append(authMethods, ssh.PublicKeys(signer))
						js.Global().Get("console").Call("log", "[SSH WASM] Certificate auth method added")
					}
				}
			case <-certRejecter:
				js.Global().Get("console").Call("log", "[SSH WASM] Certificate auth rejected, using password")
			case <-time.After(60 * time.Second):
				js.Global().Get("console").Call("warn", "[SSH WASM] Certificate callback timeout, falling back to password")
			}
		}

		// Password callback as fallback (or primary if no certificate)
		// Track whether we added certificate auth
		hadCertAuth := len(authMethods) > 0
		authMethods = append(authMethods, ssh.PasswordCallback(func() (string, error) {
			// If we had certificate auth, this means it was rejected by the server
			if hadCertAuth {
				// SSH protocol doesn't expose the specific rejection reason during auth method fallback.
				// Common reasons for certificate rejection:
				// - CA public key not in TrustedUserCAKeys
				// - Certificate principal doesn't match AuthorizedPrincipalsFile or allowed users
				// - Certificate has expired (valid_after/valid_before)
				// - Certificate type mismatch (user cert vs host cert)
				principals := strings.Join(lastCertPrincipals, ", ")
				if principals == "" {
					principals = "(none)"
				}
				msg := fmt.Sprintf("SSH certificate authentication failed. The server rejected the certificate and is falling back to password authentication.\n\nHost: %s:%d\nCertificate principals: %s\n\nTo debug, check the SSH server logs (usually /var/log/auth.log or journalctl -u sshd) for the specific rejection reason.", host, port, principals)
				js.Global().Get("console").Call("warn", "[SSH WASM] Certificate auth rejected:", msg)
				// Notify JavaScript that certificate auth failed
				if !certAuthFailedCallback.IsNull() && !certAuthFailedCallback.IsUndefined() {
					certAuthFailedCallback.Invoke(msg)
				}
			}

			passwordResolver = make(chan string, 1)
			passwordRejecter = make(chan struct{}, 1)

			if !passwordCallback.IsNull() && !passwordCallback.IsUndefined() {
				passwordCallback.Invoke()
			}

			select {
			case pwd := <-passwordResolver:
				return pwd, nil
			case <-passwordRejecter:
				return "", fmt.Errorf("authentication cancelled")
			}
		}))

		config := &ssh.ClientConfig{
			User:            user,
			Auth:            authMethods,
			HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		}

		// Use ssh.NewClientConn with WebSocket transport instead of ssh.Dial
		js.Global().Get("console").Call("log", "[SSH WASM] Starting SSH handshake with cert auth...")
		js.Global().Get("console").Call("log", "[SSH WASM] Auth methods count:", len(authMethods))
		conn, chans, reqs, err := ssh.NewClientConn(transport, addr, config)
		if err != nil {
			js.Global().Get("console").Call("error", "[SSH WASM] SSH connection failed:", err.Error())
			if strings.Contains(err.Error(), "unable to authenticate") ||
				strings.Contains(err.Error(), "ssh") {
				js.Global().Get("console").Call("error", "[SSH WASM] Certificate auth likely rejected by server")
			}
			transport.Close()
			mu.Lock()
			c.connecting = false
			mu.Unlock()
			emitStatus(key, "error", err.Error())
			return
		}
		js.Global().Get("console").Call("log", "[SSH WASM] SSH connection established successfully!")

		client := ssh.NewClient(conn, chans, reqs)

		mu.Lock()
		c.client = client
		c.connected = true
		c.connecting = false
		mu.Unlock()

		startKeepalive(c, client)
		emitStatus(key, "connected")
	}()

	return nil
}

// startKeepalive periodically probes a connection with an SSH keepalive request.
// A healthy sshd replies (even with a request-failure), proving the link is
// alive; on a silently dead / half-open socket — where the browser never fires
// onclose/offline — no reply arrives, so we tear the pooled connection down and
// report an error, which drives a reconnect.
func startKeepalive(c *hostConn, client *ssh.Client) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				js.Global().Get("console").Call("error", "[SSH WASM] PANIC in keepalive:", fmt.Sprint(r))
			}
		}()

		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()

		for range ticker.C {
			mu.Lock()
			current := c.client == client
			key := c.key
			mu.Unlock()
			if !current {
				return // this connection was replaced or closed
			}

			// SendRequest blocks until a reply or a transport error; bound it so
			// a half-open socket (no reply, no error) is still detected.
			done := make(chan error, 1)
			go func() {
				_, _, err := client.SendRequest("keepalive@openssh.com", true, nil)
				done <- err
			}()

			var kaErr error
			select {
			case kaErr = <-done:
			case <-time.After(10 * time.Second):
				kaErr = fmt.Errorf("keepalive timeout")
			}
			if kaErr == nil {
				continue
			}

			// Dead connection: tear it down so the next Connect re-handshakes,
			// and report the error (for the active host) to trigger reconnect.
			mu.Lock()
			if c.client == client {
				c.connected = false
				c.client = nil
				if c.transport != nil {
					c.transport.Close()
					c.transport = nil
				}
			}
			mu.Unlock()
			client.Close()
			emitStatus(key, "error", "connection lost (keepalive failed)")
			return
		}
	}()
}

// closeConn tears down a hostConn's channel/client/transport. Caller holds mu.
func closeConn(c *hostConn) {
	if c.stdin != nil {
		close(c.stdin)
		c.stdin = nil
	}
	if c.session != nil {
		c.session.Close()
		c.session = nil
	}
	if c.client != nil {
		c.client.Close()
		c.client = nil
	}
	if c.transport != nil {
		c.transport.Close()
		c.transport = nil
	}
	c.connected = false
	c.connecting = false
}

// Disconnect tears down a single host's pooled connection. Args: [hostKey].
func Disconnect(this js.Value, args []js.Value) interface{} {
	key := args[0].String()

	mu.Lock()
	if c, ok := pool[key]; ok {
		closeConn(c)
		delete(pool, key)
	}
	wasActive := key == activeKey
	if wasActive {
		activeKey = ""
	}
	mu.Unlock()

	if wasActive {
		updateStatus("disconnected")
	}
	return nil
}

// DisconnectAll tears down every pooled connection (e.g. on page unmount).
func DisconnectAll(this js.Value, args []js.Value) interface{} {
	mu.Lock()
	for k, c := range pool {
		closeConn(c)
		delete(pool, k)
	}
	activeKey = ""
	mu.Unlock()

	updateStatus("disconnected")
	return nil
}

// Exec runs a command (a tmux attach) on a host's pooled connection. Args:
// [hostKey, command]. If that host already has a session running, it is
// preempted so the new command attaches on the SAME connection.
func Exec(this js.Value, args []js.Value) interface{} {
	key := args[0].String()
	command := args[1].String()

	go func() {
		defer func() {
			if r := recover(); r != nil {
				js.Global().Get("console").Call("error", "[SSH WASM] PANIC in Exec goroutine:", fmt.Sprint(r))
			}
		}()

		mu.Lock()
		c := pool[key]
		mu.Unlock()
		if c == nil {
			emitStatus(key, "error", "not connected")
			return
		}

		// Preempt any in-flight session on THIS host so the new command attaches
		// on the same, already-authenticated connection.
		mu.Lock()
		if c.executing && c.session != nil {
			c.switching = true
			c.session.Close()
		}
		mu.Unlock()

		// Wait (bounded) for the preempted goroutine to release `executing`.
		for i := 0; i < 300; i++ {
			mu.Lock()
			busy := c.executing
			mu.Unlock()
			if !busy {
				break
			}
			time.Sleep(10 * time.Millisecond)
		}

		mu.Lock()
		if c.executing {
			// Previous session never released; don't run two at once.
			mu.Unlock()
			return
		}
		if c.client == nil {
			mu.Unlock()
			emitStatus(key, "error", "not connected")
			return
		}
		c.executing = true
		mu.Unlock()

		defer func() {
			mu.Lock()
			c.executing = false
			mu.Unlock()
		}()

		// Start the output handler goroutine before setting up the session
		startOutputHandler()

		mu.Lock()
		session, err := c.client.NewSession()
		if err != nil {
			mu.Unlock()
			emitStatus(key, "error", "failed to create session: "+err.Error())
			return
		}

		modes := ssh.TerminalModes{
			ssh.ECHO:          1,
			ssh.TTY_OP_ISPEED: 115200,
			ssh.TTY_OP_OSPEED: 115200,
		}

		// mu is already held here (see the Lock above); read the last-known size
		// directly so the new pty opens at the terminal's real dimensions.
		err = session.RequestPty("xterm-256color", lastRows, lastCols, modes)
		if err != nil {
			session.Close()
			mu.Unlock()
			emitStatus(key, "error", "failed to request PTY: "+err.Error())
			return
		}

		stdin, err := session.StdinPipe()
		if err != nil {
			session.Close()
			mu.Unlock()
			emitStatus(key, "error", "failed to get stdin pipe: "+err.Error())
			return
		}

		c.stdin = make(chan []byte, 100)
		c.session = session
		stdinCh := c.stdin
		mu.Unlock()

		// Stdin writer goroutine
		go func() {
			defer func() {
				if r := recover(); r != nil {
					js.Global().Get("console").Call("error", "[SSH WASM] PANIC in stdin writer:", fmt.Sprint(r))
				}
			}()
			for data := range stdinCh {
				stdin.Write(data)
			}
		}()

		session.Stdout = &outputWriter{key: key}
		session.Stderr = &outputWriter{key: key}

		err = session.Start(command)
		if err != nil {
			emitStatus(key, "error", "failed to start command: "+err.Error())
			return
		}

		err = session.Wait()

		mu.Lock()
		// A preempted (switching) close is intentional — swallow its error.
		wasSwitching := c.switching
		c.switching = false
		if c.stdin != nil {
			close(c.stdin)
			c.stdin = nil
		}
		c.session = nil
		mu.Unlock()

		if err != nil && !wasSwitching {
			// Don't report error for normal exit
			if _, ok := err.(*ssh.ExitError); !ok {
				// A non-exit session failure means the underlying connection is
				// almost certainly gone (e.g. a network drop). Tear this host's
				// pooled connection down so the next Connect() re-handshakes
				// instead of reusing a dead/zombie client (which would otherwise
				// leave the terminal wedged at "connecting").
				mu.Lock()
				c.connected = false
				if c.client != nil {
					c.client.Close()
					c.client = nil
				}
				if c.transport != nil {
					c.transport.Close()
					c.transport = nil
				}
				mu.Unlock()
				emitStatus(key, "error", "session error: "+err.Error())
			}
		}
	}()

	return nil
}

// outputChannel is used to decouple SSH output from JavaScript callback invocation.
// This prevents issues with Go WASM when invoking JS from within SSH I/O goroutines.
var outputChannel chan string

// startOutputHandler starts a goroutine that reads from outputChannel and invokes the JS callback.
// This must be called before any output is expected.
func startOutputHandler() {
	if outputChannel != nil {
		return // Already started
	}
	outputChannel = make(chan string, 100)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				js.Global().Get("console").Call("error", "[SSH WASM] PANIC in output handler:", fmt.Sprint(r))
			}
		}()
		for data := range outputChannel {
			if outputCallback.IsNull() || outputCallback.IsUndefined() {
				continue
			}
			func() {
				defer func() {
					if r := recover(); r != nil {
						js.Global().Get("console").Call("error", "[SSH WASM] PANIC invoking output callback:", fmt.Sprint(r))
					}
				}()
				outputCallback.Invoke(data)
			}()
		}
	}()
}

// outputWriter forwards a session's output to the JS callback, but only while
// its host is the active one — output from a backgrounded host is dropped.
type outputWriter struct {
	key string
}

func (w *outputWriter) Write(p []byte) (int, error) {
	mu.Lock()
	isActive := w.key == activeKey
	mu.Unlock()
	if !isActive {
		return len(p), nil
	}
	// Send data to the output channel instead of invoking JS directly.
	// This avoids calling JS from within SSH I/O goroutines which can crash WASM.
	if outputChannel != nil {
		select {
		case outputChannel <- string(p):
		default:
			js.Global().Get("console").Call("warn", "[SSH WASM] Output channel full, dropping data")
		}
	}
	return len(p), nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func SendInput(this js.Value, args []js.Value) interface{} {
	defer func() {
		if r := recover(); r != nil {
			js.Global().Get("console").Call("error", "[SSH WASM] SendInput PANIC:", fmt.Sprint(r))
		}
	}()

	data := args[0]

	var buf []byte
	if data.IsNull() || data.IsUndefined() {
		return nil
	}

	// Check if it's a typed array (Uint8Array) or a string
	// We need to check the type before calling .Get() since strings don't have properties
	if data.Type() == js.TypeObject && data.Get("constructor").Get("name").String() == "Uint8Array" {
		length := data.Get("length").Int()
		buf = make([]byte, length)
		js.CopyBytesToGo(buf, data)
	} else {
		// It's a string or other primitive - convert to string then to bytes
		str := data.String()
		buf = []byte(str)
	}

	// Route input to the active connection's session. Non-blocking so a full
	// buffer (or a mid-switch nil channel) never blocks while holding mu.
	mu.Lock()
	if c := pool[activeKey]; c != nil && c.stdin != nil {
		select {
		case c.stdin <- buf:
		default:
		}
	}
	mu.Unlock()

	return nil
}

func Resize(this js.Value, args []js.Value) interface{} {
	rows := args[0].Int()
	cols := args[1].Int()

	mu.Lock()
	defer mu.Unlock()

	// Remember the size (even if no session is active yet) so the next pty opens
	// at these dimensions and tmux draws full-size on attach — no small-then-grow.
	if rows > 0 && cols > 0 {
		lastRows, lastCols = rows, cols
	}

	if c := pool[activeKey]; c != nil && c.session != nil {
		c.session.WindowChange(rows, cols)
	}

	return nil
}

func SetPasswordCallback(this js.Value, args []js.Value) interface{} {
	passwordCallback = args[0]
	return nil
}

func SetOutputCallback(this js.Value, args []js.Value) interface{} {
	outputCallback = args[0]
	return nil
}

func SetStatusCallback(this js.Value, args []js.Value) interface{} {
	statusCallback = args[0]
	return nil
}

func ResolvePassword(this js.Value, args []js.Value) interface{} {
	password := args[0].String()
	if passwordResolver != nil {
		select {
		case passwordResolver <- password:
		default:
		}
	}
	return nil
}

func RejectPassword(this js.Value, args []js.Value) interface{} {
	if passwordRejecter != nil {
		select {
		case passwordRejecter <- struct{}{}:
		default:
		}
	}
	return nil
}

// SetCertificateCallback sets the callback function that will be invoked when
// certificate-based authentication is available. The callback should trigger
// a certificate request flow and then call sshResolveCertificate with the
// base64-encoded certificate, or sshRejectCertificate to skip certificate auth.
func SetCertificateCallback(this js.Value, args []js.Value) interface{} {
	certificateCallback = args[0]
	return nil
}

// SetCertAuthFailedCallback sets the callback function that will be invoked when
// certificate authentication is rejected by the server. This allows the UI to
// display an error message before falling back to password authentication.
func SetCertAuthFailedCallback(this js.Value, args []js.Value) interface{} {
	certAuthFailedCallback = args[0]
	return nil
}

// ResolveCertificate is called by JavaScript to provide a certificate and
// private key for SSH authentication.
// Args:
//   - args[0]: base64-encoded SSH certificate (wire format)
//   - args[1]: base64-encoded Ed25519 private key seed (32 bytes)
func ResolveCertificate(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		js.Global().Get("console").Call("error", "[SSH WASM] ResolveCertificate requires 2 arguments: certificate, privateKey")
		return nil
	}
	cert := args[0].String()
	privateKey := args[1].String()
	if certResolver != nil {
		select {
		case certResolver <- certData{certificate: cert, privateKey: privateKey}:
		default:
		}
	}
	return nil
}

// RejectCertificate is called by JavaScript to indicate that certificate auth
// should be skipped, falling back to password authentication.
func RejectCertificate(this js.Value, args []js.Value) interface{} {
	if certRejecter != nil {
		select {
		case certRejecter <- struct{}{}:
		default:
		}
	}
	return nil
}
