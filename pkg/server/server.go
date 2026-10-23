package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"conclave/pkg/agent"
	"conclave/pkg/gitops"
	"conclave/pkg/monitor"
	"conclave/pkg/store"
)

// ChatMessage represents a single message or activity card in an agent's conversation.
type ChatMessage struct {
	ID          string    `json:"id"`
	SessionID   string    `json:"sessionId"`
	AgentID     string    `json:"agentId"`
	Sender      string    `json:"sender"` // "user", "agent", "system"
	Type        string    `json:"type"`   // "text", "tool-call", "file-edit", "error", "checkpoint", "redirect"
	Content     string    `json:"content"`
	Tool        string    `json:"tool,omitempty"`
	Args        string    `json:"args,omitempty"`
	FilePath    string    `json:"filePath,omitempty"`
	DiffSummary string    `json:"diffSummary,omitempty"`
	Timestamp   time.Time `json:"timestamp"`
}

// TimelineEvent records a pivotal step in the task lifecycle.
type TimelineEvent struct {
	Type        string    `json:"type"` // "started", "redirected", "checkpoint", "finished"
	Title       string    `json:"title"`
	Description string    `json:"description,omitempty"`
	Hash        string    `json:"hash,omitempty"`
	Timestamp   time.Time `json:"timestamp"`
}

// ActiveSession bundles the worktree, running process, messages, and timeline.
type ActiveSession struct {
	Session  *gitops.WorktreeSession     `json:"session"`
	Instance *agent.ProcessAgentInstance `json:"-"`
	Messages []ChatMessage               `json:"messages"`
	Timeline []TimelineEvent             `json:"timeline"`
	Status   agent.AgentStatus           `json:"status"`
}

// Server is the central HTTP/WebSocket controller for Conclave.
type Server struct {
	Token      string
	ProjectDir string
	ConfigDir  string
	UIAssets   fs.FS

	mu              sync.RWMutex
	agents          []agent.AgentDefinition
	sessions        map[string]*ActiveSession // sessionId -> ActiveSession
	agentToSession  map[string]string         // agentId -> active sessionId
	overlapDetector *monitor.OverlapDetector
	wsClients       map[*WSConn]bool
	wsMu            sync.Mutex
}

// New creates a new Server instance.
func New(token, configDir, initialProjectDir string, uiAssets fs.FS) (*Server, error) {
	if token == "" {
		token = generateToken()
	}

	loadedAgents, err := agent.LoadAgents(configDir)
	if err != nil {
		loadedAgents = agent.DefaultPresets()
	}

	s := &Server{
		Token:           token,
		ProjectDir:      initialProjectDir,
		ConfigDir:       configDir,
		UIAssets:        uiAssets,
		agents:          loadedAgents,
		sessions:        make(map[string]*ActiveSession),
		agentToSession:  make(map[string]string),
		overlapDetector: monitor.NewOverlapDetector(),
		wsClients:       make(map[*WSConn]bool),
	}

	// Restore previous sessions from store if available
	savedSessions, err := store.LoadSessions(configDir)
	if err == nil && len(savedSessions) > 0 {
		for _, sess := range savedSessions {
			// Verify if worktree path still exists
			if _, err := os.Stat(sess.WorktreePath); err == nil {
				s.sessions[sess.ID] = &ActiveSession{
					Session: sess,
					Status:  agent.StatusIdle,
				}
				s.agentToSession[sess.AgentID] = sess.ID
			}
		}
	}

	return s, nil
}

func generateToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Handler returns the HTTP handler with token authentication and routing.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// API Endpoints
	mux.HandleFunc("/api/bootstrap", s.authMiddleware(s.handleBootstrap))
	mux.HandleFunc("/api/project/open", s.authMiddleware(s.handleProjectOpen))
	mux.HandleFunc("/api/project/init", s.authMiddleware(s.handleProjectInit))
	mux.HandleFunc("/api/agents", s.authMiddleware(s.handleAgents))
	mux.HandleFunc("/api/agents/update", s.authMiddleware(s.handleAgentsUpdate))
	mux.HandleFunc("/api/task/start", s.authMiddleware(s.handleTaskStart))
	mux.HandleFunc("/api/task/redirect", s.authMiddleware(s.handleTaskRedirect))
	mux.HandleFunc("/api/task/undo", s.authMiddleware(s.handleTaskUndo))
	mux.HandleFunc("/api/task/stop", s.authMiddleware(s.handleTaskStop))
	mux.HandleFunc("/api/changes", s.authMiddleware(s.handleChanges))
	mux.HandleFunc("/api/merge", s.authMiddleware(s.handleMerge))
	mux.HandleFunc("/api/discard", s.authMiddleware(s.handleDiscard))
	mux.HandleFunc("/api/logs", s.authMiddleware(s.handleLogs))

	// WebSocket handler
	mux.HandleFunc("/ws", s.handleWS)

	// Static UI assets via go:embed
	fileServer := http.FileServer(http.FS(s.UIAssets))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Verify token for initial page load
		t := r.URL.Query().Get("t")
		if t != "" && t != s.Token {
			http.Error(w, "Unauthorized token", http.StatusUnauthorized)
			return
		}
		fileServer.ServeHTTP(w, r)
	})

	return mux
}

// authMiddleware enforces token authentication across all API endpoints.
func (s *Server) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.URL.Query().Get("t")
		if token == "" {
			token = r.Header.Get("X-Conclave-Token")
		}
		if token == "" {
			authHeader := r.Header.Get("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				token = strings.TrimPrefix(authHeader, "Bearer ")
			}
		}

		if token != s.Token {
			http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

// Broadcast sends a JSON message to all connected UI clients.
func (s *Server) Broadcast(msgType string, payload any) {
	data, err := json.Marshal(map[string]any{
		"type":    msgType,
		"payload": payload,
	})
	if err != nil {
		return
	}

	s.wsMu.Lock()
	defer s.wsMu.Unlock()
	for client := range s.wsClients {
		_ = client.WriteText(string(data))
	}
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("t")
	if token != s.Token {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	ws, err := Upgrade(w, r)
	if err != nil {
		return
	}

	s.wsMu.Lock()
	s.wsClients[ws] = true
	s.wsMu.Unlock()

	defer func() {
		s.wsMu.Lock()
		delete(s.wsClients, ws)
		s.wsMu.Unlock()
		ws.Close()
	}()

	for {
		_, err := ws.ReadMessage()
		if err != nil {
			break
		}
	}
}

func (s *Server) handleBootstrap(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	isRepo := false
	branch := ""
	isDirty := false

	if s.ProjectDir != "" {
		isRepo = gitops.IsGitRepo(s.ProjectDir)
		if isRepo {
			branch, _ = gitops.CurrentBranch(s.ProjectDir)
			isDirty, _ = gitops.IsDirty(s.ProjectDir)
		}
	}

	type SessionSummary struct {
		ID           string              `json:"id"`
		AgentID      string              `json:"agentId"`
		TaskSlug     string              `json:"taskSlug"`
		Branch       string              `json:"branch"`
		Task         string              `json:"task"`
		Status       agent.AgentStatus   `json:"status"`
		CreatedAt    time.Time           `json:"createdAt"`
		FileScope    []string            `json:"fileScope,omitempty"`
		Checkpoints  []gitops.Checkpoint `json:"checkpoints,omitempty"`
		MessageCount int                 `json:"messageCount"`
	}

	sessionSummaries := make([]SessionSummary, 0)
	for _, sess := range s.sessions {
		sessionSummaries = append(sessionSummaries, SessionSummary{
			ID:           sess.Session.ID,
			AgentID:      sess.Session.AgentID,
			TaskSlug:     sess.Session.TaskSlug,
			Branch:       sess.Session.Branch,
			Task:         sess.Session.Task,
			Status:       sess.Status,
			CreatedAt:    sess.Session.CreatedAt,
			FileScope:    sess.Session.FileScope,
			Checkpoints:  sess.Session.Checkpoints,
			MessageCount: len(sess.Messages),
		})
	}

	resp := map[string]any{
		"token":         s.Token,
		"projectDir":    s.ProjectDir,
		"isRepo":        isRepo,
		"branch":        branch,
		"isDirty":       isDirty,
		"agents":        s.agents,
		"sessions":      sessionSummaries,
		"overlaps":      s.overlapDetector.DetectFileOverlaps(),
		"portConflicts": s.overlapDetector.DetectPortConflicts(),
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleProjectOpen(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	path := strings.TrimSpace(body.Path)
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		http.Error(w, `{"error":"Invalid folder path"}`, http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	s.ProjectDir = path
	isRepo := gitops.IsGitRepo(path)
	branch := ""
	if isRepo {
		branch, _ = gitops.CurrentBranch(path)
	}
	s.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"success":    true,
		"projectDir": path,
		"isRepo":     isRepo,
		"branch":     branch,
	})
}

func (s *Server) handleProjectInit(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	dir := s.ProjectDir
	s.mu.RUnlock()

	if dir == "" {
		http.Error(w, `{"error":"No project folder selected"}`, http.StatusBadRequest)
		return
	}

	if err := gitops.InitRepo(dir); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}

	branch, _ := gitops.CurrentBranch(dir)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"isRepo":  true,
		"branch":  branch,
	})
}

