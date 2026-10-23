package store

import (
	"os"
	"path/filepath"
)

// AppDataDir returns the path to %APPDATA%\Conclave, creating it if needed.
func AppDataDir() (string, error) {
	base := os.Getenv("APPDATA")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, "AppData", "Roaming")
	}
	dir := filepath.Join(base, "Conclave")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return dir, nil
}

// LogsDir returns %APPDATA%\Conclave\logs, creating it if needed.
func LogsDir() (string, error) {
	appDir, err := AppDataDir()
	if err != nil {
		return "", err
	}
	logs := filepath.Join(appDir, "logs")
	if err := os.MkdirAll(logs, 0755); err != nil {
		return "", err
	}
	return logs, nil
}
