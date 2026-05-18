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

var (
	currentClient       *ssh.Client
	currentSession      *ssh.Session
	currentTransport    *WSTransport
	currentStdin        chan []byte
	passwordCallback    js.Value
	outputCallback      js.Value
	statusCallback      js.Value
	certificateCallback js.Value
	passwordResolver    chan string
	passwordRejecter    chan struct{}
	certResolver        chan certData
	certRejecter        chan struct{}
	mu                  sync.Mutex
	connected           bool
	executing           bool
	sshHost             string
	sshPort             int
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

// Connect initiates an SSH connection with certificate or password authentication.
// If a certificate callback is set and returns a valid certificate, it will be
// tried first before falling back to password authentication.
func Connect(this js.Value, args []js.Value) interface{} {
	wsURL := args[0].String()
	user := args[1].String()
	token := args[2].String()

	go func() {
		defer func() {
			if r := recover(); r != nil {
				js.Global().Get("console").Call("error", "[SSH WASM] PANIC in Connect goroutine:", fmt.Sprint(r))
			}
		}()
		updateStatus("connecting")

		transport, err := NewWSTransportWithAuth(wsURL, token)
		if err != nil {
			updateStatus("error", err.Error())
			return
		}

		host, port, err := transport.WaitForConnected()
		if err != nil {
			transport.Close()
			updateStatus("error", "failed to get connection info: "+err.Error())
			return
		}

		mu.Lock()
		sshHost = host
		sshPort = port
		currentTransport = transport
		mu.Unlock()

		addr := net.JoinHostPort(host, strconv.Itoa(port))

		updateStatus("authenticating")

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
		authMethods = append(authMethods, ssh.PasswordCallback(func() (string, error) {
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
			// Check if error contains details about auth failure
			if strings.Contains(err.Error(), "unable to authenticate") ||
				strings.Contains(err.Error(), "ssh") {
				js.Global().Get("console").Call("error", "[SSH WASM] Certificate auth likely rejected by server")
			}
			transport.Close()
			updateStatus("error", err.Error())
			return
		}
		js.Global().Get("console").Call("log", "[SSH WASM] SSH connection established successfully!")

		client := ssh.NewClient(conn, chans, reqs)

		mu.Lock()
		currentClient = client
		connected = true
		mu.Unlock()

		updateStatus("connected")
	}()

	return nil
}

func Disconnect(this js.Value, args []js.Value) interface{} {
	mu.Lock()
	defer mu.Unlock()

	if currentStdin != nil {
		close(currentStdin)
		currentStdin = nil
	}
	if currentSession != nil {
		currentSession.Close()
		currentSession = nil
	}
	if currentClient != nil {
		currentClient.Close()
		currentClient = nil
	}
	if currentTransport != nil {
		currentTransport.Close()
		currentTransport = nil
	}
	connected = false

	updateStatus("disconnected")

	return nil
}

func Exec(this js.Value, args []js.Value) interface{} {
	command := args[0].String()

	mu.Lock()
	if executing {
		mu.Unlock()
		return nil
	}
	executing = true
	mu.Unlock()

	go func() {
		defer func() {
			if r := recover(); r != nil {
				js.Global().Get("console").Call("error", "[SSH WASM] PANIC in Exec goroutine:", fmt.Sprint(r))
			}
			mu.Lock()
			executing = false
			mu.Unlock()
		}()

		// Start the output handler goroutine before setting up the session
		startOutputHandler()

		mu.Lock()
		if currentClient == nil {
			mu.Unlock()
			updateStatus("error", "not connected")
			return
		}

		session, err := currentClient.NewSession()
		if err != nil {
			mu.Unlock()
			updateStatus("error", "failed to create session: "+err.Error())
			return
		}

		modes := ssh.TerminalModes{
			ssh.ECHO:          1,
			ssh.TTY_OP_ISPEED: 115200,
			ssh.TTY_OP_OSPEED: 115200,
		}

		err = session.RequestPty("xterm-256color", 24, 80, modes)
		if err != nil {
			session.Close()
			mu.Unlock()
			updateStatus("error", "failed to request PTY: "+err.Error())
			return
		}

		stdin, err := session.StdinPipe()
		if err != nil {
			session.Close()
			mu.Unlock()
			updateStatus("error", "failed to get stdin pipe: "+err.Error())
			return
		}

		currentStdin = make(chan []byte, 100)
		currentSession = session
		mu.Unlock()

		// Stdin writer goroutine
		go func() {
			defer func() {
				if r := recover(); r != nil {
					js.Global().Get("console").Call("error", "[SSH WASM] PANIC in stdin writer:", fmt.Sprint(r))
				}
			}()
			for data := range currentStdin {
				stdin.Write(data)
			}
		}()

		session.Stdout = &outputWriter{callback: outputCallback}
		session.Stderr = &outputWriter{callback: outputCallback}

		err = session.Start(command)
		if err != nil {
			updateStatus("error", "failed to start command: "+err.Error())
			return
		}

		err = session.Wait()
		if err != nil {
			// Don't report error for normal exit
			if _, ok := err.(*ssh.ExitError); !ok {
				updateStatus("error", "session error: "+err.Error())
			}
		}

		mu.Lock()
		if currentStdin != nil {
			close(currentStdin)
			currentStdin = nil
		}
		currentSession = nil
		mu.Unlock()
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

type outputWriter struct {
	callback js.Value
}

func (w *outputWriter) Write(p []byte) (int, error) {
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

	mu.Lock()
	if currentStdin != nil {
		currentStdin <- buf
	}
	mu.Unlock()

	return nil
}

func Resize(this js.Value, args []js.Value) interface{} {
	rows := args[0].Int()
	cols := args[1].Int()

	mu.Lock()
	defer mu.Unlock()

	if currentSession != nil {
		currentSession.WindowChange(rows, cols)
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
