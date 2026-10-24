# CLI-to-Desktop Master Rule Book: Building Production Desktop Apps for CLI Agents

> **Purpose:** This document is an end-to-end blueprint for building, packaging, deploying, and releasing a production-grade Electron desktop application from a CLI coding agent (such as `whis`).
>
> Any AI agent or developer can follow this guide step-by-step in a new repository to produce an installer (`.exe` on Windows, `.dmg` on macOS, `.AppImage` on Linux), real-time PTY terminal streams, persistent SQLite memory, robust process supervision, and automated GitHub CI/CD releases.

---

## 0. Product Scope & Philosophy: Just Whis & Providers (No Bloat)

> [!IMPORTANT]
> **Strict Product Identity: This is NOT a generic Claude Code clone, Codex wrapper, or multi-agent office simulator.**
>
> **Whis Desktop must be laser-focused:**
> 1. **Pure Whis Core**: The entire desktop experience is centered 100% around your `whis` CLI agent. No pixel office floors, no multi-character avatars, no multi-agent team simulations, and no gimmicks. Just a fast, gorgeous, responsive command terminal and workspace for Whis.
> 2. **Provider & Model Flexibility**: The only core companion feature is a clean, robust **Provider Settings** panel where users can add, switch, and configure their LLM providers (Anthropic Claude, OpenAI, Google Gemini, DeepSeek, Groq, OpenRouter, and local offline models via Ollama / LM Studio / vLLM).
> 3. **Minimalist, Sovereign & Fast**: Sub-second startup time, ultra-low idle memory footprint, and 100% offline capability with local SQLite storage.

---

## 1. High-Level Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │               RENDERER PROCESS               │
                    │   React 18 + TypeScript + Vite + Zustand     │
                    │   xterm.js + WebGL / FitAddon (PTY UI)       │
                    │   Design System: Lato / Inter / Golden Glow   │
                    └──────────────────────┬───────────────────────┘
                                           │
                                    IPC Bridge (contextBridge)
                                           │
                    ┌──────────────────────▼───────────────────────┐
                    │                 MAIN PROCESS                 │
                    │            Node.js 20+ / Electron 32         │
                    ├──────────────────────┬───────────────────────┤
                    │   PTY Supervisor     │   Database Engine     │
                    │   node-pty / ConPTY  │   better-sqlite3      │
                    │   shellEnv detection │   WAL mode / migrate  │
                    │   Tree kill manager  │   asarUnpack FS       │
                    └──────────┬───────────┴───────────┬───────────┘
                               │                       │
               ┌───────────────▼──────────────┐   ┌────▼─────────────────┐
               │   CLI Subprocess Engine      │   │   AppData Storage    │
               │   Runs `whis` / `claude`     │   │   SQLite DB file     │
               │   Interactive terminal pty   │   │   config.json        │
               │   Git worktrees & env vars   │   │   local logs         │
               └──────────────────────────────┘   └──────────────────────┘
