package agent

import (
	"context"
	"time"
)

// EventType categorizes streaming agent activity.
type EventType string

const (
	EventTypeText     EventType = "text"
	EventTypeToolCall EventType = "tool-call"
	EventTypeFileEdit EventType = "file-edit"
	EventTypeError    EventType = "error"
	EventTypeDone     EventType = "done"
)

// Event represents a single structured emission from an agent.
type Event struct {
	Type        EventType `json:"type"`
	Text        string    `json:"text,omitempty"`
	Tool        string    `json:"tool,omitempty"`
	Args        string    `json:"args,omitempty"`
	FilePath    string    `json:"filePath,omitempty"`
	DiffSummary string    `json:"diffSummary,omitempty"`
	Raw         string    `json:"raw,omitempty"`
	Timestamp   time.Time `json:"timestamp"`
}

// AgentStatus represents the state of an agent in the system.
type AgentStatus string

const (
	StatusIdle    AgentStatus = "idle"
	StatusWorking AgentStatus = "working" // Amber pulsing glow in UI
	StatusWaiting AgentStatus = "waiting"
	StatusError   AgentStatus = "error"
)

// ProbeResult captures the outcome of probing an agent CLI.
type ProbeResult struct {
	Mode         string    `json:"mode"` // "non-interactive", "server", "pty"
	Supported    bool      `json:"supported"`
	Success      bool      `json:"success"`
	SampleOutput string    `json:"sampleOutput,omitempty"`
	Error        string    `json:"error,omitempty"`
	ProbedAt     time.Time `json:"probedAt"`
}

// AgentDefinition defines a user-configurable or preset CLI agent.
type AgentDefinition struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	Color        string            `json:"color"`        // Hex color, e.g. #F5AF28
	Command      string            `json:"command"`      // e.g. "opencode", "whis", "agy", "freebuff"
	Args         []string          `json:"args"`         // custom CLI flags
	Env          map[string]string `json:"env"`          // custom environment variables
	ModeOverride string            `json:"modeOverride"` // "auto", "non-interactive", "server", "pty"
	SystemBrief  string            `json:"systemBrief"`  // optional system prompt / instructions
	ProbeResult  *ProbeResult      `json:"probeResult,omitempty"`
}

// AgentInstance is the runtime interface to an active or idle agent.
type AgentInstance interface {
	Definition() AgentDefinition
	Status() AgentStatus
	Start(ctx context.Context, task string, workdir string) (<-chan Event, error)
	Send(message string) error
	Interrupt() error
	Stop() error
	GetRawLogs() string
}
