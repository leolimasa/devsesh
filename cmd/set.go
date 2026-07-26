package cmd

import (
	"fmt"
	"os"

	"github.com/leolimasa/devsesh/internal/client"
	"github.com/spf13/cobra"
)

func NewSetCmd() *cobra.Command {
	var cmd = &cobra.Command{
		Use:   "set [key] [value]",
		Short: "Set a key-value pair in the session file",
		Args:  cobra.ExactArgs(2),
		RunE:  runSet,
	}
	return cmd
}

func runSet(cmd *cobra.Command, args []string) error {
	sessionFile := resolveSessionFile()
	if sessionFile == "" {
		return fmt.Errorf("not in an active devsesh session")
	}
	if _, err := os.Stat(sessionFile); err != nil {
		return fmt.Errorf("session file %s not found -- is `devsesh watch` running for this session?", sessionFile)
	}

	key := args[0]
	value := args[1]

	if err := client.UpdateSessionFile(sessionFile, key, value); err != nil {
		return fmt.Errorf("failed to update session file: %w", err)
	}

	fmt.Printf("Set %s = %s\n", key, value)
	return nil
}

// resolveSessionFile locates the current session's metadata file. It prefers
// the DEVSESH_SESSION_FILE the launching shell inherited, but falls back to the
// tmux session environment when that is empty or points at a file that no
// longer exists: a shell that was already running when `devsesh watch`
// (re)attached keeps a stale copy that tmux set-environment can't fix in place.
func resolveSessionFile() string {
	if f := os.Getenv("DEVSESH_SESSION_FILE"); f != "" {
		if _, err := os.Stat(f); err == nil {
			return f
		}
	}
	return client.GetSessionEnvCurrent("DEVSESH_SESSION_FILE")
}
