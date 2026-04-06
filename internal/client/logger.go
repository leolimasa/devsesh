package client

import (
	"log/slog"
	"os"
	"path/filepath"
)

type SessionLogger struct {
	logger *slog.Logger
	file   *os.File
}

func NewSessionLogger(sessionID, sessionsDir string) (*SessionLogger, error) {
	logPath := filepath.Join(sessionsDir, sessionID+".log")
	
	file, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return nil, err
	}
	
	logger := slog.New(slog.NewTextHandler(file, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	}))
	
	return &SessionLogger{
		logger: logger,
		file:   file,
	}, nil
}

func (l *SessionLogger) Logger() *slog.Logger {
	return l.logger
}

func (l *SessionLogger) Close() error {
	if l.file != nil {
		return l.file.Close()
	}
	return nil
}