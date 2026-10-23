// CONCLAVE - Multi-Agent Desktop Application Runtime
(function () {
  "use strict";

  // Application State
  const S = {
    token: new URLSearchParams(window.location.search).get("t") || "",
    projectDir: "",
    branch: "",
    isRepo: false,
    agents: [],
    sessions: {}, // sessionId -> session object
    activeAgent: "all", // "all" or agent ID
    history: [],
    historyIdx: -1,
    overlaps: [],
    portConflicts: [],
    ws: null,
  };

  // Helper DOM selectors
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // Ambient effects: Cursor glow tracker
  const cursorGlow = $("#cursor-glow");
  if (cursorGlow) {
    document.addEventListener("pointermove", (e) => {
      cursorGlow.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
    });
  }

  // ============================================================ BOOT ANIMATION
  const BOOT_LINES = [
    "> CONCLAVE kernel v2.0 — local only, 127.0.0.1",
    "> mounting embedded UI & local vendor assets … ok",
    "> ConPTY pseudo-terminal bridge … ready",
    "> git worktree isolation manager … active",
    "> loading %APPDATA%\\Conclave … ok",
    "> verifying agent presets (opencode, whis, agy, freebuff) … ready",
    "> awaiting workspace command_",
  ];

  async function runBoot() {
    const bootEl = $("#boot");
    const log = $("#boot-log");
    const fill = $("#boot-fill");
    if (!bootEl || !log || !fill) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      log.textContent = BOOT_LINES.join("\n");
      fill.style.width = "100%";
      await new Promise((r) => setTimeout(r, 200));
    } else {
      for (let i = 0; i < BOOT_LINES.length; i++) {
        log.textContent += (i ? "\n" : "") + BOOT_LINES[i];
        fill.style.width = Math.round(((i + 1) / BOOT_LINES.length) * 100) + "%";
        await new Promise((r) => setTimeout(r, 140));
      }
      await new Promise((r) => setTimeout(r, 220));
    }

    bootEl.classList.add("fade-out");
    setTimeout(() => bootEl.classList.add("hidden"), 350);
  }

  // Authenticated API Fetch
  async function api(path, opts = {}) {
    const url = new URL(path, window.location.origin);
    url.searchParams.set("t", S.token);
    const headers = {
      "Content-Type": "application/json",
      "X-Conclave-Token": S.token,
      ...(opts.headers || {}),
    };
    const res = await fetch(url.toString(), { ...opts, headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Request failed (${res.status})`);
    }
    return res.json();
  }

  // Real-time WebSocket connection for Chat & Task Events
  function connectWebSocket() {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}/ws?t=${encodeURIComponent(S.token)}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => console.log("[Conclave] WebSocket connected");
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        handleWsEvent(msg.type, msg.payload);
      } catch (err) {
        console.error("WS error:", err);
      }
    };
    ws.onclose = () => {
      console.log("[Conclave] WS closed. Reconnecting...");
      setTimeout(connectWebSocket, 1500);
    };
    S.ws = ws;
  }

  function handleWsEvent(type, payload) {
    switch (type) {
      case "task-started":
        S.sessions[payload.session.id] = payload;
        renderAgentsSidebar();
        renderChatMessages();
        loadChangesForActiveAgent();
        updateTerminalDirectory();
        break;
      case "chat-message":
        if (!S.sessions[payload.sessionId]) {
          S.sessions[payload.sessionId] = { session: { id: payload.sessionId, agentId: payload.agentId }, messages: [] };
        }
        S.sessions[payload.sessionId].messages.push(payload);
        appendChatMessage(payload);
        loadChangesForActiveAgent();
        break;
      case "agent-status":
        updateAgentStatus(payload.agentId, payload.status);
        break;
      case "overlaps-updated":
        S.overlaps = payload;
        renderOverlaps();
        break;
      case "task-merged":
      case "task-discarded":
        delete S.sessions[payload.sessionId];
        renderAgentsSidebar();
        renderChatMessages();
        loadChangesForActiveAgent();
        updateTerminalDirectory();
        break;
      case "agents-updated":
        S.agents = payload;
        renderAgentsSidebar();
        break;
    }
  }

  // ============================================================ INITIALIZE APP
  async function init() {
    try {
      // Start cyber ember boot animation
      runBoot();

      const boot = await api("/api/bootstrap");
      S.projectDir = boot.projectDir || "";
      S.isRepo = boot.isRepo;
      S.branch = boot.branch || "";
      S.agents = boot.agents || [];
      S.overlaps = boot.overlaps || [];
      S.portConflicts = boot.portConflicts || [];

      if (boot.sessions) {
        for (const s of boot.sessions) {
          S.sessions[s.id] = { session: s, messages: [] };
        }
      }

      updateProjectUI();
      renderAgentsSidebar();
      renderChatMessages();
      renderOverlaps();
      connectWebSocket();
      setupEventListeners();
      setupResizers();
    } catch (err) {
      console.error("Bootstrap error:", err);
    }
  }

  function updateProjectUI() {
    const overlay = $("#empty-state-overlay");
    const pName = $("#project-name");
    const bBadge = $("#branch-badge");

    if (S.projectDir) {
      const parts = S.projectDir.split(/[\\/]/);
      pName.textContent = parts[parts.length - 1] || S.projectDir;
      pName.title = S.projectDir;
      if (S.isRepo) {
        bBadge.textContent = S.branch || "main";
        bBadge.classList.remove("hidden");
        overlay.classList.add("hidden");
      } else {
        bBadge.classList.add("hidden");
        overlay.classList.remove("hidden");
        $("#btn-init-repo").classList.remove("hidden");
        $("#empty-state-hint").textContent = "Directory is not a git repository. Click 'Git Init & Continue' to initialize.";
      }
    } else {
      pName.textContent = "No Project Open";
      pName.title = "Click to select a project folder";
      bBadge.classList.add("hidden");
      overlay.classList.remove("hidden");
    }

    // Update modal fields
    $("#modal-project-dir").textContent = S.projectDir || "No folder selected";
    $("#modal-path-input").value = S.projectDir || "";
    $("#modal-git-status").textContent = S.isRepo ? "Valid Git Repository" : "Not a Git Repository";
    $("#modal-git-status").style.color = S.isRepo ? "var(--success)" : "var(--error)";
    $("#modal-branch-status").textContent = S.branch || (S.isRepo ? "main" : "None");
    $("#btn-modal-init-git").classList.toggle("hidden", S.isRepo || !S.projectDir);

    updateTerminalDirectory();
  }

  // Sidebar Agents Rendering
  function renderAgentsSidebar() {
    const list = $("#agents-list");
    list.innerHTML = "";

    S.agents.forEach((agent) => {
      const activeSession = Object.values(S.sessions).find((s) => s.session && s.session.agentId === agent.id);
      const status = activeSession ? activeSession.status || "working" : "idle";

      const item = document.createElement("div");
      item.className = `agent-item ${S.activeAgent === agent.id ? "active" : ""}`;
      item.dataset.agentId = agent.id;

      item.innerHTML = `
        <span class="agent-dot dot-${status}" style="${status === 'idle' ? 'background:' + agent.color : ''}"></span>
        <div class="agent-info">
          <span class="agent-label" style="color: ${agent.color}">${agent.name}</span>
          <span class="agent-sub">${activeSession ? activeSession.session.task : "Idle"}</span>
        </div>
      `;

      item.onclick = () => selectAgent(agent.id);
      list.appendChild(item);
    });

    // All agents selection state
    $("#item-all-agents").classList.toggle("active", S.activeAgent === "all");
    $("#item-all-agents").onclick = () => selectAgent("all");
  }

  function updateAgentStatus(agentId, status) {
    const activeSession = Object.values(S.sessions).find((s) => s.session && s.session.agentId === agentId);
    if (activeSession) {
      activeSession.status = status;
    }
    renderAgentsSidebar();
  }

  function selectAgent(agentId) {
    S.activeAgent = agentId;
    renderAgentsSidebar();

    const dot = $("#header-agent-dot");
    const name = $("#header-agent-name");
    const branch = $("#header-agent-branch");
    const redirectBtn = $("#btn-redirect-toggle");

    if (agentId === "all") {
      dot.className = "active-agent-dot dot-all";
      dot.style.background = "var(--amber)";
      name.textContent = "All Agents";
      branch.textContent = "";
      redirectBtn.classList.add("hidden");
    } else {
      const agent = S.agents.find((a) => a.id === agentId);
      const activeSession = Object.values(S.sessions).find((s) => s.session && s.session.agentId === agentId);

      dot.className = "active-agent-dot";
      dot.style.background = agent ? agent.color : "var(--amber)";
      name.textContent = agent ? agent.name : agentId;

      if (activeSession) {
        branch.textContent = `[${activeSession.session.branch}]`;
        redirectBtn.classList.remove("hidden");
      } else {
        branch.textContent = "";
        redirectBtn.classList.add("hidden");
      }
    }

    renderChatMessages();
    loadChangesForActiveAgent();
    updateTerminalDirectory();
  }

  // ============================================================ CHAT & MESSAGES
  function renderChatMessages() {
    const container = $("#chat-messages");
    container.innerHTML = "";

    const messages = getActiveMessages();
    if (messages.length === 0) {
      container.innerHTML = `<div class="empty-state-muted">No messages yet. Enter a task below to start an isolated worktree session.</div>`;
      return;
    }

    messages.forEach((msg) => appendChatMessage(msg, false));
    container.scrollTop = container.scrollHeight;
  }

  function getActiveMessages() {
    let msgs = [];
    if (S.activeAgent === "all") {
      Object.values(S.sessions).forEach((s) => {
        if (s.messages) msgs.push(...s.messages);
      });
      msgs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    } else {
      const sess = Object.values(S.sessions).find((s) => s.session && s.session.agentId === S.activeAgent);
      if (sess && sess.messages) {
        msgs = sess.messages;
      }
    }
    return msgs;
  }

  function appendChatMessage(msg, shouldScroll = true) {
    if (S.activeAgent !== "all" && msg.agentId !== S.activeAgent) {
      return;
    }

    const container = $("#chat-messages");
    if (container.querySelector(".empty-state-muted")) {
      container.innerHTML = "";
    }

    const agent = S.agents.find((a) => a.id === msg.agentId);
    const agentName = agent ? agent.name : msg.agentId;
    const agentColor = agent ? agent.color : "var(--amber)";

    // 1. Tool Call Card (Collapsible)
    if (msg.type === "tool-call") {
      const card = document.createElement("div");
      card.className = "activity-card";
      card.innerHTML = `
        <div class="activity-header">
          <div class="activity-header-left">
            <span class="activity-icon">⚙</span>
            <span class="activity-agent" style="color: ${agentColor}">${escapeHtml(agentName)}</span>
            <span class="activity-tool">ran tool <strong>${escapeHtml(msg.tool)}</strong></span>
          </div>
          <span class="activity-toggle">▾</span>
        </div>
        <div class="activity-body">
          <pre>${escapeHtml(msg.args || msg.content)}</pre>
        </div>
      `;
      card.querySelector(".activity-header").onclick = () => card.classList.toggle("open");
      container.appendChild(card);
    }
    // 2. File Edit Card
    else if (msg.type === "file-edit") {
      const card = document.createElement("div");
      card.className = "activity-card";
      card.innerHTML = `
        <div class="activity-header">
          <div class="activity-header-left">
            <span class="activity-icon">✎</span>
            <span class="activity-agent" style="color: ${agentColor}">${escapeHtml(agentName)}</span>
            <span class="activity-tool">edited <code>${escapeHtml(msg.filePath)}</code></span>
            ${msg.diffSummary ? `<span class="diff-stat">${escapeHtml(msg.diffSummary)}</span>` : ""}
          </div>
          <span class="activity-toggle">▾</span>
        </div>
        <div class="activity-body">
          <pre>${escapeHtml(msg.content)}</pre>
        </div>
      `;
      card.querySelector(".activity-header").onclick = () => card.classList.toggle("open");
      container.appendChild(card);
    }
    // 3. Regular Chat Bubble
    else {
      const bubble = document.createElement("div");
      bubble.className = `chat-bubble bubble-${msg.sender}`;
      const headerHtml =
        msg.sender !== "user"
          ? `<div class="bubble-header" style="color: ${agentColor}">${escapeHtml(agentName)}</div>`
          : "";

      bubble.innerHTML = `
        ${headerHtml}
        <div class="bubble-content">${escapeHtml(msg.content)}</div>
      `;
      container.appendChild(bubble);
    }

    if (shouldScroll) {
      container.scrollTop = container.scrollHeight;
    }
  }

  // ============================================================ CHANGES & MERGE
  async function loadChangesForActiveAgent() {
    const filesList = $("#changed-files-list");
    const diffCode = $("#diff-code");
    const diffTitle = $("#diff-file-title");
    const badge = $("#changes-count");
    const alerts = $("#panel-alerts");
    alerts.innerHTML = "";

    const activeSession = Object.values(S.sessions).find((s) => s.session && s.session.agentId === S.activeAgent);

    if (!activeSession) {
      filesList.innerHTML = `<div class="empty-state-muted">No active worktree for this agent.</div>`;
      diffCode.textContent = "Select a task with changes to view diff.";
      badge.textContent = "0 files";
      return;
    }

    try {
      const res = await api(`/api/changes?sessionId=${encodeURIComponent(activeSession.session.id)}`);
      badge.textContent = `${res.files ? res.files.length : 0} files`;

      // Render Scope Violations
      if (res.scopeViolations && res.scopeViolations.length > 0) {
        alerts.innerHTML += `
          <div class="alert-box alert-warning">
            ⚠️ <strong>Scope Violation:</strong> Changes outside scope (${escapeHtml(activeSession.session.fileScope)}):
            <ul>${res.scopeViolations.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>
          </div>
        `;
      }

      // Render Overlaps
      const agentOverlaps = S.overlaps.filter((o) => o.agents.includes(activeSession.session.agentId));
      if (agentOverlaps.length > 0) {
        alerts.innerHTML += `
          <div class="alert-box alert-danger">
            🚨 <strong>Overlap Warning:</strong> This agent shares modified files with another agent worktree!
            <ul>${agentOverlaps.map((o) => `<li>${escapeHtml(o.file)} (with ${o.agents.join(", ")})</li>`).join("")}</ul>
          </div>
        `;
      }

      // Render Files
      if (!res.files || res.files.length === 0) {
        filesList.innerHTML = `<div class="empty-state-muted">No files modified in worktree yet.</div>`;
      } else {
        filesList.innerHTML = "";
        res.files.forEach((f) => {
          const row = document.createElement("div");
          row.className = "file-item";
          row.innerHTML = `
            <div class="file-item-left">
              <span class="file-status-${f.status}">${f.status}</span>
              <span>${escapeHtml(f.path)}</span>
            </div>
            <span class="diff-stat">+${f.added} -${f.deleted}</span>
          `;
          filesList.appendChild(row);
        });
      }

      // Render Unified Diff
      if (res.diff) {
        diffTitle.textContent = `Diff (${activeSession.session.branch})`;
        renderColoredDiff(res.diff);
      } else {
        diffTitle.textContent = "Unified Diff";
        diffCode.textContent = "No unstaged or committed changes.";
      }
    } catch (err) {
      console.error("Failed to load changes:", err);
    }
  }

  function renderColoredDiff(diffText) {
    const diffCode = $("#diff-code");
    diffCode.innerHTML = "";
    const lines = diffText.split("\n");

    lines.forEach((line) => {
      const span = document.createElement("div");
      if (line.startsWith("+") && !line.startsWith("+++")) {
        span.className = "diff-line-add";
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        span.className = "diff-line-del";
      } else if (line.startsWith("@@")) {
        span.className = "diff-line-header";
      }
      span.textContent = line;
      diffCode.appendChild(span);
    });
  }

  function renderOverlaps() {
    const banner = $("#overlap-banner");
    const text = $("#overlap-text");

    if (S.overlaps.length > 0) {
      banner.classList.remove("hidden");
      const files = S.overlaps.map((o) => o.file).join(", ");
      text.textContent = `Overlap Alert: ${files}`;
    } else {
      banner.classList.add("hidden");
    }
  }

  // ============================================================ TASK EXECUTION
  async function sendTask() {
    const input = $("#composer-input");
    const text = input.value.trim();
    if (!text) return;

    // Up-arrow history
    S.history.push(text);
    S.historyIdx = S.history.length;

    let targetAgent = S.activeAgent;
    let taskText = text;

    // @agent targeting
    const atMatch = text.match(/^@([a-zA-Z0-9_-]+)\s*(.*)$/);
    if (atMatch) {
      targetAgent = atMatch[1];
      taskText = atMatch[2];
    }

    if (targetAgent === "all") {
      targetAgent = S.agents[0] ? S.agents[0].id : "whis";
    }

    const fileScope = $("#input-file-scope").value.trim();
    input.value = "";

    try {
      const res = await api("/api/task/start", {
        method: "POST",
        body: JSON.stringify({
          agentId: targetAgent,
          task: taskText,
          fileScope: fileScope,
        }),
      });

      S.sessions[res.session.id] = { session: res.session, messages: [] };
      selectAgent(targetAgent);
      renderAgentsSidebar();
    } catch (err) {
      alert(`Error starting task: ${err.message}`);
    }
  }

  // Stage 5: Mid-Task Redirect (Soft vs Hard)
  async function executeRedirect() {
    const activeSession = Object.values(S.sessions).find((s) => s.session && s.session.agentId === S.activeAgent);
    if (!activeSession) return;

    const input = $("#redirect-input");
    const newDirection = input.value.trim();
    if (!newDirection) return;

    const mode = $("input[name='redirect-mode']:checked").value;

    try {
      await api("/api/task/redirect", {
        method: "POST",
        body: JSON.stringify({
          sessionId: activeSession.session.id,
          direction: newDirection,
          mode: mode,
        }),
      });

      input.value = "";
      $("#redirect-drawer").classList.add("hidden");
    } catch (err) {
      alert(`Redirect failed: ${err.message}`);
    }
  }

  // Stage 4: Safe Merge
  async function executeMerge() {
    const activeSession = Object.values(S.sessions).find((s) => s.session && s.session.agentId === S.activeAgent);
    if (!activeSession) return;

    if (!confirm(`Merge changes from worktree '${activeSession.session.branch}' into main?`)) return;

    try {
      const res = await api("/api/merge", {
        method: "POST",
        body: JSON.stringify({ sessionId: activeSession.session.id }),
      });

      if (res.conflict) {
        alert(`MERGE CONFLICT REPORTED:\n\n${res.conflictDetails}\n\nAuto-merge aborted to preserve worktree.`);
      } else {
        alert("Merge successfully completed into main!");
        delete S.sessions[activeSession.session.id];
        renderAgentsSidebar();
        renderChatMessages();
        loadChangesForActiveAgent();
      }
    } catch (err) {
      alert(`Merge error: ${err.message}`);
    }
  }

  async function executeDiscard() {
    const activeSession = Object.values(S.sessions).find((s) => s.session && s.session.agentId === S.activeAgent);
    if (!activeSession) return;

    if (!confirm(`Discard all worktree changes and delete branch '${activeSession.session.branch}'? This cannot be undone.`)) return;

    try {
      await api("/api/discard", {
        method: "POST",
        body: JSON.stringify({ sessionId: activeSession.session.id }),
      });

      delete S.sessions[activeSession.session.id];
      renderAgentsSidebar();
      renderChatMessages();
      loadChangesForActiveAgent();
    } catch (err) {
      alert(`Discard error: ${err.message}`);
    }
  }

  function askReview() {
    const activeSession = Object.values(S.sessions).find((s) => s.session && s.session.agentId === S.activeAgent);
    if (!activeSession) return;

    const reviewer = prompt("Which agent should review these changes?", "whis");
    if (!reviewer) return;

    $("#composer-input").value = `@${reviewer} Please review the diff and changes from agent ${activeSession.session.agentId} in branch ${activeSession.session.branch}.`;
    $("#composer-input").focus();
  }

  async function toggleRawLogs() {
    const drawer = $("#raw-logs-drawer");
    if (drawer.classList.contains("hidden")) {
      const activeSession = Object.values(S.sessions).find((s) => s.session && s.session.agentId === S.activeAgent);
      if (!activeSession) {
        $("#raw-logs-content").textContent = "No active session for this agent.";
      } else {
        const url = new URL("/api/logs", window.location.origin);
        url.searchParams.set("t", S.token);
        url.searchParams.set("sessionId", activeSession.session.id);
        const res = await fetch(url.toString());
        const text = await res.text();
        $("#raw-logs-content").textContent = text || "No logs captured.";
      }
      drawer.classList.remove("hidden");
    } else {
      drawer.classList.add("hidden");
    }
  }

  // ============================================================ INTERACTIVE TERMINAL
  let xtermInst = null;
  let fitAddon = null;
  let termWs = null;
  let activeTermAgent = "whis";

  function openTerminalDrawer(agentId) {
    if (agentId && agentId !== "all") {
      activeTermAgent = agentId;
    } else if (S.activeAgent !== "all") {
      activeTermAgent = S.activeAgent;
    } else if (S.agents.length > 0) {
      activeTermAgent = S.agents[0].id;
    }

    const drawer = $("#terminal-drawer");
    drawer.classList.remove("hidden");

    // Update drawer badge
    const ag = S.agents.find((a) => a.id === activeTermAgent);
    $("#terminal-agent-name").textContent = ag ? ag.name : activeTermAgent;
    $("#terminal-agent-dot").style.background = ag ? ag.color : "var(--amber)";

    updateTerminalDirectory();
    initXterm(activeTermAgent);
  }

  function updateTerminalDirectory() {
    let dir = S.projectDir;
    const activeSess = Object.values(S.sessions).find((s) => s.session && s.session.agentId === activeTermAgent);
    if (activeSess && activeSess.session && activeSess.session.worktreePath) {
      dir = activeSess.session.worktreePath;
    }
    const pathEl = $("#terminal-dir-path");
    if (pathEl) {
      pathEl.textContent = dir || "No directory selected";
      pathEl.title = dir || "";
    }
  }

  function initXterm(agentId) {
    const container = $("#terminal-xterm-host");
    if (!window.Terminal) {
      console.warn("xterm.js not loaded");
      return;
    }

    if (!xtermInst) {
      xtermInst = new window.Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 13,
        lineHeight: 1.25,
        fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
        theme: {
          background: "#0C0A07",
          foreground: "#F5EDD8",
          cursor: "#F5AF28",
          selectionBackground: "rgba(245, 175, 40, 0.35)",
          black: "#0C0A07",
          red: "#FF6B4A",
          green: "#7BC96F",
          yellow: "#FFD15C",
          blue: "#38BDF8",
          magenta: "#F472B6",
          cyan: "#2DD4BF",
          white: "#F5EDD8",
          brightBlack: "#8A7F6B",
          brightRed: "#FF876C",
          brightGreen: "#98E28C",
          brightYellow: "#FFE082",
          brightBlue: "#7DD3FC",
          brightMagenta: "#F9A8D4",
          brightCyan: "#5EEAD4",
          brightWhite: "#FFF9EB",
        },
      });

      if (window.FitAddon && window.FitAddon.FitAddon) {
        fitAddon = new window.FitAddon.FitAddon();
        xtermInst.loadAddon(fitAddon);
      }

      xtermInst.open(container);

      xtermInst.onData((data) => {
        if (termWs && termWs.readyState === WebSocket.OPEN) {
          termWs.send(JSON.stringify({ type: "input", data }));
        }
      });

      window.addEventListener("resize", () => {
        if (fitAddon && !$("#terminal-drawer").classList.contains("hidden")) {
          fitAddon.fit();
          if (termWs && termWs.readyState === WebSocket.OPEN) {
            termWs.send(JSON.stringify({ type: "resize", cols: xtermInst.cols, rows: xtermInst.rows }));
          }
        }
      });
    }

    setTimeout(() => {
      if (fitAddon) fitAddon.fit();
      xtermInst.focus();
    }, 60);

    connectTermWs(agentId);
  }

  function connectTermWs(agentId) {
    if (termWs) {
      termWs.close();
      termWs = null;
    }

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const cols = xtermInst ? xtermInst.cols : 120;
    const rows = xtermInst ? xtermInst.rows : 30;
    const url = `${proto}//${window.location.host}/ws/term?t=${encodeURIComponent(S.token)}&agentId=${encodeURIComponent(agentId)}&cols=${cols}&rows=${rows}`;

    termWs = new WebSocket(url);
    termWs.onopen = () => {
      console.log("[Conclave Term] Connected for agent:", agentId);
    };
    termWs.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "init") {
          $("#terminal-dir-path").textContent = msg.dir;
          $("#terminal-dir-path").title = msg.dir;
        } else if (msg.type === "output") {
          xtermInst.write(msg.data);
        } else if (msg.type === "error") {
          xtermInst.write(`\r\n\x1b[31m[Conclave Error] ${msg.message}\x1b[0m\r\n`);
        }
      } catch {
        xtermInst.write(e.data);
      }
    };
    termWs.onclose = () => {
      console.log("[Conclave Term] Disconnected");
    };
  }

  // ============================================================ WORKSPACE & FOLDERS
  async function browseFolder() {
    try {
      const res = await api("/api/project/browse", { method: "POST" });
      if (res && res.path) {
        $("#project-path-input").value = res.path;
        $("#modal-path-input").value = res.path;
      }
    } catch (err) {
      console.error("Browse folder error:", err);
    }
  }

  async function revealFolder(path) {
    try {
      await api("/api/project/reveal", {
        method: "POST",
        body: JSON.stringify({ path: path || S.projectDir }),
      });
    } catch (err) {
      console.error("Reveal error:", err);
    }
  }

  function openWorkspaceModal() {
    $("#modal-project-dir").textContent = S.projectDir || "No project folder selected";
    $("#modal-path-input").value = S.projectDir || "";
    $("#modal-git-status").textContent = S.isRepo ? "Valid Git Repository" : "Not a Git Repository";
    $("#modal-git-status").style.color = S.isRepo ? "var(--success)" : "var(--error)";
    $("#modal-branch-status").textContent = S.branch || (S.isRepo ? "main" : "None");
    $("#btn-modal-init-git").classList.toggle("hidden", S.isRepo || !S.projectDir);
    $("#modal-workspace").classList.remove("hidden");
  }

  // ============================================================ EVENT LISTENERS
  function setupEventListeners() {
    $("#btn-send").onclick = sendTask;

    $("#composer-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendTask();
      } else if (e.key === "ArrowUp" && e.target.value === "") {
        if (S.history.length > 0 && S.historyIdx > 0) {
          S.historyIdx--;
          e.target.value = S.history[S.historyIdx] || "";
        }
      } else if (e.key === "ArrowDown") {
        if (S.historyIdx < S.history.length - 1) {
          S.historyIdx++;
          e.target.value = S.history[S.historyIdx] || "";
        } else {
          S.historyIdx = S.history.length;
          e.target.value = "";
        }
      }
    });

    $("#btn-toggle-scope").onclick = () => $("#composer-scope-row").classList.toggle("hidden");
    $("#btn-redirect-toggle").onclick = () => $("#redirect-drawer").classList.toggle("hidden");
    $("#btn-close-redirect").onclick = () => $("#redirect-drawer").classList.add("hidden");
    $("#btn-execute-redirect").onclick = executeRedirect;
    $("#btn-merge-task").onclick = executeMerge;
    $("#btn-discard-task").onclick = executeDiscard;
    $("#btn-ask-review").onclick = askReview;
    $("#btn-toggle-raw-logs").onclick = toggleRawLogs;
    $("#btn-close-logs").onclick = () => $("#raw-logs-drawer").classList.add("hidden");

    // Terminal Drawer Actions
    $("#btn-top-terminal").onclick = () => openTerminalDrawer();
    $("#btn-agent-terminal").onclick = () => openTerminalDrawer(S.activeAgent);
    $("#btn-close-terminal").onclick = () => $("#terminal-drawer").classList.add("hidden");

    $("#btn-clear-terminal").onclick = () => {
      if (xtermInst) xtermInst.clear();
      if (termWs && termWs.readyState === WebSocket.OPEN) {
        termWs.send(JSON.stringify({ type: "clear" }));
      }
    };
    $("#btn-restart-terminal").onclick = () => {
      if (xtermInst) xtermInst.clear();
      connectTermWs(activeTermAgent);
    };

    $$(".quick-cmd-btn").forEach((btn) => {
      btn.onclick = () => {
        const cmd = btn.dataset.cmd;
        if (termWs && termWs.readyState === WebSocket.OPEN) {
          termWs.send(JSON.stringify({ type: "command", command: cmd }));
          if (xtermInst) xtermInst.focus();
        }
      };
    });

    $("#btn-reveal-terminal-dir").onclick = () => {
      const p = $("#terminal-dir-path").textContent;
      if (p && p !== "C:\\...") revealFolder(p);
    };
    $("#btn-copy-terminal-dir").onclick = () => {
      const p = $("#terminal-dir-path").textContent;
      if (p) {
        navigator.clipboard.writeText(p);
        const orig = $("#btn-copy-terminal-dir").textContent;
        $("#btn-copy-terminal-dir").textContent = "✓";
        setTimeout(() => ($("#btn-copy-terminal-dir").textContent = orig), 1200);
      }
    };

    // Workspace & Project Opening
    $("#project-indicator").onclick = openWorkspaceModal;
    $("#btn-workspace").onclick = openWorkspaceModal;
    $("#btn-close-workspace-modal").onclick = () => $("#modal-workspace").classList.add("hidden");

    $("#btn-browse-folder").onclick = browseFolder;
    $("#btn-modal-browse").onclick = browseFolder;
    $("#btn-modal-reveal").onclick = () => revealFolder(S.projectDir);

    $("#btn-open-project").onclick = async () => {
      const path = $("#project-path-input").value.trim();
      if (!path) return;
      try {
        const res = await api("/api/project/open", { method: "POST", body: JSON.stringify({ path }) });
        S.projectDir = res.projectDir;
        S.isRepo = res.isRepo;
        S.branch = res.branch;
        updateProjectUI();
      } catch (err) {
        alert(err.message);
      }
    };

    $("#btn-modal-apply-path").onclick = async () => {
      const path = $("#modal-path-input").value.trim();
      if (!path) return;
      try {
        const res = await api("/api/project/open", { method: "POST", body: JSON.stringify({ path }) });
        S.projectDir = res.projectDir;
        S.isRepo = res.isRepo;
        S.branch = res.branch;
        updateProjectUI();
        $("#modal-workspace").classList.add("hidden");
      } catch (err) {
        alert(err.message);
      }
    };

    $("#btn-init-repo").onclick = async () => {
      try {
        const res = await api("/api/project/init", { method: "POST" });
        S.isRepo = true;
        S.branch = res.branch;
        updateProjectUI();
      } catch (err) {
        alert(err.message);
      }
    };

    $("#btn-modal-init-git").onclick = async () => {
      try {
        const res = await api("/api/project/init", { method: "POST" });
        S.isRepo = true;
        S.branch = res.branch;
        updateProjectUI();
      } catch (err) {
        alert(err.message);
      }
    };

    // Keyboard Shortcuts
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        $("#modal-palette").classList.toggle("hidden");
        if (!$("#modal-palette").classList.contains("hidden")) {
          $("#palette-search").focus();
        }
      } else if (e.key === "?" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        $("#modal-shortcuts").classList.toggle("hidden");
      } else if (e.key === "Escape") {
        $$(".modal-overlay").forEach((m) => m.classList.add("hidden"));
        $("#redirect-drawer").classList.add("hidden");
      }
    });

    $("#btn-palette").onclick = () => $("#modal-palette").classList.remove("hidden");
    $("#btn-shortcuts").onclick = () => $("#modal-shortcuts").classList.remove("hidden");
    $("#btn-close-shortcuts").onclick = () => $("#modal-shortcuts").classList.add("hidden");
    $("#btn-settings").onclick = openAgentsModal;
    $("#btn-close-agents-modal").onclick = () => $("#modal-agents").classList.add("hidden");
    $("#btn-save-agents").onclick = saveAgentsFromModal;
  }

  function openAgentsModal() {
    const list = $("#agents-config-list");
    list.innerHTML = "";

    S.agents.forEach((ag, idx) => {
      const card = document.createElement("div");
      card.className = "activity-card";
      card.style.marginBottom = "10px";
      card.innerHTML = `
        <div class="activity-header">
          <strong>${escapeHtml(ag.name)} (${ag.command})</strong>
          <span style="color:${ag.color}">● ${ag.probeResult?.mode || ag.modeOverride}</span>
        </div>
        <div class="activity-body" style="display:flex; flex-direction:column; gap:6px;">
          <div>Name: <input type="text" class="input input-sm" data-idx="${idx}" data-field="name" value="${escapeHtml(ag.name)}"></div>
          <div>Color: <input type="text" class="input input-sm" data-idx="${idx}" data-field="color" value="${escapeHtml(ag.color)}"></div>
          <div>Command: <input type="text" class="input input-sm" data-idx="${idx}" data-field="command" value="${escapeHtml(ag.command)}"></div>
          <div>Brief: <textarea class="input input-sm" data-idx="${idx}" data-field="systemBrief">${escapeHtml(ag.systemBrief || "")}</textarea></div>
        </div>
      `;
      list.appendChild(card);
    });

    $("#modal-agents").classList.remove("hidden");
  }

  async function saveAgentsFromModal() {
    const inputs = $$("#agents-config-list [data-idx]");
    inputs.forEach((inp) => {
      const idx = parseInt(inp.dataset.idx, 10);
      const field = inp.dataset.field;
      if (S.agents[idx]) {
        S.agents[idx][field] = inp.value;
      }
    });

    try {
      await api("/api/agents/update", {
        method: "POST",
        body: JSON.stringify(S.agents),
      });
      $("#modal-agents").classList.add("hidden");
      renderAgentsSidebar();
      alert("Agents saved successfully!");
    } catch (err) {
      alert(`Failed to save agents: ${err.message}`);
    }
  }

  function setupResizers() {
    // Column splitters
    const colSidebar = $("#col-sidebar");
    const colChat = $("#col-chat");
    const colChanges = $("#col-changes");
    const resizer1 = $("#resizer-1");
    const resizer2 = $("#resizer-2");

    let isResizing1 = false;
    let isResizing2 = false;

    if (resizer1) {
      resizer1.addEventListener("mousedown", () => (isResizing1 = true));
    }
    if (resizer2) {
      resizer2.addEventListener("mousedown", () => (isResizing2 = true));
    }

    document.addEventListener("mousemove", (e) => {
      if (isResizing1 && colSidebar) {
        const newWidth = Math.max(180, Math.min(450, e.clientX));
        colSidebar.style.width = `${newWidth}px`;
      }
      if (isResizing2 && colChanges) {
        const newWidth = Math.max(240, Math.min(600, window.innerWidth - e.clientX));
        colChanges.style.width = `${newWidth}px`;
      }
    });

    document.addEventListener("mouseup", () => {
      isResizing1 = false;
      isResizing2 = false;
    });
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