```

### Core Design Principles
1. **Local-First & Offline**: Zero external telemetry required. All state stored in `%LOCALAPPDATA%` / `~/Library/Application Support`.
2. **True PTY Emulation**: The CLI agent runs in a genuine pseudo-terminal (`node-pty` with ConPTY on Windows), so colors, interactive prompts, cursor movement, and keypresses work identically to Windows Terminal or iTerm2.
3. **Hardened Process Lifecycle**: Spawning CLI agents produces process trees. Closing tabs or quitting the app must recursively kill trees (`taskkill /F /T` on Windows, `kill -9` on Unix) to prevent zombie background processes consuming 100% CPU.
4. **Native Module Isolation**: C++ addons (`node-pty`, `better-sqlite3`) must run **only** in the Electron Main process and be unpacked from `.asar`.

---

## 2. Recommended Tech Stack

| Component | Choice | Why |
|---|---|---|
| **Runtime** | Electron 32+ | Full Node.js 20 backend, modern Chromium frontend |
| **Bundler** | `electron-vite` (Vite 5) | Sub-second HMR for renderer, fast Rollup bundle for main/preload |
| **UI Framework** | React 18 + TypeScript | Solid ecosystem, strict typing across IPC contracts |
| **Terminal Canvas** | `@xterm/xterm` 5.5+ | Native terminal renderer; pair with `@xterm/addon-fit` and `@xterm/addon-webgl` |
| **PTY Backend** | `node-pty` 1.0+ | Spawns pseudo-terminals with ConPTY support on Windows |
| **Persistence** | `better-sqlite3` 11+ | Synchronous, ultra-fast SQLite with zero RPC latency in main process |
| **State Store** | `zustand` 4.5+ | Minimal boilerplate, reactive outside React components |
| **Packaging** | `electron-builder` 25+ | Builds Windows NSIS setup & portable exe, macOS DMG, Linux AppImage |
| **PE Resource Tool** | `resedit` | Patches Windows PE binary icon tables to guarantee high-res taskbar/desktop icons |

---

## 3. Directory Layout Blueprint

```
whis-desktop/
├── .github/
│   └── workflows/
│       ├── ci.yml                 # PR & branch typecheck + smoke build
│       └── release.yml            # Multi-platform build & GitHub Release
├── build/
│   ├── icon.ico                   # Multi-res Windows icon (16, 32, 48, 64, 128, 256)
│   ├── icon.icns                  # macOS icon
│   ├── icon.png                   # 512x512 Linux PNG
│   └── entitlements.mac.plist     # macOS hardened runtime entitlements
├── electron-builder.yml           # electron-builder packaging rules
├── electron.vite.config.ts        # electron-vite multi-target config
├── package.json                   # Dependencies, scripts, build metadata
├── package-lock.json              # Frozen dependencies (must match package.json)
├── RELEASE.md                     # Human-facing release notes
├── src/
│   ├── main/
│   │   ├── index.ts               # App entrypoint, window lifecycle, auto-updater
│   │   ├── pty.ts                 # PTY session supervisor & node-pty spawning
│   │   ├── procKill.ts            # Recursive process tree termination
│   │   ├── shellEnv.ts            # PATH and default shell discovery
│   │   ├── db.ts                  # better-sqlite3 schema & migrations
│   │   └── updater.ts             # electron-updater logic & event emission
│   ├── preload/
│   │   ├── index.ts               # contextBridge exposure (safe IPC methods)
│   │   └── index.d.ts             # Window.whis typing for renderer
│   ├── renderer/
│   │   ├── index.html             # HTML root, font imports
│   │   └── src/
│   │       ├── App.tsx            # Main application layout
│   │       ├── design/
│   │       │   ├── tokens.css     # CSS variables (colors, fonts, radii, shadows)
│   │       │   └── tokens.ts      # Shared JS design tokens
│   │       ├── components/
│   │       │   ├── TerminalView.tsx # xterm.js instance with resize observer
│   │       │   └── PixelPanel.tsx   # Symmetrical container panels
│   │       └── stores/
│   │           └── agentStore.ts    # Zustand store for agent state
│   └── shared/
│       └── types.ts               # Types shared across Main, Preload, and Renderer
└── tools/
    ├── package.cjs                # Environment-sanitized electron-builder runner
    ├── after-pack.cjs             # PE executable icon patcher (afterPack hook)
    ├── build-ico.cjs              # Generates multi-res .ico from PNG
    ├── deploy-local.ps1           # Local installer & shell cache refresh
    └── check-release-links.cjs    # Release asset link consistency checker
```

---

## 4. Spawning CLI Agents via `node-pty`

The most critical part of an agent desktop app is launching the CLI agent interactively and streaming its I/O cleanly.

### A. Environment Discovery (`src/main/shellEnv.ts`)
Users install CLI agents in `PATH` (e.g., `npm i -g @whis/cli`, `pip install whis`, or `cargo install`). GUI apps on macOS and Windows do not always inherit the terminal shell's `PATH`.

```typescript
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function getShellExecutable(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe';
  }
  return process.env.SHELL || '/bin/zsh';
}

