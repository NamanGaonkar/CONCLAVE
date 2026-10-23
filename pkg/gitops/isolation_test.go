package gitops

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"conclave/pkg/monitor"
)

func TestWorktreeIsolationAndOverlap(t *testing.T) {
	// 1. Setup a clean temporary main repository
	mainRepo, err := os.MkdirTemp("", "conclave-main-repo-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(mainRepo)

	if err := InitRepo(mainRepo); err != nil {
		t.Fatalf("failed to init repo: %v", err)
	}

	// Create shared.txt in main repo and commit it
	sharedPath := filepath.Join(mainRepo, "shared.txt")
	if err := os.WriteFile(sharedPath, []byte("Original baseline content\n"), 0644); err != nil {
		t.Fatal(err)
	}
	_, _ = RunGit(mainRepo, "add", "-A")
	_, _ = RunGit(mainRepo, "commit", "-m", "add shared.txt baseline")

	// 2. Create worktree for Agent 1 (opencode)
	agent1Session, err := CreateWorktree(mainRepo, "opencode", "task-alpha", "Modify shared file", []string{"shared.txt"})
	if err != nil {
		t.Fatalf("failed to create agent1 worktree: %v", err)
	}
	defer RemoveWorktree(mainRepo, agent1Session.WorktreePath, agent1Session.Branch, true)

	// 3. Create worktree for Agent 2 (whis)
	agent2Session, err := CreateWorktree(mainRepo, "whis", "task-beta", "Modify shared file differently", []string{"shared.txt"})
	if err != nil {
		t.Fatalf("failed to create agent2 worktree: %v", err)
	}
	defer RemoveWorktree(mainRepo, agent2Session.WorktreePath, agent2Session.Branch, true)

	// Verify both worktrees exist and are distinct
	if agent1Session.WorktreePath == agent2Session.WorktreePath {
		t.Fatalf("expected different worktree directories")
	}

	// Agent 1 modifies shared.txt in its worktree
	agent1Shared := filepath.Join(agent1Session.WorktreePath, "shared.txt")
	if err := os.WriteFile(agent1Shared, []byte("Agent 1 changes\n"), 0644); err != nil {
		t.Fatal(err)
	}

	// Agent 2 modifies shared.txt in its worktree
	agent2Shared := filepath.Join(agent2Session.WorktreePath, "shared.txt")
	if err := os.WriteFile(agent2Shared, []byte("Agent 2 distinct changes\n"), 0644); err != nil {
		t.Fatal(err)
	}

	// 4. Verify the MAIN folder remains untouched!
	mainContent, err := os.ReadFile(sharedPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(mainContent) != "Original baseline content\n" {
		t.Fatalf("ISOLATION BREACH: main repo was modified! Expected baseline, got: %s", string(mainContent))
	}

	// 5. Verify changed files detection in both worktrees
	changes1, err := GetChangedFiles(agent1Session.WorktreePath)
	if err != nil || len(changes1) == 0 {
		t.Fatalf("expected changed files in worktree 1, got %v", err)
	}
	changes2, err := GetChangedFiles(agent2Session.WorktreePath)
	if err != nil || len(changes2) == 0 {
		t.Fatalf("expected changed files in worktree 2, got %v", err)
	}

	// 6. Test Overlap Detection
	detector := monitor.NewOverlapDetector()
	detector.SetAgentFiles("opencode", agent1Session.Branch, []string{"shared.txt"})
	detector.SetAgentFiles("whis", agent2Session.Branch, []string{"shared.txt"})

	overlaps := detector.DetectFileOverlaps()
	if len(overlaps) != 1 {
		t.Fatalf("expected 1 file overlap, got %d", len(overlaps))
	}
	if overlaps[0].FilePath != "shared.txt" {
		t.Fatalf("expected overlap on shared.txt, got %s", overlaps[0].FilePath)
	}
	if len(overlaps[0].Agents) != 2 {
		t.Fatalf("expected 2 agents in overlap, got %v", overlaps[0].Agents)
	}

	// 7. Test Port Conflict Detection
	detector.SetAgentPorts("opencode", []int{3000, 8080})
	detector.SetAgentPorts("whis", []int{3000, 5173})

	portConflicts := detector.DetectPortConflicts()
	if len(portConflicts) != 1 || portConflicts[0].Port != 3000 {
		t.Fatalf("expected port conflict on 3000, got %+v", portConflicts)
	}

	// 8. Test Scope Detection
	outOfScopeFiles := []string{"src/secret.js"}
	violations := monitor.FindScopeViolations(outOfScopeFiles, []string{"shared.txt", "docs/*"})
	if len(violations) != 1 || violations[0].FilePath != "src/secret.js" {
		t.Fatalf("expected scope violation for src/secret.js, got %+v", violations)
	}

	// 9. Test Checkpoint Commit
	cp, err := CommitCheckpoint(agent1Session.WorktreePath, "first pass complete")
	if err != nil {
		t.Fatalf("failed to commit checkpoint: %v", err)
	}
	if cp.Hash == "" || !strings.Contains(cp.Message, "first pass complete") {
		t.Fatalf("invalid checkpoint: %+v", cp)
	}
}
