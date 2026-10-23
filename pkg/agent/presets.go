package agent

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// DefaultPresets returns the standard preset definitions for the four major tools.
func DefaultPresets() []AgentDefinition {
	return []AgentDefinition{
		{
			ID:           "opencode",
			Name:         "opencode",
			Color:        "#B96CFF",
			Command:      "opencode",
			Args:         []string{"--prompt"},
			Env:          map[string]string{},
			ModeOverride: "auto",
			SystemBrief:  "You are opencode. Focus on precision and clean code.",
		},
		{
			ID:           "whis",
			Name:         "whis",
			Color:        "#FFD15C",
			Command:      "whis",
			Args:         []string{"run"},
			Env:          map[string]string{},
			ModeOverride: "auto",
			SystemBrief:  "You are whis. Complete the task thoroughly with clean git changes.",
		},
		{
			ID:           "agy",
			Name:         "agy",
			Color:        "#3DE1FF",
			Command:      "agy",
			Args:         []string{"-p"},
			Env:          map[string]string{},
			ModeOverride: "auto",
			SystemBrief:  "You are agy. Execute the instructions directly in the repository.",
		},
		{
			ID:           "freebuff",
			Name:         "freebuff",
			Color:        "#FF6B4A",
			Command:      "freebuff",
			Args:         []string{},
			Env:          map[string]string{},
			ModeOverride: "auto",
			SystemBrief:  "You are freebuff. Implement the requested task accurately.",
		},
	}
}

// LoadAgents loads agents from agents.json in configDir or creates defaults.
func LoadAgents(configDir string) ([]AgentDefinition, error) {
	filePath := filepath.Join(configDir, "agents.json")
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		defaults := DefaultPresets()
		_ = SaveAgents(configDir, defaults)
		return defaults, nil
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return DefaultPresets(), err
	}

	var list []AgentDefinition
	if err := json.Unmarshal(data, &list); err != nil || len(list) == 0 {
		return DefaultPresets(), nil
	}
	return list, nil
}

// SaveAgents writes the agent definitions to agents.json in configDir.
func SaveAgents(configDir string, agents []AgentDefinition) error {
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return err
	}
	filePath := filepath.Join(configDir, "agents.json")
	data, err := json.MarshalIndent(agents, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filePath, data, 0644)
}