func (s *Server) handleAgents(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(s.agents)
}

func (s *Server) handleAgentsUpdate(w http.ResponseWriter, r *http.Request) {
	var updatedAgents []agent.AgentDefinition
	if err := json.NewDecoder(r.Body).Decode(&updatedAgents); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	s.agents = updatedAgents
	_ = agent.SaveAgents(s.ConfigDir, updatedAgents)
	s.mu.Unlock()

	s.Broadcast("agents-updated", updatedAgents)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true})
}

func (s *Server) handleTaskStart(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AgentID   string   `json:"agentId"`
		Task      string   `json:"task"`
		FileScope []string `json:"fileScope"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	s.mu.RLock()
	projectDir := s.ProjectDir
	var chosenDef *agent.AgentDefinition
	for _, a := range s.agents {
		if a.ID == body.AgentID {
			cpy := a
			chosenDef = &cpy
			break
		}
	}
	s.mu.RUnlock()

	if projectDir == "" || !gitops.IsGitRepo(projectDir) {
		http.Error(w, `{"error":"A valid git repository is required"}`, http.StatusBadRequest)
		return
	}
	if chosenDef == nil {
		http.Error(w, `{"error":"Agent not found"}`, http.StatusBadRequest)
		return
	}

	// Create dedicated isolated Git worktree
	taskSlug := gitops.Slugify(body.Task)
	worktreeSession, err := gitops.CreateWorktree(projectDir, body.AgentID, taskSlug, body.Task, body.FileScope)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"Failed to create worktree: %v"}`, err), http.StatusInternalServerError)
		return
	}

	instance := agent.NewAgentInstance(*chosenDef)
	activeSess := &ActiveSession{
		Session:  worktreeSession,
		Instance: instance,
		Status:   agent.StatusWorking,
		Timeline: []TimelineEvent{
			{
				Type:      "started",
				Title:     "Task Started",
				Description: body.Task,
				Timestamp: time.Now(),
			},
		},
		Messages: []ChatMessage{
			{
				ID:        fmt.Sprintf("msg-%d", time.Now().UnixNano()),
				SessionID: worktreeSession.ID,
				AgentID:   body.AgentID,
				Sender:    "user",
				Type:      "text",
				Content:   body.Task,
				Timestamp: time.Now(),
			},
		},
	}

	s.mu.Lock()
	s.sessions[worktreeSession.ID] = activeSess
	s.agentToSession[body.AgentID] = worktreeSession.ID
	s.saveSessionsLocked()
	s.mu.Unlock()

	// Launch agent inside the worktree
	eventChan, err := instance.Start(r.Context(), body.Task, worktreeSession.WorktreePath)
	if err != nil {
		activeSess.Status = agent.StatusError
		s.Broadcast("agent-status", map[string]any{
			"agentId": body.AgentID,
			"status":  agent.StatusError,
			"error":   err.Error(),
		})
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}

	// Stream events
	go s.streamAgentEvents(worktreeSession.ID, body.AgentID, eventChan)

	s.Broadcast("task-started", activeSess)
	s.Broadcast("agent-status", map[string]any{
		"agentId": body.AgentID,
		"status":  agent.StatusWorking,
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(activeSess)
}

func (s *Server) streamAgentEvents(sessionID, agentID string, events <-chan agent.Event) {
	for ev := range events {
		s.mu.Lock()
		sess, ok := s.sessions[sessionID]
		if !ok {
			s.mu.Unlock()
			continue
		}

		chatMsg := ChatMessage{
			ID:          fmt.Sprintf("msg-%d", time.Now().UnixNano()),
			SessionID:   sessionID,
			AgentID:     agentID,
			Sender:      "agent",
			Type:        string(ev.Type),
			Content:     ev.Text,
			Tool:        ev.Tool,
			Args:        ev.Args,
			FilePath:    ev.FilePath,
			DiffSummary: ev.DiffSummary,
			Timestamp:   ev.Timestamp,
		}

		sess.Messages = append(sess.Messages, chatMsg)

		// Check for modified files to update overlap detector
		if ev.Type == agent.EventTypeFileEdit && ev.FilePath != "" {
			changed, _ := gitops.GetChangedFiles(sess.Session.WorktreePath)
			var paths []string
			for _, c := range changed {
				paths = append(paths, c.Path)
			}
			s.overlapDetector.SetAgentFiles(agentID, sess.Session.Branch, paths)
		}

		if ev.Type == agent.EventTypeDone {
			sess.Status = agent.StatusIdle
			sess.Timeline = append(sess.Timeline, TimelineEvent{
				Type:      "finished",
				Title:     "Task Finished",
				Timestamp: time.Now(),
			})
		} else if ev.Type == agent.EventTypeError {
			sess.Status = agent.StatusError
		}

		s.mu.Unlock()

		s.Broadcast("chat-message", chatMsg)
		s.Broadcast("agent-status", map[string]any{
			"agentId": agentID,
			"status":  chatMsg.Type,
		})

		// Broadcast any newly detected overlaps
		overlaps := s.overlapDetector.DetectFileOverlaps()
		if len(overlaps) > 0 {
			s.Broadcast("overlaps-updated", overlaps)
		}
	}
}

// Stage 5: Mid-Task Redirect handler (Soft and Hard redirect)
func (s *Server) handleTaskRedirect(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SessionID    string `json:"sessionId"`
		Mode         string `json:"mode"` // "soft" or "hard"
		NewDirection string `json:"newDirection"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	sess, ok := s.sessions[body.SessionID]
	s.mu.Unlock()

	if !ok {
		http.Error(w, `{"error":"Session not found"}`, http.StatusNotFound)
		return
	}

	now := time.Now()
	// Record user redirect message
	redirectMsg := ChatMessage{
		ID:        fmt.Sprintf("msg-%d", now.UnixNano()),
		SessionID: body.SessionID,
		AgentID:   sess.Session.AgentID,
		Sender:    "user",
		Type:      "redirect",
		Content:   fmt.Sprintf("[Redirect (%s)] %s", strings.ToUpper(body.Mode), body.NewDirection),
		Timestamp: now,
	}

	s.mu.Lock()
	sess.Messages = append(sess.Messages, redirectMsg)
	sess.Timeline = append(sess.Timeline, TimelineEvent{
		Type:        "redirected",
		Title:       fmt.Sprintf("%s Redirect", strings.Title(body.Mode)),
		Description: body.NewDirection,
		Timestamp:   now,
	})
	s.mu.Unlock()

	s.Broadcast("chat-message", redirectMsg)

	// Mode 1: Soft Redirect (queues message to agent stdin)
	if body.Mode == "soft" {
		if sess.Instance != nil {
			_ = sess.Instance.Send(body.NewDirection)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "mode": "soft"})
		return
	}

	// Mode 2: Hard Redirect
	// 1. Interrupt running process
	if sess.Instance != nil {
		_ = sess.Instance.Interrupt()
	}

	// 2. Make checkpoint commit in worktree
	cp, err := gitops.CommitCheckpoint(sess.Session.WorktreePath, fmt.Sprintf("Redirect: %s", body.NewDirection))
	if err == nil && cp != nil {
		s.mu.Lock()
		sess.Session.Checkpoints = append(sess.Session.Checkpoints, *cp)
		sess.Timeline = append(sess.Timeline, TimelineEvent{
			Type:        "checkpoint",
			Title:       "Checkpoint Created",
			Description: cp.Message,
			Hash:        cp.Hash,
			Timestamp:   time.Now(),
		})
		s.mu.Unlock()
	}

	// 3. Summarize progress (diff stat plus last messages)
	diffStat, _ := gitops.RunGit(sess.Session.WorktreePath, "diff", "--stat", "HEAD~1", "HEAD")
	var recentMsgs []string
	s.mu.RLock()
	for _, m := range sess.Messages {
		if m.Sender == "agent" && m.Type == "text" {
			recentMsgs = append(recentMsgs, m.Content)
		}
	}
	s.mu.RUnlock()
	if len(recentMsgs) > 5 {
		recentMsgs = recentMsgs[len(recentMsgs)-5:]
	}

	combinedBrief := fmt.Sprintf(
		"ORIGINAL GOAL: %s\n\nPROGRESS SO FAR:\n%s\nRecent context:\n%s\n\nNEW DIRECTION:\n%s",
		sess.Session.Task,
		diffStat,
		strings.Join(recentMsgs, "\n"),
		body.NewDirection,
	)

	// 4. Restart the agent in the same worktree and branch
	s.mu.RLock()
	var agentDef *agent.AgentDefinition
	for _, a := range s.agents {
		if a.ID == sess.Session.AgentID {
			cpy := a
			agentDef = &cpy
			break
		}
	}
	s.mu.RUnlock()

	if agentDef != nil {
		newInstance := agent.NewAgentInstance(*agentDef)
		sess.Instance = newInstance
		sess.Status = agent.StatusWorking

		eventChan, startErr := newInstance.Start(r.Context(), combinedBrief, sess.Session.WorktreePath)
		if startErr == nil {
			go s.streamAgentEvents(sess.Session.ID, sess.Session.AgentID, eventChan)
		}
	}

	s.mu.Lock()
	s.saveSessionsLocked()
	s.mu.Unlock()

	s.Broadcast("agent-status", map[string]any{
		"agentId": sess.Session.AgentID,
		"status":  agent.StatusWorking,
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"success":    true,
		"mode":       "hard",
		"checkpoint": cp,
	})
}

// Stage 5: Undo to checkpoint handler
func (s *Server) handleTaskUndo(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SessionID      string `json:"sessionId"`
		CheckpointHash string `json:"checkpointHash"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	sess, ok := s.sessions[body.SessionID]
	s.mu.Unlock()

	if !ok {
		http.Error(w, `{"error":"Session not found"}`, http.StatusNotFound)
		return
	}

	// Interrupt if running
	if sess.Instance != nil {
		_ = sess.Instance.Interrupt()
	}

	// Reset worktree to the checkpoint commit
	_, err := gitops.RunGit(sess.Session.WorktreePath, "reset", "--hard", body.CheckpointHash)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"Failed to reset: %v"}`, err), http.StatusInternalServerError)
		return
	}

	s.mu.Lock()
	sess.Status = agent.StatusIdle
	sess.Timeline = append(sess.Timeline, TimelineEvent{
		Type:        "checkpoint",
		Title:       "Reverted to Checkpoint",
		Hash:        body.CheckpointHash,
		Timestamp:   time.Now(),
	})
	s.mu.Unlock()

	s.Broadcast("agent-status", map[string]any{
		"agentId": sess.Session.AgentID,
		"status":  agent.StatusIdle,
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true})
}

func (s *Server) handleTaskStop(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	sess, ok := s.sessions[body.SessionID]
	s.mu.Unlock()

	if !ok {
		http.Error(w, `{"error":"Session not found"}`, http.StatusNotFound)
		return
	}

	if sess.Instance != nil {
		_ = sess.Instance.Stop()
	}
	sess.Status = agent.StatusIdle

	s.Broadcast("agent-status", map[string]any{
		"agentId": sess.Session.AgentID,
		"status":  agent.StatusIdle,
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true})
}

// Stage 4: Changes and Diff Inspector
func (s *Server) handleChanges(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sessionId")
	s.mu.RLock()
	sess, ok := s.sessions[sessionID]
	s.mu.RUnlock()

	if !ok {
		http.Error(w, `{"error":"Session not found"}`, http.StatusNotFound)
		return
	}

	changedFiles, err := gitops.GetChangedFiles(sess.Session.WorktreePath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	diffText, _ := gitops.GetWorktreeDiff(sess.Session.WorktreePath)

	var paths []string
	for _, cf := range changedFiles {
		paths = append(paths, cf.Path)
	}

	violations := monitor.FindScopeViolations(paths, sess.Session.FileScope)

	// Check if this branch overlaps with other active agents
	s.mu.RLock()
	allOverlaps := s.overlapDetector.DetectFileOverlaps()
	s.mu.RUnlock()

	var sessionOverlaps []monitor.FileOverlap
	for _, ov := range allOverlaps {
		for _, b := range ov.Branches {
			if b == sess.Session.Branch {
				sessionOverlaps = append(sessionOverlaps, ov)
				break
			}
		}
	}

	// Dry run merge preview
	s.mu.RLock()
	projectDir := s.ProjectDir
	s.mu.RUnlock()
	dryRun, _ := gitops.DryRunMerge(projectDir, sess.Session.Branch, sess.Session.BaseBranch)

	resp := map[string]any{
		"session":      sess.Session,
		"files":        changedFiles,
		"diff":         diffText,
		"violations":   violations,
		"overlaps":     sessionOverlaps,
		"dryRunResult": dryRun,
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// Stage 4: Merge Handler (Never auto-merges; dry run first)
func (s *Server) handleMerge(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	sess, ok := s.sessions[body.SessionID]
	projectDir := s.ProjectDir
	s.mu.Unlock()

	if !ok {
		http.Error(w, `{"error":"Session not found"}`, http.StatusNotFound)
		return
	}

	// Commit any uncommitted worktree changes before merging
	_, _ = gitops.CommitCheckpoint(sess.Session.WorktreePath, "Final pre-merge commit")

	// Execute safe merge with dry-run verification
	result, err := gitops.ExecuteMerge(projectDir, sess.Session.Branch, sess.Session.BaseBranch)
	if err != nil || (result != nil && !result.Success) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success":   false,
			"conflicts": result.Conflicts,
			"output":    result.Output,
			"error":     fmt.Sprintf("%v", err),
		})
		return
	}

	// Clean up worktree on successful merge
	_ = gitops.RemoveWorktree(projectDir, sess.Session.WorktreePath, sess.Session.Branch, true)

	s.mu.Lock()
	s.overlapDetector.ClearAgent(sess.Session.AgentID)
	delete(s.sessions, body.SessionID)
	delete(s.agentToSession, sess.Session.AgentID)
	s.saveSessionsLocked()
	s.mu.Unlock()

	s.Broadcast("task-merged", map[string]any{
		"sessionId": body.SessionID,
		"agentId":   sess.Session.AgentID,
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"success":      true,
		"mergedCommit": result.MergedCommit,
		"output":       result.Output,
	})
}

// Stage 4: Discard Handler
func (s *Server) handleDiscard(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	sess, ok := s.sessions[body.SessionID]
	projectDir := s.ProjectDir
	s.mu.Unlock()

	if !ok {
		http.Error(w, `{"error":"Session not found"}`, http.StatusNotFound)
		return
	}

	// Interrupt process
	if sess.Instance != nil {
		_ = sess.Instance.Stop()
	}

	// Remove worktree and delete branch
	_ = gitops.RemoveWorktree(projectDir, sess.Session.WorktreePath, sess.Session.Branch, true)

	s.mu.Lock()
	s.overlapDetector.ClearAgent(sess.Session.AgentID)
	delete(s.sessions, body.SessionID)
	delete(s.agentToSession, sess.Session.AgentID)
	s.saveSessionsLocked()
	s.mu.Unlock()

	s.Broadcast("task-discarded", map[string]any{
		"sessionId": body.SessionID,
		"agentId":   sess.Session.AgentID,
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true})
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sessionId")
	s.mu.RLock()
	sess, ok := s.sessions[sessionID]
	s.mu.RUnlock()

	if !ok || sess.Instance == nil {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("No logs available."))
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte(sess.Instance.GetRawLogs()))
}

func (s *Server) saveSessionsLocked() {
	var list []*gitops.WorktreeSession
	for _, sess := range s.sessions {
		list = append(list, sess.Session)
	}
	_ = store.SaveSessions(s.ConfigDir, list)
}
