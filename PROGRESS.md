# CONCLAVE - Development Progress Log

## Project Overview
CONCLAVE is a Windows desktop application for chatting with and orchestrating multiple CLI coding agents (including `opencode`, `whis`, `agy`, `freebuff`, and custom user-defined agents). Each agent is strictly isolated into its own dedicated Git worktree and branch (`conclave/<agent>/<task-slug>`), preventing agents from overwriting the main workspace or each other. The user reviews diffs, detects overlap/port collisions, merges changes safely, and can issue soft or hard redirects mid-task.

Stack:
- Backend: Go (HTTP + WebSocket server on 127.0.0.1 with per-session token auth)
- Desktop Shell: Frameless Microsoft Edge `--app=` desktop window with local fallback
- Frontend: Embedded vanilla JavaScript & CSS in an "Ember" dark theme with amber gold accents and bundled fonts
- Storage: `%APPDATA%\Conclave\` for settings, agents, tasks, sessions, and logs

---

## Stage Checklist & Status

- [x] **Stage 1: Agent Adapters & Probe Engine**
  - Common Agent interface (`Start`, `Send`, `Interrupt`, `Stop`, event stream).
  - Multi-tier probing (non-interactive flag, server/API mode, hidden PTY/ConPTY fallback with output filtering).
  - `conclave probe` command.
  - User-defined agent definitions & editable presets in `agents.json`.
- [ ] **Stage 2: Isolation & Git Worktree Engine**
  - Worktree creation at `conclave/<agent>/<task-slug>`.
  - Main repository protection (agents never run in main).
  - File scope globs enforcement & detection.
  - Cross-agent file overlap and port conflict detection.
  - Worktree cleanup on merge/discard & survival across restarts.
- [ ] **Stage 3: Chat Interface (Ember Theme)**
  - 3-column Ember layout with resizable splitters.
  - Agent status indicators (Idle, Working with ember pulse, Waiting, Error).
  - Chat bubbles, collapsible tool-call and file-edit cards (+/- line counts).
  - Multi-agent composer with `@agent` targeting, file-scope input, and history.
  - Per-agent raw log drawer.
- [ ] **Stage 4: Changes, Review & Safe Merge**
  - Right panel showing changed files and clean diff view.
  - Conflict-free dry-run merge before applying merges.
  - Overlap alerts & "Ask another agent to review" workflow.
  - Discard and safe branch cleanup.
- [ ] **Stage 5: Mid-Task Redirect**
  - Soft redirect (queue to next turn).
  - Hard redirect (interrupt, checkpoint commit, diff summary, restart with unified brief).
  - Per-task timeline and "Undo to checkpoint".
- [ ] **Stage 6: Reliability & Packaging**
  - Windows Job Object process tree termination on exit/crash.
  - State persistence in `%APPDATA%\Conclave\`.
  - High-DPI Windows executable packaging (`conclave.exe`).
  - Acceptance tests execution and verification.

---

## Stage Logs

### Stage 1: Agent Adapters & Probe Engine (Verified)
- Implemented `AgentInstance` interface with `Start(ctx, task, workdir)`, `Send(msg)`, `Interrupt()`, `Stop()`, `GetRawLogs()`, and typed `Event` stream (`text`, `tool-call`, `file-edit`, `error`, `done`).
- Output cleaner and parser (`pkg/agent/parser.go`) strips ANSI escape sequences, parses tool executions (`Executing command: ...`), extracts file edits (`Modified main.go (+12 -3)`), and line-buffers raw logs.
- Probing engine (`pkg/agent/probe.go`) executes multi-tier probe:
  1. Non-interactive flag check
  2. Server/API mode check
  3. Hidden PTY / ConPTY fallback
  4. Missing agent binary reports clear error without crashing.
- Presets for `opencode`, `whis`, `agy`, and `freebuff` initialized and persisted into `%APPDATA%\Conclave\agents.json`.
- Tested and verified:
  - Unit tests `TestParseLine`, `TestProbeMissingTool`, and `TestAgentExecutionAndEventStream` passed (`ok conclave/pkg/agent 3.259s`).
  - Executed `conclave.exe probe` live against local system:
    - `opencode`: Mode `non-interactive` (v1.19.0)
    - `whis`: Mode `non-interactive` (v0.2.58)
    - `agy`: Mode `non-interactive` (v1.4.6)
    - `freebuff`: Mode `non-interactive` (v0.2.34)
    - Persisted into `C:\Users\Naman Gaonkar\AppData\Roaming\Conclave\agents.json`.
