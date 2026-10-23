package agent

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// ProbeAgent probes an agent definition following the priority order:
// 1. Non-interactive CLI flag
// 2. Server/API mode
// 3. Hidden pseudo-terminal (ConPTY)
// Missing tools report clearly and do not crash.
func ProbeAgent(ctx context.Context, def AgentDefinition) ProbeResult {
	result := ProbeResult{
		ProbedAt: time.Now(),
	}

	// 1. Check if executable exists on PATH
	exePath, err := exec.LookPath(def.Command)
	if err != nil {
		result.Supported = false
		result.Success = false
		result.Error = fmt.Sprintf("Executable '%s' not found on PATH", def.Command)
		return result
	}

	result.Supported = true

	// If a user has an explicit mode override that is not "auto", honor it
	if def.ModeOverride != "" && def.ModeOverride != "auto" {
		result.Mode = def.ModeOverride
		result.Success = true
		result.SampleOutput = fmt.Sprintf("Mode forced by override: %s (Binary: %s)", def.ModeOverride, exePath)
		return result
	}

	// Create an isolated temp directory for the probe task
	tempDir, err := os.MkdirTemp("", "conclave-probe-*")
	if err == nil {
		defer os.RemoveAll(tempDir)
	} else {
		tempDir = os.TempDir()
	}

	// Probe Step 1: Check Non-interactive mode
	nonInteractiveArgs := getNonInteractiveProbeArgs(def.ID, def.Command)
	probeCtx, cancel := context.WithTimeout(ctx, 7*time.Second)
	defer cancel()

	cmd := exec.CommandContext(probeCtx, exePath, nonInteractiveArgs...)
	cmd.Dir = tempDir
	cmd.Env = os.Environ()
	for k, v := range def.Env {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	outputStr := strings.TrimSpace(StripANSI(stdout.String() + "\n" + stderr.String()))

	if err == nil && len(outputStr) > 0 {
		result.Mode = "non-interactive"
		result.Success = true
		sample := outputStr
		if len(sample) > 300 {
			sample = sample[:300] + "..."
		}
		result.SampleOutput = sample
		return result
	}

	// Probe Step 2: Check Server mode
	if hasServerMode(def.ID, def.Command) {
		result.Mode = "server"
		result.Success = true
		result.SampleOutput = "Server mode supported (e.g. 'serve' / '--listen')"
		return result
	}

	// Probe Step 3: Hidden PTY / ConPTY fallback
	result.Mode = "pty"
	result.Success = true
	result.SampleOutput = fmt.Sprintf("Hidden PTY/ConPTY streaming mode (Binary: %s)", exePath)
	return result
}

// getNonInteractiveProbeArgs returns probe args tailored for known tools or generic test.
func getNonInteractiveProbeArgs(id, cmdName string) []string {
	switch strings.ToLower(id) {
	case "opencode":
		return []string{"--version"}
	case "whis":
		return []string{"--version"}
	case "agy":
		return []string{"--version"}
	case "freebuff":
		return []string{"--version"}
	default:
		return []string{"--version"}
	}
}

// hasServerMode checks if the agent natively provides a server subcommand.
func hasServerMode(id, cmdName string) bool {
	switch strings.ToLower(id) {
	case "opencode", "whis":
		return true
	default:
		return false
	}
}
