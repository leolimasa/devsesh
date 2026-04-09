package cmd

import (
	"fmt"
	"os"

	"github.com/leolimasa/devsesh/internal/client"
	"github.com/spf13/cobra"
)

func NewLoginCmd() *cobra.Command {
	var cmd = &cobra.Command{
		Use:   "login [url]",
		Short: "Login to the devsesh server",
		Args:  cobra.ExactArgs(1),
		RunE:  runLogin,
	}
	return cmd
}

func runLogin(cmd *cobra.Command, args []string) error {
	serverURL := args[0]

	fmt.Printf("Requesting pairing code from %s...\n", serverURL)

	apiClient := client.NewAPIClient(serverURL, "")

	code, err := apiClient.RequestPairingCode()
	if err != nil {
		return fmt.Errorf("failed to get pairing code: %w", err)
	}

	fmt.Printf("\nPairing code: %s\n\n", code)
	fmt.Printf("Please visit %s/pair and enter this pairing code.\n\n", serverURL)
	fmt.Println("Waiting for server response...")
	token, err := apiClient.PollForJWT(code, 10*60*1000*1000*1000)
	if err != nil {
		return fmt.Errorf("failed to get JWT: %w", err)
	}

	cfg := client.ClientConfig{
		ServerURL:   serverURL,
		JWTToken:    token,
		SessionsDir: os.Getenv("DEVSESH_SESSIONS_DIR"),
	}

	if err := client.SaveConfig(cfg); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	fmt.Println("\nLogin successful!")
	return nil
}

func NewAPIClient(serverURL, token string) *client.APIClient {
	return client.NewAPIClient(serverURL, token)
}
