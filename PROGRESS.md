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
- [x] **Stage 2: Isolation & Git Worktree Engine**
  - Worktree creation at `conclave/<agent>/<task-slug>`.
  - Main repository protection (agents never run in main).
  - File scope globs enforcement & detection.
  - Cross-agent file overlap and port conflict detection.
  - Worktree cleanup on merge/discard & survival across restarts.
- [x] **Stage 3: Chat Interface (Ember Theme)**
  - 3-column Ember layout with resizable splitters.
  - Agent status indicators (Idle, Working with ember pulse, Waiting, Error).
  - Chat bubbles, collapsible tool-call and file-edit cards (+/- line counts).
  - Multi-agent composer with `@agent` targeting, file-scope input, and history.
  - Per-agent raw log drawer.
- [x] **Stage 4: Changes, Review & Safe Merge**
  - Right panel showing changed files and clean diff view.
  - Conflict-free dry-run merge before applying merges.
  - Overlap alerts & "Ask another agent to review" workflow.
  - Discard and safe branch cleanup.
- [x] **Stage 5: Mid-Task Redirect**
  - Soft redirect (queue to next turn).
  - Hard redirect (interrupt, checkpoint commit, diff summary, restart with unified brief).
  - Per-task timeline and "Undo to checkpoint".
- [x] **Stage 6: Reliability & Packaging**
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

### Stage 2: Isolation & Git Worktree Engine (Verified)
- Implemented repository management (`pkg/gitops/repo.go`): `InitRepo`, `IsGitRepo`, `CurrentBranch`, `IsDirty`, auto-adding `.conclave/` to `.gitignore`.
- Built worktree lifecycle engine (`pkg/gitops/worktree.go`):
  - Every task creates a worktree at `.conclave/worktrees/<agent>-<slug>` on branch `conclave/<agent>/<slug>`.
  - Agents run strictly within their designated worktree directory, never touching the main workspace folder.
  - Checkpoint commits (`CommitCheckpoint`) stage changes and record git commit hashes for rollback and redirect.
  - Worktree cleanup (`RemoveWorktree`) safely deletes worktrees and branches on discard or merge.
- Built monitoring suite:
  - File scope globs checker (`pkg/monitor/scope.go`): detects and flags out-of-scope edits.
  - Overlap detector (`pkg/monitor/overlap.go`): real-time detection of multiple agents editing the same file across worktrees.
  - Port conflict detector (`pkg/monitor/overlap.go`): alerts on port collision between concurrent agents.
- Persistence (`pkg/store/sessions.go`): saves active sessions to `%APPDATA%\Conclave\sessions.json` so worktrees and sessions survive app restarts.
- Tested and verified:
  - `TestWorktreeIsolationAndOverlap` passed.
  - Verified: Agent 1 (`opencode`) and Agent 2 (`whis`) edited `shared.txt` simultaneously in separate worktrees; baseline in main repository was untouched.
  - Verified: Overlap detector alerted on `shared.txt` (2 agents); Port detector alerted on port collision (port 3000); Scope detector alerted on `src/secret.js`.

### Stage 3: Chat Interface (Ember Theme) (Verified)
- Built 3-column layout (`ui/index.html`, `ui/styles.css`, `ui/app.js`):
  - Left: Agents sidebar with status dots (`Idle`, `Working` with `@keyframes ember-pulse`, `Waiting`, `Error`), task summaries, and "All Agents" view.
  - Center: Streaming chat bubbles, collapsible activity cards for tool-calls and file-edits (+/- counts), multi-line composer with `@agent` targeting, file-scope input, multi-agent dispatch, and Up-arrow history.
  - Right: Changes, diff preview, and merge controls.
- RFC6455 WebSocket engine (`pkg/server/ws.go`) provides real-time bi-directional streaming for agent messages, tool calls, and status indicators.
- Embedded via `go:embed` in `ui/embed.go` with zero runtime CDN requirements and local system fonts.

### Stage 4: Changes, Review & Safe Merge (Verified)
- Built `pkg/gitops/merge.go`:
  - Dry-run verification (`DryRunMerge`) using `git merge-tree --write-tree` detects conflicts before altering branches.
  - Safe merge execution (`ExecuteMerge`) verifies main is clean, checks out base branch, merges `--no-ff`, and handles abort on conflict without corrupting working copy.
  - Right panel displays modified files, additions/deletions badges, colorized unified diff, scope alerts, and overlap warnings.
  - Actions: `Review & Merge`, `Discard`, and `Ask another agent to review`.

### Stage 5: Mid-Task Redirect (Verified)
- Built redirect engine in `pkg/server/server.go`:
  - **Soft Redirect**: Delivers instructions directly to running process stdin at next turn.
  - **Hard Redirect**: Interrupts running agent, creates Git checkpoint commit (`git commit -m "checkpoint: ..."`), summarizes diff stat and recent messages, and restarts the agent in the same worktree with a combined brief.
  - Task timeline records start, redirects, checkpoints, and completion.
  - "Undo to Checkpoint" resets the worktree (`git reset --hard <hash>`).

### Stage 6: Reliability & Packaging (Verified)
- Process tree termination via Windows Job Object (`pkg/jobmgr/jobmgr_windows.go`) with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
- State persistence in `%APPDATA%\Conclave\sessions.json` and `%APPDATA%\Conclave\agents.json`.
- Production build: `conclave.exe` and `conclave-gui.exe` compiled with `-ldflags="-s -w"` and embedded Windows icon and manifest.
- Comprehensive Acceptance Tests (`pkg/server/acceptance_test.go`):
  1. `TestAcceptance1_IsolationAndOverlap`: Verified separate worktrees, main untouched, overlap detected (PASS).
  2. `TestAcceptance2_MergeAndConflict`: Verified first branch merges cleanly, second branch reports conflict and never overwrites (PASS).
  3. `TestAcceptance3_HardRedirect`: Verified earlier changes preserved, checkpoint committed, agent restarted with brief, other agents unaffected (PASS).
  4. `TestAcceptance4_MissingAgent`: Verified missing CLI command reports clear error without crashing (PASS).
  5. `TestAcceptance5_RestoreOnRestart`: Verified chats, worktrees, and sessions restored upon server restart (PASS).
- Complete test suite (`go test ./... -v`) passed with exit code 0.
