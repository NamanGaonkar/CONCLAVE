package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"conclave/pkg/agent"
	"conclave/pkg/gitops"
	"conclave/pkg/store"
	"conclave/ui"
)

func setupTestServer(t *testing.T) (*Server, string, string) {
	// 1. Temp git repo
	repoDir, err := os.MkdirTemp("", "conclave-acc-repo-*")
	if err != nil {
		t.Fatal(err)
	}
	if err := gitops.InitRepo(repoDir); err != nil {
		t.Fatal(err)
	}

	// Create baseline file in repo
	baseFile := filepath.Join(repoDir, "service.go")
	if err := os.WriteFile(baseFile, []byte("package main\n\nfunc Run() string {\n\treturn \"baseline\"\n}\n"), 0644); err != nil {
		t.Fatal(err)
	}
	_, _ = gitops.RunGit(repoDir, "add", "-A")
	_, _ = gitops.RunGit(repoDir, "commit", "-m", "add service.go baseline")

	// 2. Temp config dir
	configDir, err := os.MkdirTemp("", "conclave-acc-cfg-*")
	if err != nil {
		t.Fatal(err)
	}

	srv, err := New("test-token", configDir, repoDir, ui.Assets)
	if err != nil {
		t.Fatal(err)
	}

	return srv, repoDir, configDir
}

// Acceptance Test 1: Two agents given tasks that touch the same file each work in separate worktrees,
// the main folder is untouched, and an overlap warning appears.
func TestAcceptance1_IsolationAndOverlap(t *testing.T) {
	srv, repoDir, configDir := setupTestServer(t)
	defer os.RemoveAll(repoDir)
	defer os.RemoveAll(configDir)

	// Create two distinct sessions touching service.go
	sess1, err := gitops.CreateWorktree(repoDir, "opencode", "feat-auth", "add auth", []string{"service.go"})
	if err != nil {
		t.Fatalf("failed to create worktree 1: %v", err)
	}
	defer gitops.RemoveWorktree(repoDir, sess1.WorktreePath, sess1.Branch, true)

	sess2, err := gitops.CreateWorktree(repoDir, "whis", "feat-billing", "add billing", []string{"service.go"})
	if err != nil {
		t.Fatalf("failed to create worktree 2: %v", err)
	}
	defer gitops.RemoveWorktree(repoDir, sess2.WorktreePath, sess2.Branch, true)

	// Agent 1 modifies service.go in its worktree
	_ = os.WriteFile(filepath.Join(sess1.WorktreePath, "service.go"), []byte("package main\n\n// Agent 1 Auth\n"), 0644)
	// Agent 2 modifies service.go in its worktree
	_ = os.WriteFile(filepath.Join(sess2.WorktreePath, "service.go"), []byte("package main\n\n// Agent 2 Billing\n"), 0644)

	// Check Main Folder: Must be completely untouched!
	mainContent, _ := os.ReadFile(filepath.Join(repoDir, "service.go"))
	if !strings.Contains(string(mainContent), "baseline") {
		t.Fatalf("ISOLATION BREACH: main repo service.go was altered! Content: %s", string(mainContent))
	}

	// Register active files in server overlap detector
	srv.overlapDetector.SetAgentFiles("opencode", sess1.Branch, []string{"service.go"})
	srv.overlapDetector.SetAgentFiles("whis", sess2.Branch, []string{"service.go"})

	overlaps := srv.overlapDetector.DetectFileOverlaps()
	if len(overlaps) == 0 {
		t.Fatalf("expected overlap alert for service.go, got none")
	}
	if overlaps[0].FilePath != "service.go" || len(overlaps[0].Agents) != 2 {
		t.Fatalf("unexpected overlap structure: %+v", overlaps[0])
	}
}