export function resolveUserEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;

  // Append common CLI install paths if missing
  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE || '';
    const extraPaths = [
      join(userProfile, 'AppData', 'Roaming', 'npm'),
      join(userProfile, '.cargo', 'bin'),
      join(userProfile, 'AppData', 'Local', 'Programs', 'Python', 'Scripts')
    ];
    env.PATH = `${env.PATH};${extraPaths.filter(existsSync).join(';')}`;
  } else {
    // macOS/Linux: ask login shell for full PATH
    try {
      const shell = getShellExecutable();
      const stdout = execSync(`${shell} -l -c 'echo -n "$PATH"'`, { encoding: 'utf-8', timeout: 3000 });
      if (stdout) env.PATH = stdout;
    } catch {
      env.PATH = `${env.PATH}:/usr/local/bin:/opt/homebrew/bin:~/.cargo/bin`;
    }
  }

  // Force terminal color support
  env.COLORTERM = 'truecolor';
  env.TERM = 'xterm-256color';
  env.FORCE_COLOR = '1';
  return env;
}
```

### B. Spawning the Interactive PTY (`src/main/pty.ts`)
```typescript
import * as pty from 'node-pty';
import { WebContents } from 'electron';
import { hardKillTree } from './procKill';
import { resolveUserEnv } from './shellEnv';

interface PtySession {
  id: string;
  proc: pty.IPty;
  sender: WebContents;
}

const sessions = new Map<string, PtySession>();

export function spawnAgentPty(
  id: string,
  command: string,
  args: string[],
  cwd: string,
  sender: WebContents,
  cols = 120,
  rows = 30
): void {
  // Kill existing session with same ID if present
  killAgentPty(id);

  const env = resolveUserEnv();
  const proc = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env,
    useConpty: process.platform === 'win32' // Use ConPTY on modern Windows
  });

  const session: PtySession = { id, proc, sender };
  sessions.set(id, session);

  proc.onData((data: string) => {
    if (!sender.isDestroyed()) {
      sender.send(`pty:data:${id}`, data);
    }
  });

  proc.onExit(({ exitCode, signal }) => {
    sessions.delete(id);
    if (!sender.isDestroyed()) {
      sender.send(`pty:exit:${id}`, { exitCode, signal });
    }
  });
}

export function writeAgentPty(id: string, data: string): void {
  const session = sessions.get(id);
  if (session) {
    session.proc.write(data);
  }
}

export function resizeAgentPty(id: string, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (session && cols > 0 && rows > 0) {
    session.proc.resize(cols, rows);
  }
}

export function killAgentPty(id: string): void {
  const session = sessions.get(id);
  if (session) {
    const pid = session.proc.pid;
    sessions.delete(id);
    hardKillTree(pid);
  }
}

export function killAllPtys(): void {
  for (const id of Array.from(sessions.keys())) {
    killAgentPty(id);
  }
}
```

### C. Tree Killing (`src/main/procKill.ts`)
Prevent runaway sub-processes when user kills a session:
```typescript
import { execSync } from 'node:child_process';

export function hardKillTree(pid: number): void {
  if (!pid || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
    } else {
      execSync(`pkill -TERM -P ${pid} || true; kill -9 ${pid} || true`, { shell: '/bin/sh', stdio: 'ignore' });
    }
  } catch {
    // Process already exited
  }
}
```

---

## 5. The Provider Management System: Seamlessly Adding & Switching Providers

Unlike generic wrappers or bloated multi-agent tools, **Whis Desktop** focuses strictly on:
1. Running **Whis** flawlessly.
2. Giving the user a clean, instant way to **add, configure, and switch model providers**.

### A. Provider Data Model (`src/shared/types.ts`)
```typescript
export type ProviderType = 'anthropic' | 'openai' | 'gemini' | 'groq' | 'deepseek' | 'ollama' | 'custom';

export interface ProviderConfig {
  id: string;                    // unique id, e.g. "prov-anthropic", "prov-local-ollama"
  name: string;                  // display label, e.g. "Claude 3.7 Sonnet", "Local Ollama"
  type: ProviderType;
  baseUrl?: string;              // custom endpoint e.g. "http://localhost:11434/v1" or "https://api.deepseek.com/v1"
  apiKey?: string;               // securely stored via safeStorage
  selectedModel: string;         // e.g. "claude-3-7-sonnet-20250219", "gpt-4o", "llama3.3:70b"
  availableModels: string[];     // model dropdown choices
  isActive: boolean;             // currently selected provider for Whis
}
```

### B. Secure Storage & Injection into Whis (`src/main/providers.ts`)
When Whis is spawned, the main process injects the active provider's credentials directly into `whis`'s process environment:

```typescript
import { safeStorage } from 'electron';
import { getDatabase } from './db';
import { ProviderConfig } from '../shared/types';

