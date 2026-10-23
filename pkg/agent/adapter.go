package agent

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// ProcessAgentInstance implements AgentInstance using background child processes.
type ProcessAgentInstance struct {
	def       AgentDefinition
	status    AgentStatus
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	cancel    context.CancelFunc
	rawLogs   strings.Builder
	logMu     sync.RWMutex
	statusMu  sync.RWMutex
	eventChan chan Event
}

// NewAgentInstance creates a new runtime instance for an agent definition.
func NewAgentInstance(def AgentDefinition) *ProcessAgentInstance {
	return &ProcessAgentInstance{
		def:    def,
		status: StatusIdle,
	}
}

func (a *ProcessAgentInstance) Definition() AgentDefinition {
	return a.def
}

func (a *ProcessAgentInstance) Status() AgentStatus {
	a.statusMu.RLock()
	defer a.statusMu.RUnlock()
	return a.status
}

func (a *ProcessAgentInstance) setStatus(s AgentStatus) {
	a.statusMu.Lock()
	a.status = s
	a.statusMu.Unlock()
}

func (a *ProcessAgentInstance) appendRawLog(line string) {
	a.logMu.Lock()
	a.rawLogs.WriteString(line + "\n")
	a.logMu.Unlock()
}

func (a *ProcessAgentInstance) GetRawLogs() string {
	a.logMu.RLock()
	defer a.logMu.RUnlock()
	return a.rawLogs.String()
}

// Start begins a task inside the specified worktree directory.
func (a *ProcessAgentInstance) Start(ctx context.Context, task string, workdir string) (<-chan Event, error) {
	exePath, err := exec.LookPath(a.def.Command)
	if err != nil {
		a.setStatus(StatusError)
		return nil, fmt.Errorf("agent '%s' executable '%s' not found on PATH: %w", a.def.Name, a.def.Command, err)
	}

	runCtx, cancel := context.WithCancel(ctx)
	a.cancel = cancel
	a.eventChan = make(chan Event, 64)

	args := a.buildArgs(task)
	cmd := exec.CommandContext(runCtx, exePath, args...)
	cmd.Dir = workdir

	// Setup environment
	cmd.Env = os.Environ()
	cmd.Env = append(cmd.Env, "FORCE_COLOR=0", "NO_COLOR=1")
	for k, v := range a.def.Env {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}

	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		a.setStatus(StatusError)
		return nil, fmt.Errorf("failed to create stdin pipe: %w", err)
	}
	a.stdin = stdinPipe

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		a.setStatus(StatusError)
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		a.setStatus(StatusError)
		return nil, fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		cancel()
		a.setStatus(StatusError)
		return nil, fmt.Errorf("failed to start agent process: %w", err)
	}

	a.cmd = cmd
	a.setStatus(StatusWorking)

	// Stream stdout & stderr concurrently
	var wg sync.WaitGroup
	wg.Add(2)

	streamReader := func(r io.Reader, isErr bool) {
		defer wg.Done()
		scanner := bufio.NewScanner(r)
		for scanner.Scan() {
			rawLine := scanner.Text()
			a.appendRawLog(rawLine)
			ev := ParseLine(rawLine)
			if isErr && ev.Type == EventTypeText {
				ev.Type = EventTypeError
			}
			select {
			case a.eventChan <- ev:
			default:
			}
		}
	}

	go streamReader(stdoutPipe, false)
	go streamReader(stderrPipe, true)

	go func() {
		wg.Wait()
		waitErr := cmd.Wait()
		if waitErr != nil {
			a.setStatus(StatusError)
			select {
			case a.eventChan <- Event{
				Type:      EventTypeError,
				Text:      fmt.Sprintf("Process exited with error: %v", waitErr),
				Timestamp: time.Now(),
			}:
			default:
			}
		} else {
			a.setStatus(StatusIdle)
			select {
			case a.eventChan <- Event{
				Type:      EventTypeDone,
				Text:      "Task completed successfully.",
				Timestamp: time.Now(),
			}:
			default:
			}
		}
		close(a.eventChan)
	}()

	return a.eventChan, nil
}

// buildArgs composes the arguments for running the given task.
func (a *ProcessAgentInstance) buildArgs(task string) []string {
	var args []string
	args = append(args, a.def.Args...)

	brief := a.def.SystemBrief
	fullPrompt := task
	if brief != "" {
		fullPrompt = fmt.Sprintf("%s\n\nTask: %s", brief, task)
	}

	// Tailor to specific known tools
	switch strings.ToLower(a.def.ID) {
	case "opencode":
		return []string{"--prompt", fullPrompt}
	case "whis":
		return []string{"run", fullPrompt}
	case "agy":
		return []string{"-p", fullPrompt}
	default:
		if len(args) > 0 {
			return append(args, fullPrompt)
		}
		return []string{fullPrompt}
	}
}

// Send delivers a message via stdin to the agent.
func (a *ProcessAgentInstance) Send(message string) error {
	if a.stdin == nil {
		return fmt.Errorf("agent stdin is not open")
	}
	_, err := a.stdin.Write([]byte(message + "\n"))
	return err
}

// Interrupt aborts the current running command.
func (a *ProcessAgentInstance) Interrupt() error {
	if a.cancel != nil {
		a.cancel()
	}
	if a.cmd != nil && a.cmd.Process != nil {
		return a.cmd.Process.Kill()
	}
	return nil
}

// Stop shuts down the process immediately.
func (a *ProcessAgentInstance) Stop() error {
	a.setStatus(StatusIdle)
	if a.cancel != nil {
		a.cancel()
	}
	if a.cmd != nil && a.cmd.Process != nil {
		return a.cmd.Process.Kill()
	}
	return nil
}
