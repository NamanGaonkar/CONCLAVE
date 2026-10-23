package store

import (
	"encoding/json"
	"os"
	"path/filepath"

	"conclave/pkg/gitops"
)

// SaveSessions persists active worktree sessions to sessions.json in configDir.
func SaveSessions(configDir string, sessions []*gitops.WorktreeSession) error {
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return err
	}
	filePath := filepath.Join(configDir, "sessions.json")
	data, err := json.MarshalIndent(sessions, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filePath, data, 0644)
}

// LoadSessions retrieves saved worktree sessions from sessions.json.
func LoadSessions(configDir string) ([]*gitops.WorktreeSession, error) {
	filePath := filepath.Join(configDir, "sessions.json")
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return nil, nil
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}

	var sessions []*gitops.WorktreeSession
	if err := json.Unmarshal(data, &sessions); err != nil {
		return nil, err
	}
	return sessions, nil
}
