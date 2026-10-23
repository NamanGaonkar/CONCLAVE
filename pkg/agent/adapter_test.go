package agent

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

func TestParseLine(t *testing.T) {
	// Test ANSI stripping and text event
	rawANSI := "\x1b[33mHello \x1b[1mWorld\x1b[0m\r\n"
	evText := ParseLine(rawANSI)
	if evText.Type != EventTypeText || evText.Text != "Hello World" {
		t.Fatalf("expected clean text 'Hello World', got %+v", evText)
	}

	// Test tool call detection
	toolLine := "Executing command: powershell -Command Get-Date"
	evTool := ParseLine(toolLine)
	if evTool.Type != EventTypeToolCall || evTool.Tool != "powershell" {
		t.Fatalf("expected tool call 'powershell', got %+v", evTool)
	}

	// Test file edit detection
	fileLine := "Modified main.go (+12 -3)"
	evFile := ParseLine(fileLine)
	if evFile.Type != EventTypeFileEdit || evFile.FilePath != "main.go" || evFile.DiffSummary != "+12 -3" {
		t.Fatalf("expected file edit 'main.go' with '+12 -3', got %+v", evFile)
	}
}

func TestProbeMissingTool(t *testing.T) {
	missingDef := AgentDefinition{
		ID:      "nonexistent-tool-xyz",
		Name:    "Nonexistent Tool",
		Command: "this-tool-does-not-exist-12345",
	}

	res := ProbeAgent(context.Background(), missingDef)
	if res.Supported {
		t.Fatalf("expected missing tool to not be supported, got %+v", res)
	}
	if !strings.Contains(res.Error, "not found on PATH") {
		t.Fatalf("expected clear error message, got %s", res.Error)
	}
}

func TestAgentExecutionAndEventStream(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "conclave-agent-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	// Use powershell.exe / cmd.exe as a mock agent to prove the interface
	agentDef := AgentDefinition{
		ID:      "test-echo",
		Name:    "Test Echo Agent",
		Command: "cmd.exe",
		Args:    []string{"/c"},
	}

	inst := NewAgentInstance(agentDef)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	events, err := inst.Start(ctx, "echo Wrote main.go (+5 -1)", tempDir)
	if err != nil {
		t.Fatalf("failed to start agent: %v", err)
	}

	var receivedEvents []Event
	for ev := range events {
		receivedEvents = append(receivedEvents, ev)
	}

	if len(receivedEvents) == 0 {
		t.Fatalf("expected events from agent stream, got none")
	}

	// Verify raw logs captured
	rawLogs := inst.GetRawLogs()
	if !strings.Contains(rawLogs, "main.go") {
		t.Fatalf("expected raw logs to contain output, got: %s", rawLogs)
	}
}