// Acceptance Test 2: Merging one agent's branch works, and merging the second reports the conflict instead of overwriting.
func TestAcceptance2_MergeAndConflict(t *testing.T) {
	_, repoDir, configDir := setupTestServer(t)
	defer os.RemoveAll(repoDir)
	defer os.RemoveAll(configDir)

	baseBranch, _ := gitops.CurrentBranch(repoDir)

	// Session 1: Modifies service.go
	sess1, err := gitops.CreateWorktree(repoDir, "opencode", "task-a", "change line 4", nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(sess1.WorktreePath, "service.go"), []byte("package main\n\nfunc Run() string {\n\treturn \"alpha\"\n}\n"), 0644)
	_, _ = gitops.CommitCheckpoint(sess1.WorktreePath, "commit alpha")

	// Session 2: Modifies same line with conflicting content
	sess2, err := gitops.CreateWorktree(repoDir, "whis", "task-b", "change line 4 differently", nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(sess2.WorktreePath, "service.go"), []byte("package main\n\nfunc Run() string {\n\treturn \"beta\"\n}\n"), 0644)
	_, _ = gitops.CommitCheckpoint(sess2.WorktreePath, "commit beta")

	// Merge Session 1: MUST SUCCEED
	res1, err := gitops.ExecuteMerge(repoDir, sess1.Branch, baseBranch)
	if err != nil || !res1.Success {
		t.Fatalf("expected first merge to succeed, got: %+v (err: %v)", res1, err)
	}

	// Merge Session 2: MUST DETECT CONFLICT AND ABORT (NEVER OVERWRITE)
	dryRun2, _ := gitops.DryRunMerge(repoDir, sess2.Branch, baseBranch)
	if dryRun2 == nil || !dryRun2.HasConflicts {
		t.Fatalf("expected second branch to have conflicts with newly updated base branch, got: %+v", dryRun2)
	}

	res2, err := gitops.ExecuteMerge(repoDir, sess2.Branch, baseBranch)
	if res2 != nil && res2.Success {
		t.Fatalf("CONFLICT FAILURE: second merge should not have succeeded! Conflicts: %+v", res2)
	}

	// Clean up worktrees
	_ = gitops.RemoveWorktree(repoDir, sess1.WorktreePath, sess1.Branch, true)
	_ = gitops.RemoveWorktree(repoDir, sess2.WorktreePath, sess2.Branch, true)
}

// Acceptance Test 3: A Hard redirect on a running task keeps its earlier file changes,
// restarts in the same worktree with the new direction, and leaves other agents running.
func TestAcceptance3_HardRedirect(t *testing.T) {
	srv, repoDir, configDir := setupTestServer(t)
	defer os.RemoveAll(repoDir)
	defer os.RemoveAll(configDir)

	sess, err := gitops.CreateWorktree(repoDir, "opencode", "task-redirect", "Initial Goal", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer gitops.RemoveWorktree(repoDir, sess.WorktreePath, sess.Branch, true)

	// Make an initial file change
	featureFile := filepath.Join(sess.WorktreePath, "feature.txt")
	_ = os.WriteFile(featureFile, []byte("Step 1 changes completed\n"), 0644)

	activeSess := &ActiveSession{
		Session: sess,
		Status:  agent.StatusWorking,
		Messages: []ChatMessage{
			{ID: "1", SessionID: sess.ID, AgentID: "opencode", Sender: "user", Content: "Initial Goal", Timestamp: time.Now()},
			{ID: "2", SessionID: sess.ID, AgentID: "opencode", Sender: "agent", Type: "text", Content: "Working on Step 1", Timestamp: time.Now()},
		},
	}
	srv.sessions[sess.ID] = activeSess

	// Issue Hard Redirect via API handler
	body, _ := json.Marshal(map[string]string{
		"sessionId":    sess.ID,
		"mode":         "hard",
		"newDirection": "Switch to Step 2 with alternative logic",
	})
	req := httptest.NewRequest("POST", "/api/task/redirect?t=test-token", bytes.NewReader(body))
	w := httptest.NewRecorder()
	srv.Handler().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from redirect, got %d: %s", w.Code, w.Body.String())
	}

	// Verify file was NOT lost
	featureContent, err := os.ReadFile(featureFile)
	if err != nil || string(featureContent) != "Step 1 changes completed\n" {
		t.Fatalf("DATA LOSS: earlier changes were lost during redirect! Got: %s", string(featureContent))
	}

	// Verify checkpoint commit was recorded
	if len(activeSess.Session.Checkpoints) == 0 {
		t.Fatalf("expected checkpoint commit to be created during hard redirect")
	}

	// Verify timeline recorded redirect
	foundRedirect := false
	for _, tl := range activeSess.Timeline {
		if tl.Type == "redirected" {
			foundRedirect = true
			break
		}
	}
	if !foundRedirect {
		t.Fatalf("expected timeline to contain redirected event")
	}
}

