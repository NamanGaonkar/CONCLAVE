# CONCLAVE

> **Isolated Multi-Agent Desktop Hub for CLI Coding Agents**

CONCLAVE is a Windows desktop application (`conclave.exe`) that orchestrates multiple autonomous CLI coding agents (including `opencode`, `whis`, `agy`, `freebuff`, and any custom agents).

Each agent runs strictly inside its own isolated **Git worktree** and dedicated branch (`conclave/<agent>/<task-slug>`). Agents cannot overwrite each other or the main workspace. You review each agent's changes, inspect diffs, detect file and port overlaps, and merge or redirect them safely.

---

## Key Features

1. **Strict Git Worktree Isolation**:
   - Every task creates an isolated worktree at `.conclave/worktrees/<agent>-<slug>` branched from `HEAD`.
   - Agents never run in the main folder.
2. **Overlap & Port Conflict Detection**:
   - Real-time watcher alerts when two agents modify the same file.
   - Warns when multiple agents attempt to bind the same TCP port.
3. **Mid-Task Redirect**:
   - **Soft Redirect**: Queues new instructions directly into the agent's input stream.
   - **Hard Redirect**: Interrupts the process, creates a Git checkpoint commit, summarizes progress and recent messages, and restarts the agent in the same worktree with a unified brief.
4. **Safe Review & Merge**:
   - Automated dry-run merge verification (`git merge-tree`) before merging.
   - Clear conflict reporting—never auto-merges broken code.
   - "Ask another agent to review" workflow to submit diffs to peer agents.
5. **Ember Dark Aesthetic**:
   - Warm terminal glow with deep amber `#F5AF28` and `#FFD15C` accents on `#0C0A07` dark surfaces.
   - Status dots with pulsing ember animation on active agents.
   - Collapsible activity cards for tool executions and file modifications (+/- counts).
6. **Robust Process Management**:
   - Windows Job Objects guarantee all child process trees terminate on exit or crash.
   - Worktree sessions and chat state persist in `%APPDATA%\Conclave\`.

---

## Quick Start

### Running Conclave

Double-click `conclave-gui.exe` or run from terminal:

```powershell
# Launch desktop app
.\conclave.exe

# Or specify a workspace directory directly
.\conclave.exe --dir "C:\path\to\your\repo"

# Probe installed agents and detect their modes
.\conclave.exe probe
```

### Building from Source

Prerequisites: Go 1.21+ on Windows.

```powershell
# 1. Generate icon and Windows resource assembly (optional if rsrc is installed)
python scripts\generate_icon.py
rsrc.exe -manifest conclave.manifest -ico conclave.ico -o rsrc.syso

# 2. Build standalone executable
go build -ldflags="-s -w" -o conclave.exe ./cmd/conclave

# 3. Build silent GUI executable (no console window)
go build -ldflags="-H=windowsgui -s -w" -o conclave-gui.exe ./cmd/conclave
```

### Running Tests

```powershell
go test ./... -v
```

---

## Keyboard Shortcuts

- `Ctrl+K`: Open Command Palette
- `Ctrl+Enter`: Send task or message
- `Up Arrow`: Recall previous task from history
- `?`: Toggle keyboard shortcuts cheat sheet
- `Esc`: Close modals and drawers