export function getProviders(): ProviderConfig[] {
  const db = getDatabase();
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('providers') as { value: string } | undefined;
  if (!row) return getDefaultProviders();

  const providers = JSON.parse(row.value) as ProviderConfig[];
  // Decrypt API keys using Electron's native OS keychain / DPAPI encryption
  return providers.map(p => ({
    ...p,
    apiKey: p.apiKey && safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(p.apiKey, 'base64'))
      : p.apiKey
  }));
}

export function saveProviders(providers: ProviderConfig[]): void {
  const db = getDatabase();
  // Encrypt sensitive API keys before saving to SQLite
  const encrypted = providers.map(p => ({
    ...p,
    apiKey: p.apiKey && safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(p.apiKey).toString('base64')
      : p.apiKey
  }));

  db.prepare(`
    INSERT INTO kv (key, value, updated_at) VALUES ('providers', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(JSON.stringify(encrypted), Date.now());
}

export function getActiveProvider(): ProviderConfig | undefined {
  return getProviders().find(p => p.isActive);
}

/** Injects active provider env vars when launching Whis */
export function injectProviderEnv(env: Record<string, string>): void {
  const active = getActiveProvider();
  if (!active) return;

  switch (active.type) {
    case 'anthropic':
      if (active.apiKey) env.ANTHROPIC_API_KEY = active.apiKey;
      if (active.baseUrl) env.ANTHROPIC_BASE_URL = active.baseUrl;
      env.WHIS_PROVIDER = 'anthropic';
      break;
    case 'openai':
      if (active.apiKey) env.OPENAI_API_KEY = active.apiKey;
      if (active.baseUrl) env.OPENAI_BASE_URL = active.baseUrl;
      env.WHIS_PROVIDER = 'openai';
      break;
    case 'gemini':
      if (active.apiKey) env.GEMINI_API_KEY = active.apiKey;
      env.WHIS_PROVIDER = 'gemini';
      break;
    case 'ollama':
      env.OLLAMA_HOST = active.baseUrl || 'http://localhost:11434';
      env.WHIS_PROVIDER = 'ollama';
      break;
    case 'custom':
      if (active.apiKey) env.WHIS_API_KEY = active.apiKey;
      if (active.baseUrl) env.WHIS_BASE_URL = active.baseUrl;
      env.WHIS_PROVIDER = 'custom';
      break;
  }
  if (active.selectedModel) {
    env.WHIS_MODEL = active.selectedModel;
  }
}

function getDefaultProviders(): ProviderConfig[] {
  return [
    {
      id: 'prov-anthropic',
      name: 'Anthropic',
      type: 'anthropic',
      selectedModel: 'claude-3-7-sonnet-20250219',
      availableModels: ['claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022'],
      isActive: true
    },
    {
      id: 'prov-openai',
      name: 'OpenAI',
      type: 'openai',
      selectedModel: 'gpt-4o',
      availableModels: ['gpt-4o', 'o3-mini', 'gpt-4.5-preview'],
      isActive: false
    },
    {
      id: 'prov-ollama',
      name: 'Local Ollama',
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
      selectedModel: 'llama3.3:70b',
      availableModels: ['llama3.3:70b', 'qwen2.5-coder:32b', 'deepseek-r1:14b'],
      isActive: false
    }
  ];
}
```

---

## 6. Persistence via `better-sqlite3` (`src/main/db.ts`)

Store prompt history, agent metadata, configuration, and logs locally:

```typescript
import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

let dbInstance: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (dbInstance) return dbInstance;

  const userDataDir = app.getPath('userData');
  mkdirSync(userDataDir, { recursive: true });

  const dbPath = join(userDataDir, 'whis.db');
  dbInstance = new Database(dbPath);

  // WAL mode allows concurrent readers without lock contention
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('synchronous = NORMAL');

  runMigrations(dbInstance);
  return dbInstance;
}

function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;

  const MIGRATIONS = [
    (d: Database.Database) => {
      d.exec(`
        CREATE TABLE IF NOT EXISTS kv (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS command_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id TEXT NOT NULL,
          command TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
    }
  ];

  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    MIGRATIONS[i](db);
    db.pragma(`user_version = ${i + 1}`);
  }
}
```

---

## 7. Preload Bridge (`src/preload/index.ts`)

Expose a typed, secure API to the renderer:

```typescript
import { contextBridge, ipcRenderer } from 'electron';
import { ProviderConfig } from '../shared/types';

