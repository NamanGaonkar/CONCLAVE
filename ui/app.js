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

  // Real-time WebSocket connection
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
        break;
      case "agents-updated":
        S.agents = payload;
        renderAgentsSidebar();
        break;
    }
  }

  // Initialize Application
  async function init() {
    try {
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
      bBadge.classList.add("hidden");
      overlay.classList.remove("hidden");
    }
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
      name.textContent = "All Agents";
      dot.className = "active-agent-dot dot-all";
      dot.style.background = "var(--amber)";
      branch.textContent = "Unified View";
      redirectBtn.classList.add("hidden");
    } else {
      const agent = S.agents.find((a) => a.id === agentId);
      const activeSession = Object.values(S.sessions).find((s) => s.session && s.session.agentId === agentId);
      name.textContent = agent ? agent.name : agentId;
      dot.style.background = agent ? agent.color : "var(--amber)";
      branch.textContent = activeSession ? activeSession.session.branch : "no active worktree";
      redirectBtn.classList.toggle("hidden", !activeSession);
    }

    renderChatMessages();
    loadChangesForActiveAgent();
  }

  // Chat Rendering (Bubbles & Collapsible Activity Cards)
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
      Object.values(S.sessions).forEach((sess) => {
        if (sess.messages) msgs.push(...sess.messages);
      });
      msgs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    } else {
      const activeSession = Object.values(S.sessions).find((s) => s.session && s.session.agentId === S.activeAgent);
      if (activeSession && activeSession.messages) {
        msgs = activeSession.messages;
      }
    }
    return msgs;
  }

  function appendChatMessage(msg, autoScroll = true) {
    if (S.activeAgent !== "all" && msg.agentId !== S.activeAgent) {
      return;
    }

    const container = $("#chat-messages");
    // Clear empty state text if present
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
          <div class="activity-left">
            <span class="badge-tool">Tool Call</span>
            <strong>${escapeHtml(msg.tool || "Command")}</strong>
          </div>
          <span class="activity-chevron">▾</span>
        </div>
        <div class="activity-body">${escapeHtml(msg.args || msg.content)}</div>
      `;
      card.querySelector(".activity-header").onclick = () => {
        const body = card.querySelector(".activity-body");
        const chevron = card.querySelector(".activity-chevron");
        const isClosed = body.classList.toggle("hidden");
        chevron.textContent = isClosed ? "▸" : "▾";
      };
      container.appendChild(card);
    }
    // 2. File Edit Card (Collapsible)
    else if (msg.type === "file-edit") {
      const card = document.createElement("div");
      card.className = "activity-card";
      card.innerHTML = `
        <div class="activity-header">
          <div class="activity-left">
            <span class="badge-file">File Changed</span>
            <strong>${escapeHtml(msg.filePath || "File")}</strong>
            ${msg.diffSummary ? `<span class="diff-stat-badge">${escapeHtml(msg.diffSummary)}</span>` : ""}
          </div>
          <span class="activity-chevron">▾</span>
        </div>
        <div class="activity-body">${escapeHtml(msg.content)}</div>
      `;
      card.querySelector(".activity-header").onclick = () => {
        const body = card.querySelector(".activity-body");
        const chevron = card.querySelector(".activity-chevron");
        const isClosed = body.classList.toggle("hidden");
        chevron.textContent = isClosed ? "▸" : "▾";
      };
      container.appendChild(card);
    }
    // 3. User / Agent Chat Bubble
    else {
      const bubble = document.createElement("div");
      const isUser = msg.sender === "user";
      const isRedirect = msg.type === "redirect";

      bubble.className = `chat-bubble ${isRedirect ? "bubble-redirect" : isUser ? "bubble-user" : "bubble-agent"}`;
      bubble.innerHTML = `
        <div class="bubble-meta">
          <strong style="color: ${isUser ? 'var(--text)' : agentColor}">${isUser ? 'You' : agentName}</strong>
          <span>${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="bubble-content">${escapeHtml(msg.content)}</div>
      `;
      container.appendChild(bubble);
    }

    if (autoScroll) {
      container.scrollTop = container.scrollHeight;
    }
  }

  // Changes, Review & Merge Panel (Stage 4)
  async function loadChangesForActiveAgent() {
    const filesList = $("#changed-files-list");
    const diffCode = $("#diff-code");
    const badge = $("#changes-count");
    const alerts = $("#panel-alerts");

    alerts.innerHTML = "";

    const activeSession = S.activeAgent === "all"
      ? Object.values(S.sessions)[0]
      : Object.values(S.sessions).find((s) => s.session && s.session.agentId === S.activeAgent);

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
      if (res.violations && res.violations.length > 0) {
        res.violations.forEach((v) => {
          const b = document.createElement("div");
          b.className = "alert-box alert-scope";
          b.textContent = `Scope Alert: '${v.filePath}' is outside declared scope (${v.scopes.join(", ")})`;
          alerts.appendChild(b);
        });
      }

      // Render Overlaps
      if (res.overlaps && res.overlaps.length > 0) {
        res.overlaps.forEach((ov) => {
          const b = document.createElement("div");
          b.className = "alert-box alert-overlap";
          b.textContent = `Overlap Alert: '${ov.filePath}' is also modified in ${ov.agents.join(", ")}`;
          alerts.appendChild(b);
        });
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
            <span class="diff-stat-badge">+${f.additions} -${f.deletions}</span>
          `;
          filesList.appendChild(row);
        });
      }

      // Render Diff with Ember syntax highlights
      if (!res.diff) {
        diffCode.textContent = "No unstaged or staged diffs.";
      } else {
        diffCode.innerHTML = colorizeDiff(res.diff);
      }
    } catch (err) {
      console.error("Failed to load changes:", err);
    }
  }

  function colorizeDiff(diffText) {
    const lines = diffText.split("\n");
    return lines
      .map((l) => {
        if (l.startsWith("+") && !l.startsWith("+++")) {
          return `<span class="diff-line-add">${escapeHtml(l)}</span>`;
        } else if (l.startsWith("-") && !l.startsWith("---")) {
          return `<span class="diff-line-del">${escapeHtml(l)}</span>`;
        } else if (l.startsWith("@@") || l.startsWith("diff --git")) {
          return `<span class="diff-line-info">${escapeHtml(l)}</span>`;
        }
        return escapeHtml(l);
      })
      .join("\n");
  }

  function renderOverlaps() {
    const banner = $("#overlap-banner");
    const text = $("#overlap-text");

    if (S.overlaps && S.overlaps.length > 0) {
      banner.classList.remove("hidden");
      const files = S.overlaps.map((o) => o.filePath).join(", ");
      text.textContent = `Conflict Overlap: ${files} (${S.overlaps[0].agents.join(" & ")})`;
    } else {
      banner.classList.add("hidden");
    }
  }

  // Composer Task Submission
  async function submitTask() {
    const input = $("#composer-input");
    const rawText = input.value.trim();
    if (!rawText) return;

    S.history.push(rawText);
    S.historyIdx = S.history.length;
    input.value = "";

    // Parse @agent targeting if present
    let targetAgent = S.activeAgent === "all" ? S.agents[0]?.id : S.activeAgent;
    let cleanTask = rawText;

    if (rawText.startsWith("@")) {
      const match = rawText.match(/^@([a-zA-Z0-9_\-]+)\s*(.*)/);
      if (match) {
        const found = S.agents.find((a) => a.id.toLowerCase() === match[1].toLowerCase());
        if (found) {
          targetAgent = found.id;
          cleanTask = match[2];
        }
      }
    }

    // Parse file scope
    const scopeInput = $("#input-file-scope").value.trim();
    let fileScope = [];
    if (scopeInput) {
      fileScope = scopeInput.split(",").map((s) => s.trim()).filter(Boolean);
    }

    try {
      await api("/api/task/start", {
        method: "POST",
        body: JSON.stringify({
          agentId: targetAgent,
          task: cleanTask,
          fileScope: fileScope,
        }),
      });
    } catch (err) {
      alert(`Error starting task: ${err.message}`);
    }
  }

  // Stage 5: Mid-Task Redirect Handler
  async function executeRedirect() {
    const newDir = $("#redirect-input").value.trim();
    if (!newDir) return;

    const mode = $('input[name="redirect-mode"]:checked').value;
    const activeSession = Object.values(S.sessions).find((s) => s.session && s.session.agentId === S.activeAgent);
    if (!activeSession) return;

    try {
      await api("/api/task/redirect", {
        method: "POST",
        body: JSON.stringify({
          sessionId: activeSession.session.id,
          mode: mode,
          newDirection: newDir,
        }),
      });
      $("#redirect-input").value = "";
      $("#redirect-drawer").classList.add("hidden");
    } catch (err) {
      alert(`Redirect failed: ${err.message}`);
    }
  }

  // Stage 4: Merge Handler
  async function executeMerge() {
    const activeSession = S.activeAgent === "all"
      ? Object.values(S.sessions)[0]
      : Object.values(S.sessions).find((s) => s.session && s.session.agentId === S.activeAgent);

    if (!activeSession) return;

    if (!confirm(`Merge branch '${activeSession.session.branch}' into ${activeSession.session.baseBranch}?`)) {
      return;
    }

    try {
      const res = await api("/api/merge", {
        method: "POST",
        body: JSON.stringify({ sessionId: activeSession.session.id }),
      });

      if (!res.success) {
        alert(`Merge Conflict Detected!\n${res.conflicts ? res.conflicts.join("\n") : res.output}`);
      } else {
        alert(`Merge Successful! Commit: ${res.mergedCommit || "merged"}`);
      }
    } catch (err) {
      alert(`Merge error: ${err.message}`);
    }
  }

  // Stage 4: Discard Handler
  async function executeDiscard() {
    const activeSession = S.activeAgent === "all"
      ? Object.values(S.sessions)[0]
      : Object.values(S.sessions).find((s) => s.session && s.session.agentId === S.activeAgent);

    if (!activeSession) return;

    if (!confirm(`Discard worktree and delete branch '${activeSession.session.branch}'? All unmerged changes will be deleted.`)) {
      return;
    }

    try {
      await api("/api/discard", {
        method: "POST",
        body: JSON.stringify({ sessionId: activeSession.session.id }),
      });
    } catch (err) {
      alert(`Discard error: ${err.message}`);
    }
  }

  // Ask another agent to review (Stage 4)
  async function askReview() {
    const activeSession = Object.values(S.sessions).find((s) => s.session && s.session.agentId === S.activeAgent);
    if (!activeSession) return;

    const otherAgents = S.agents.filter((a) => a.id !== activeSession.session.agentId);
    if (otherAgents.length === 0) {
      alert("No other agents available to review.");
      return;
    }

    const reviewer = prompt(`Select reviewer agent (${otherAgents.map((a) => a.id).join(", ")}):`, otherAgents[0].id);
    if (!reviewer) return;

    const diffRes = await api(`/api/changes?sessionId=${encodeURIComponent(activeSession.session.id)}`);
    const reviewTask = `Please review the changes on branch '${activeSession.session.branch}':\n\n${diffRes.diff.slice(0, 800)}`;

    try {
      await api("/api/task/start", {
        method: "POST",
        body: JSON.stringify({
          agentId: reviewer,
          task: reviewTask,
        }),
      });
      selectAgent(reviewer);
    } catch (err) {
      alert(`Failed to request review: ${err.message}`);
    }
  }

  // Raw Logs Drawer Toggle
  async function toggleRawLogs() {
    const drawer = $("#raw-logs-drawer");
    const isHidden = drawer.classList.toggle("hidden");
    if (!isHidden) {
      const activeSession = Object.values(S.sessions).find((s) => s.session && s.session.agentId === S.activeAgent);
      if (activeSession) {
        const text = await fetch(`/api/logs?sessionId=${encodeURIComponent(activeSession.session.id)}&t=${S.token}`).then((r) => r.text());
        $("#raw-logs-content").textContent = text || "No logs yet.";
      }
    }
  }

  // Resizable Splitters
  function setupResizers() {
    setupResizer($("#resizer-1"), $("#col-sidebar"), "width", true);
    setupResizer($("#resizer-2"), $("#col-changes"), "width", false);
  }

  function setupResizer(resizerEl, targetEl, prop, isLeft) {
    let startPos = 0;
    let startDim = 0;

    function onPointerDown(e) {
      e.preventDefault();
      startPos = e.clientX;
      startDim = targetEl.offsetWidth;
      resizerEl.classList.add("dragging");
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    }

    function onPointerMove(e) {
      const delta = isLeft ? e.clientX - startPos : startPos - e.clientX;
      const newDim = Math.max(180, Math.min(520, startDim + delta));
      targetEl.style.width = `${newDim}px`;
    }

    function onPointerUp() {
      resizerEl.classList.remove("dragging");
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
    }

    resizerEl.addEventListener("pointerdown", onPointerDown);
  }

  // Event Listeners Wiring
  function setupEventListeners() {
    $("#btn-send").onclick = submitTask;
    $("#composer-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || !e.shiftKey)) {
        e.preventDefault();
        submitTask();
      } else if (e.key === "ArrowUp" && e.target.selectionStart === 0) {
        if (S.historyIdx > 0) {
          S.historyIdx--;
          e.target.value = S.history[S.historyIdx] || "";
        }
      } else if (e.key === "ArrowDown" && e.target.selectionStart === e.target.value.length) {
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

    // Project opening
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
