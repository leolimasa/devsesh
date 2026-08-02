package cmd

import (
	"fmt"
	"io"
	"os"
	"unicode/utf8"

	"github.com/leolimasa/devsesh/internal/client"
	"github.com/spf13/cobra"
)

// maxClipboardBytes mirrors the server's cap so we can reject oversized input
// with a clear local error instead of a wasted round-trip.
const maxClipboardBytes = 256 * 1024

// NewCopyCmd builds the `devsesh copy` command: it reads stdin and bridges it to
// the devsesh web UI's clipboard buffer for the current session.
func NewCopyCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "copy",
		Short: "Send stdin to the devsesh web UI clipboard for this session",
		Long: "Reads stdin and pushes it to the devsesh web UI, which offers it for one-tap " +
			"copy to your local OS clipboard. Run inside a devsesh session, e.g. `echo hi | devsesh copy`.",
		Args: cobra.NoArgs,
		RunE: runCopy,
	}
}

func runCopy(cmd *cobra.Command, args []string) error {
	sessionID := resolveSessionID()
	if sessionID == "" {
		return fmt.Errorf("not in an active devsesh session")
	}

	body, err := io.ReadAll(os.Stdin)
	if err != nil {
		return fmt.Errorf("failed to read stdin: %w", err)
	}
	if len(body) > maxClipboardBytes {
		return fmt.Errorf("clipboard payload too large (%d bytes, max %d)", len(body), maxClipboardBytes)
	}
	if !utf8.Valid(body) {
		return fmt.Errorf("clipboard payload must be UTF-8 text")
	}

	cfg, err := client.LoadConfig()
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}
	if cfg.ServerURL == "" || cfg.JWTToken == "" {
		return fmt.Errorf("not logged in -- run `devsesh login` first")
	}

	if err := client.NewAPIClient(cfg.ServerURL, cfg.JWTToken).SendClipboard(sessionID, body); err != nil {
		return err
	}

	fmt.Printf("Copied %d bytes to the devsesh clipboard\n", len(body))
	return nil
}

// resolveSessionID finds the current session id, preferring the inherited
// DEVSESH_SESSION_ID env but falling back to the tmux session environment when
// the shell's copy is stale (a shell that predates a `devsesh watch` re-attach).
// tmux is queried via $TMUX, so this works when `devsesh copy` is launched from
// inside the session -- including by tmux's copy-command, which does not
// inherit the per-session env.
func resolveSessionID() string {
	if id := os.Getenv("DEVSESH_SESSION_ID"); id != "" {
		return id
	}
	return client.GetSessionEnvCurrent("DEVSESH_SESSION_ID")
}