const api = {
  // PTY Controls
  spawnPty: (id: string, command: string, args: string[], cwd: string, cols?: number, rows?: number) =>
    ipcRenderer.invoke('pty:spawn', { id, command, args, cwd, cols, rows }),
  writePty: (id: string, data: string) => ipcRenderer.send('pty:write', { id, data }),
  resizePty: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  killPty: (id: string) => ipcRenderer.send('pty:kill', { id }),
  onPtyData: (id: string, cb: (data: string) => void) => {
    const channel = `pty:data:${id}`;
    const listener = (_: any, data: string) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onPtyExit: (id: string, cb: (info: { exitCode?: number; signal?: number }) => void) => {
    const channel = `pty:exit:${id}`;
    const listener = (_: any, info: any) => cb(info);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  // Provider Management (Add & Switch Providers)
  getProviders: (): Promise<ProviderConfig[]> => ipcRenderer.invoke('providers:get'),
  saveProviders: (providers: ProviderConfig[]): Promise<void> => ipcRenderer.invoke('providers:save', providers),
  setActiveProvider: (id: string): Promise<void> => ipcRenderer.invoke('providers:setActive', id),

  // App & Updater
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  onUpdateAvailable: (cb: (info: any) => void) => {
    ipcRenderer.on('updater:available', (_, info) => cb(info));
  }
};

contextBridge.exposeInMainWorld('whis', api);
export type WhisAPI = typeof api;
```

---

## 8. Renderer Terminal Component (`src/renderer/src/components/TerminalView.tsx`)

Render the terminal stream smoothly using `@xterm/xterm`:

```tsx
import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

interface Props {
  sessionId: string;
}

export const TerminalView: React.FC<Props> = ({ sessionId }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      theme: {
        background: '#14110C',
        foreground: '#F5EDD8',
        cursor: '#FFD15C',
        selectionBackground: 'rgba(245, 175, 40, 0.3)'
      }
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef.current);
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // Fallback to DOM renderer if WebGL unavailable
    }

    fitAddon.fit();
    termRef.current = term;

    // Send user keystrokes into PTY
    const onDataDisposable = term.onData((data) => {
      window.whis.writePty(sessionId, data);
    });

    // Receive PTY output from main process
    const unsubscribeData = window.whis.onPtyData(sessionId, (data) => {
      term.write(data);
    });

    // Resize observer to auto-fit terminal to panel dimensions
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      window.whis.resizePty(sessionId, term.cols, term.rows);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      onDataDisposable.dispose();
      unsubscribeData();
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [sessionId]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 200 }} />;
};
```

---

## 9. Clean Visual Design & Typography Rules

Avoid pixelated fonts ("Press Start 2P") which look jagged and create uneven card heights. Standardize on modern antialiased typography:

### Design Tokens (`src/renderer/src/design/tokens.css`)
```css
:root {
  /* Crisp antialiased typography */
  --font-sans: "Lato", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: "JetBrains Mono", "Cascadia Code", Consolas, monospace;

  /* Darker Golden Yellow Light Theme */
  --color-bg-canvas: #E5BE53;
  --color-surface-panel: #F2D376;
  --color-surface-inset: #DDB344;
  --color-accent-amber: #B87503;
  --color-ink-primary: #1C1405;
  --color-ink-muted: #5C4A28;
  --color-border: #C99F32;

  /* Symmetrical borders and shadows */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 10px;
  --shadow-subtle: 0 4px 14px rgba(28, 20, 5, 0.12), 0 1px 3px rgba(28, 20, 5, 0.08);
}