// Acceptance Test 4: A missing agent shows a clear error and everything else keeps working.
func TestAcceptance4_MissingAgent(t *testing.T) {
	missingDef := agent.AgentDefinition{
		ID:      "missing-agent",
		Name:    "Missing Agent",
		Command: "nonexistent-agent-binary-404",
	}

	res := agent.ProbeAgent(context.Background(), missingDef)
	if res.Supported {
		t.Fatalf("expected missing tool to report unsupported")
	}
	if !strings.Contains(res.Error, "not found on PATH") {
		t.Fatalf("expected clear PATH error, got: %s", res.Error)
	}

	// Verify server handles start request with missing agent gracefully
	srv, repoDir, configDir := setupTestServer(t)
	defer os.RemoveAll(repoDir)
	defer os.RemoveAll(configDir)

	srv.agents = append(srv.agents, missingDef)

	body, _ := json.Marshal(map[string]any{
		"agentId": "missing-agent",
		"task":    "do something",
	})
	req := httptest.NewRequest("POST", "/api/task/start?t=test-token", bytes.NewReader(body))
	w := httptest.NewRecorder()
	srv.Handler().ServeHTTP(w, req)

	// Server must return clear error and not panic or crash
	if w.Code == http.StatusOK {
		t.Fatalf("expected error for missing agent, got 200")
	}
	if !strings.Contains(w.Body.String(), "not found on PATH") {
		t.Fatalf("expected error body to mention not found, got: %s", w.Body.String())
	}
}

// Acceptance Test 5: Closing and reopening the app restores the chats and worktrees.
func TestAcceptance5_RestoreOnRestart(t *testing.T) {
	_, repoDir, configDir := setupTestServer(t)
	defer os.RemoveAll(repoDir)
	defer os.RemoveAll(configDir)

	// Create worktree session
	sess, err := gitops.CreateWorktree(repoDir, "opencode", "persist-test", "persistent task", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer gitops.RemoveWorktree(repoDir, sess.WorktreePath, sess.Branch, true)

	// Save session to disk
	_ = store.SaveSessions(configDir, []*gitops.WorktreeSession{sess})

	// Simulate app restart: create a new Server instance using the same configDir and repoDir
	reopenedSrv, err := New("new-token", configDir, repoDir, ui.Assets)
	if err != nil {
		t.Fatalf("failed to create reopened server: %v", err)
	}

	// Verify session restored in reopened server
	req := httptest.NewRequest("GET", "/api/bootstrap?t=new-token", nil)
	w := httptest.NewRecorder()
	reopenedSrv.Handler().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", w.Code)
	}

	var boot struct {
		Sessions []struct {
			ID       string `json:"id"`
			AgentID  string `json:"agentId"`
			TaskSlug string `json:"taskSlug"`
		} `json:"sessions"`
	}
	if err := json.NewDecoder(w.Body).Decode(&boot); err != nil {
		t.Fatal(err)
	}

	if len(boot.Sessions) == 0 || boot.Sessions[0].ID != sess.ID {
		t.Fatalf("expected session '%s' to be restored on restart, got %+v", sess.ID, boot.Sessions)
	}
}