/* Global Font Smoothing */
body {
  margin: 0;
  font-family: var(--font-sans);
  background-color: var(--color-bg-canvas);
  color: var(--color-ink-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

### Symmetrical Panel Component (`src/renderer/src/components/PixelPanel.tsx`)
```tsx
import React from 'react';

export const PixelPanel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{
    backgroundColor: 'var(--color-surface-panel)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-subtle)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  }}>
    <div style={{
      padding: '8px 12px', // Symmetrical padding
      fontWeight: 700,
      fontSize: 12,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      borderBottom: '1px solid var(--color-border)',
      backgroundColor: 'var(--color-surface-inset)'
    }}>
      {title}
    </div>
    <div style={{ padding: '12px 14px', flex: 1 }}>
      {children}
    </div>
  </div>
);
```

---

## 10. Packaging Configuration (`electron-builder.yml`)

This configuration packages native C++ addons (`node-pty`, `better-sqlite3`) cleanly and configures multi-platform distribution.

```yaml
appId: com.whis.desktop
productName: Whis
copyright: Copyright © 2026 Whis Team

publish:
  provider: github
  owner: <YOUR_GITHUB_USERNAME>
  repo: <YOUR_REPO_NAME>

releaseInfo:
  releaseNotesFile: RELEASE.md

# Hooks
afterPack: tools/after-pack.cjs

directories:
  output: dist
  buildResources: build

files:
  - out/**
  - package.json
  - "!**/*.{ts,tsx,map}"

# Native dependencies MUST be unpacked from the .asar archive
asarUnpack:
  - "**/node_modules/node-pty/**"
  - "**/node_modules/better-sqlite3/**"

npmRebuild: false

# ---- Windows ----
win:
  icon: build/icon.ico
  target:
    - target: nsis
      arch: [x64]
    - target: portable
      arch: [x64]

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  artifactName: ${productName}-${version}-win-x64-setup.exe
  shortcutName: Whis

portable:
  artifactName: ${productName}-${version}-win-x64-portable.exe

# ---- macOS ----
mac:
  category: public.app-category.developer-tools
  icon: build/icon.icns
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  gatekeeperAssess: false
  target:
    - target: dmg
      arch: [universal]
    - target: zip
      arch: [universal]
  artifactName: ${productName}-${version}-mac-${arch}.${ext}

# ---- Linux ----
linux:
  category: Development
  icon: build/icon.png
  target:
    - target: AppImage
      arch: [x64]
  artifactName: ${productName}-${version}-linux-x86_64.AppImage
```

---

## 11. Critical Helper Tools & Scripts

### A. The Environment-Sanitizing Runner (`tools/package.cjs`)
> **The Problem It Solves:** If GitHub repo secrets for Apple Developer ID are unset, GitHub Actions sets `CSC_LINK=""`. In `electron-builder`, an empty string is treated as a file path, resolving to `/work/REPO/REPO` (the workspace directory), which crashes macOS builds with: `⨯ /work/REPO/REPO not a file`.
>
> `tools/package.cjs` strips empty environment variables and forces `CSC_IDENTITY_AUTO_DISCOVERY=false` on unsigned CI runners.

```javascript
'use strict';
const { spawnSync } = require('child_process');

const env = { ...process.env };

// Strip empty signing / notarization env vars so unsigned builds succeed cleanly
const signingKeys = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'CSC_INSTALLER_LINK',
  'CSC_INSTALLER_KEY_PASSWORD',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'WIN_CSC_LINK',
  'WIN_CSC_KEY_PASSWORD'
];

for (const key of signingKeys) {
  if (env[key] !== undefined && !env[key].trim()) {
    delete env[key];
  }
}

// When building without credentials in CI, disable auto-discovery to prevent keychain queries
if (!env.CSC_LINK && process.platform === 'darwin') {
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
}

const args = process.argv.slice(2);
const cliPath = require.resolve('electron-builder/cli.js');

const res = spawnSync(process.execPath, [cliPath, ...args, '--publish', 'never'], {
  stdio: 'inherit',
  env
});

if (res.error) {
  console.error(res.error);
  process.exit(1);
}

process.exit(res.status ?? 0);
```

### B. Windows PE Binary Icon Patcher (`tools/after-pack.cjs`)
> **The Problem It Solves:** Electron on Windows can fail to embed all icon resolutions into the executable, leaving taskbars and desktop shortcuts showing the default Electron icon. This hook uses `resedit` to patch the PE icon table directly into the built binary.

```javascript
'use strict';
const fs = require('fs');
const path = require('path');
const resedit = require('resedit');

exports.default = async function (context) {
  if (context.electronPlatformName !== 'win32') return;

  const ROOT = path.resolve(__dirname, '..');
  const icoPath = path.join(ROOT, 'build', 'icon.ico');
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);

  if (!fs.existsSync(icoPath) || !fs.existsSync(exePath)) return;

  console.log(`[afterPack] Patching PE icon on ${exePath}...`);
  const icoData = fs.readFileSync(icoPath);
  const iconFile = resedit.Data.IconFile.from(icoData);
  const icons = iconFile.icons.map(item => item.data);

  const exeData = fs.readFileSync(exePath);
  const exe = resedit.NtExecutable.from(exeData);
  const res = resedit.NtExecutableResource.from(exe);

  resedit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 0, icons);
  res.outputResource(exe);
  const newBuf = Buffer.from(exe.generate());
  fs.writeFileSync(exePath, newBuf);
  console.log(`[afterPack] Successfully patched icon in ${exePath}`);
};
```

### C. Local Development Deployment (`tools/deploy-local.ps1`)
Deploys the unpacked application directly to `%LOCALAPPDATA%\Programs\<App>`, updates shortcuts, and clears the Windows shell icon cache:

```powershell
$ErrorActionPreference = "Stop"

$installDir = "$env:LOCALAPPDATA\Programs\Whis"
$distUnpacked = Join-Path $PSScriptRoot "..\dist\win-unpacked"

Write-Host "1. Terminating running processes..."
Get-Process Whis -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

Write-Host "2. Copying build to $installDir..."
if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}
Copy-Item -Path "$distUnpacked\*" -Destination $installDir -Recurse -Force

Write-Host "3. Updating Shortcuts..."
$wscript = New-Object -ComObject WScript.Shell
$desktop = [System.Environment]::GetFolderPath("Desktop")
$startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"

$shortcuts = @(
    (Join-Path $desktop "Whis.lnk"),
    (Join-Path $startMenu "Whis.lnk")
)

foreach ($sc in $shortcuts) {
    $s = $wscript.CreateShortcut($sc)
    $s.TargetPath = Join-Path $installDir "Whis.exe"
    $s.WorkingDirectory = $installDir
    $s.IconLocation = "$(Join-Path $installDir 'Whis.exe'),0"
    $s.Save()
}

Write-Host "4. Refreshing Windows Shell Icon Cache..."
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class ShellNotifier {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);
}
"@ -ErrorAction SilentlyContinue
[ShellNotifier]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Host "Done! Whis deployed locally."
```

---

## 12. GitHub Actions CI/CD Pipeline (`.github/workflows/release.yml`)

A cross-platform build matrix that automatically packages, hashes, and publishes releases to GitHub:

```yaml
name: Release

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build:
    name: Build (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            args: --mac
          - os: windows-2022
            args: --win
          - os: ubuntu-latest
            args: --linux

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      # Pin Python 3.11 with setuptools for node-gyp native compilation
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Provide distutils for node-gyp
        run: python -m pip install --upgrade setuptools

      # Resilient dependency install
      - name: Install dependencies
        run: npm ci || npm install

      - name: Compile (electron-vite → out/)
        run: npm run build

      - name: Package installers
        run: node tools/package.cjs ${{ matrix.args }}
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CSC_LINK: ${{ matrix.os == 'macos-latest' && secrets.APPLE_CERTIFICATE_P12 || '' }}
          CSC_KEY_PASSWORD: ${{ matrix.os == 'macos-latest' && secrets.APPLE_CERTIFICATE_PASSWORD || '' }}
          APPLE_ID: ${{ matrix.os == 'macos-latest' && secrets.APPLE_ID || '' }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ matrix.os == 'macos-latest' && secrets.APPLE_APP_SPECIFIC_PASSWORD || '' }}
          APPLE_TEAM_ID: ${{ matrix.os == 'macos-latest' && secrets.APPLE_TEAM_ID || '' }}

      - name: Generate checksums
        shell: bash
        run: |
          cd dist
          files=$(ls *.dmg *.zip *.exe *.AppImage 2>/dev/null || true)
          [ -z "$files" ] && { echo "no artifacts to hash"; exit 0; }
          if command -v sha256sum >/dev/null 2>&1; then
            sha256sum $files > "SHA256SUMS-${{ matrix.os }}.txt"
          else
            shasum -a 256 $files > "SHA256SUMS-${{ matrix.os }}.txt"
          fi

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.os }}-dist
          path: |
            dist/*.dmg
            dist/*.zip
            dist/*.exe
            dist/*.AppImage
            dist/*.blockmap
            dist/latest*.yml
            dist/SHA256SUMS-*.txt

  publish:
    name: Publish release
    needs: build
    if: startsWith(github.ref, 'refs/tags/')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          path: artifacts

      - name: Flatten + merge checksums
        run: |
          mkdir -p release
          find artifacts -type f \( -name '*.dmg' -o -name '*.zip' -o -name '*.exe' -o -name '*.AppImage' -o -name '*.blockmap' -o -name 'latest*.yml' \) -exec cp {} release/ \;
          cat artifacts/*/SHA256SUMS-*.txt > release/SHA256SUMS.txt 2>/dev/null || true

      - name: Publish to GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          body_path: RELEASE.md
          prerelease: ${{ contains(github.ref_name, '-') }}
          fail_on_unmatched_files: false
          files: |
            release/*.dmg
            release/*.zip
            release/*.exe
            release/*.AppImage
            release/*.blockmap
            release/latest*.yml
            release/SHA256SUMS.txt
```

---

## 13. Troubleshooting & Pitfall Checklist

| Trap | Symptom | Exact Prevention / Fix |
|---|---|---|
| **Lockfile Mismatch** | GitHub runner fails at `npm ci` with `npm ERR! code EUSAGE` | Use `npm ci \|\| npm install` in CI, and run `npm install --package-lock-only --ignore-scripts` when editing `package.json`. |
| **Empty `CSC_LINK` Crash** | `⨯ /work/REPO/REPO not a file` on macOS runners | Run electron-builder through `tools/package.cjs` which deletes empty `CSC_LINK` variables. |
| **Missing Native Module in App** | `Error: Cannot find module 'better-sqlite3'` in packaged app | Declare `asarUnpack: ["**/node_modules/better-sqlite3/**", "**/node_modules/node-pty/**"]` in `electron-builder.yml`. |
| **Old App Icon on Windows** | Windows taskbar or shortcut shows default generic icon | Patch PE resource table via `resedit` in `tools/after-pack.cjs` and call `SHChangeNotify(0x08000000)` on local deploy. |
| **Orphaned CLI Processes** | CLI agent continues running and consuming CPU after closing app | Implement recursive process tree killing with `taskkill /F /T /PID` (Windows) and `pkill -TERM -P` (Unix) on window close and PTY exit. |
| **Pixelated UI & Font Misalignment** | Buttons and panels look blurry or misaligned | Replace pixel fonts ("Press Start 2P") with `Lato` / `Inter`, set `-webkit-font-smoothing: antialiased`, and use symmetrical padding (`8px 12px`). |
| **Terminal Canvas Sizing** | Terminal text cuts off or overflows container | Attach `ResizeObserver` to the terminal DOM container, invoking `fitAddon.fit()` and `window.whis.resizePty(cols, rows)`. |
| **Auto-updater Missing YAML** | Update checker reports 404 or fails | `electron-builder` must generate and publish `latest.yml` (Windows), `latest-mac.yml` (macOS), and `latest-linux.yml` (Linux) alongside the binaries. |
