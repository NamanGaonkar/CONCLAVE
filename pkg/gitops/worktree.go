package gitops

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// FileChange describes a single modified, added or deleted file in a worktree.
type FileChange struct {
	Path      string `json:"path"`
	Status    string `json:"status"` // "M", "A", "D", "??"
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

// WorktreeSession tracks an active isolated agent worktree.
type WorktreeSession struct {
	ID           string       `json:"id"`
	AgentID      string       `json:"agentId"`
	TaskSlug     string       `json:"taskSlug"`
	Branch       string       `json:"branch"`
	WorktreePath string       `json:"worktreePath"`
	BaseBranch   string       `json:"baseBranch"`
	CreatedAt    time.Time    `json:"createdAt"`
	Task         string       `json:"task"`
	FileScope    []string     `json:"fileScope,omitempty"`
	Checkpoints  []Checkpoint     `json:"checkpoints,omitempty"`
	Bootstrap    *BootstrapReport `json:"bootstrap,omitempty"`
	Port         int              `json:"port,omitempty"`
}

// Checkpoint records a git checkpoint commit in the worktree.
type Checkpoint struct {
	Hash      string    `json:"hash"`
	Message   string    `json:"message"`
	Timestamp time.Time `json:"timestamp"`
	DiffStat  string    `json:"diffStat,omitempty"`
}

// WorktreeInfo holds metadata parsed from git worktree list.
type WorktreeInfo struct {
	Path   string `json:"path"`
	Branch string `json:"branch"`
	Head   string `json:"head"`
}

var slugRegex = regexp.MustCompile(`[^a-zA-Z0-9_\-]+`)

// Slugify converts an arbitrary string into a safe git branch/directory slug.
func Slugify(s string) string {
	clean := slugRegex.ReplaceAllString(strings.ToLower(strings.TrimSpace(s)), "-")
	clean = strings.Trim(clean, "-")
	if len(clean) > 32 {
		clean = clean[:32]
	}
	if clean == "" {
		clean = "task"
	}
	return clean
}

// CreateWorktree creates a dedicated git worktree and branch for an agent task.
// The agent will only ever execute inside this worktree folder.
func CreateWorktree(repoRoot, agentID, taskSlug, taskPrompt string, fileScope []string) (*WorktreeSession, error) {
	root, err := RepoRoot(repoRoot)
	if err != nil {
		return nil, fmt.Errorf("invalid git repository: %w", err)
	}

	baseBranch, err := CurrentBranch(root)
	if err != nil {
		baseBranch = "HEAD"
	}

	slug := Slugify(taskSlug)
	branch := fmt.Sprintf("conclave/%s/%s", agentID, slug)
	worktreeDir := filepath.Join(root, ".conclave", "worktrees", fmt.Sprintf("%s-%s", agentID, slug))

	// Ensure .gitignore has .conclave/
	ignorePath := filepath.Join(root, ".gitignore")
	existing, _ := os.ReadFile(ignorePath)
	if !strings.Contains(string(existing), ".conclave") {
		f, err := os.OpenFile(ignorePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err == nil {
			_, _ = f.WriteString("\n# Conclave worktrees\n.conclave/\n")
			_ = f.Close()
		}
	}

	// Create parent directory for worktrees
	if err := os.MkdirAll(filepath.Dir(worktreeDir), 0755); err != nil {
		return nil, fmt.Errorf("failed to create worktree parent dir: %w", err)
	}

	// Check if branch already exists: if so, delete it or pick unique slug
	_, branchExistsErr := RunGit(root, "rev-parse", "--verify", branch)
	if branchExistsErr == nil {
		// Append timestamp to make unique
		timestamp := time.Now().Format("0102-150405")
		slug = fmt.Sprintf("%s-%s", slug, timestamp)
		branch = fmt.Sprintf("conclave/%s/%s", agentID, slug)
		worktreeDir = filepath.Join(root, ".conclave", "worktrees", fmt.Sprintf("%s-%s", agentID, slug))
	}

	// Clean any dangling folder if present
	if _, err := os.Stat(worktreeDir); err == nil {
		_ = os.RemoveAll(worktreeDir)
		_, _ = RunGit(root, "worktree", "prune")
	}

	// Run: git worktree add -b <branch> <worktreeDir> <baseBranch>
	_, err = RunGit(root, "worktree", "add", "-b", branch, worktreeDir, baseBranch)
	if err != nil {
		return nil, fmt.Errorf("failed to create worktree '%s': %w", worktreeDir, err)
	}

	// Auto-bootstrap dependencies and environment (inspired by git-gtr)
	bootReport, _ := BootstrapWorktree(root, worktreeDir)

	session := &WorktreeSession{
		ID:           fmt.Sprintf("%s-%s", agentID, slug),
		AgentID:      agentID,
		TaskSlug:     slug,
		Branch:       branch,
		WorktreePath: worktreeDir,
		BaseBranch:   baseBranch,
		CreatedAt:    time.Now(),
		Task:         taskPrompt,
		FileScope:    fileScope,
		Bootstrap:    bootReport,
	}

	return session, nil
}

// RemoveWorktree deletes the worktree and optionally deletes its git branch.
func RemoveWorktree(repoRoot, worktreePath, branch string, deleteBranch bool) error {
	root, err := RepoRoot(repoRoot)
	if err != nil {
		return err
	}

	// Remove worktree via git
	_, _ = RunGit(root, "worktree", "remove", "--force", worktreePath)
	// Prune worktrees in case metadata lingered
	_, _ = RunGit(root, "worktree", "prune")

	// Ensure physical folder is gone
	_ = os.RemoveAll(worktreePath)

	if deleteBranch && branch != "" {
		_, _ = RunGit(root, "branch", "-D", branch)
	}

	return nil
}

// ListWorktrees lists all active git worktrees using git worktree list --porcelain.
func ListWorktrees(repoRoot string) ([]WorktreeInfo, error) {
	out, err := RunGit(repoRoot, "worktree", "list", "--porcelain")
	if err != nil {
		return nil, err
	}

	var results []WorktreeInfo
	var cur WorktreeInfo

	lines := strings.Split(out, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "worktree ") {
			if cur.Path != "" {
				results = append(results, cur)
			}
			cur = WorktreeInfo{Path: strings.TrimPrefix(line, "worktree ")}
		} else if strings.HasPrefix(line, "branch ") {
			cur.Branch = strings.TrimPrefix(line, "branch ")
			cur.Branch = strings.TrimPrefix(cur.Branch, "refs/heads/")
		} else if strings.HasPrefix(line, "HEAD ") {
			cur.Head = strings.TrimPrefix(line, "HEAD ")
		}
	}
	if cur.Path != "" {
		results = append(results, cur)
	}

	return results, nil
}

// GetChangedFiles inspects git status and diff stat in a worktree.
func GetChangedFiles(worktreePath string) ([]FileChange, error) {
	statusOut, err := RunGit(worktreePath, "status", "--porcelain")
	if err != nil {
		return nil, err
	}

	changesMap := make(map[string]*FileChange)
	lines := strings.Split(statusOut, "\n")
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if len(l) < 3 {
			continue
		}
		status := strings.TrimSpace(l[:2])
		path := strings.TrimSpace(l[3:])
		// Handle rename format "old -> new"
		if parts := strings.Split(path, " -> "); len(parts) == 2 {
			path = parts[1]
		}
		changesMap[path] = &FileChange{
			Path:   path,
			Status: status,
		}
	}

	// Get diff stat additions/deletions against HEAD
	numstatOut, _ := RunGit(worktreePath, "diff", "--numstat", "HEAD")
	for _, nl := range strings.Split(numstatOut, "\n") {
		fields := strings.Fields(nl)
		if len(fields) >= 3 {
			add, _ := strconv.Atoi(fields[0])
			del, _ := strconv.Atoi(fields[1])
			path := fields[2]
			if fc, ok := changesMap[path]; ok {
				fc.Additions = add
				fc.Deletions = del
			} else {
				changesMap[path] = &FileChange{
					Path:      path,
					Status:    "M",
					Additions: add,
					Deletions: del,
				}
			}
		}
	}

	var results []FileChange
	for _, fc := range changesMap {
		results = append(results, *fc)
	}
	return results, nil
}

// GetWorktreeDiff returns the full unified diff of changes in the worktree.
func GetWorktreeDiff(worktreePath string) (string, error) {
	// First show unstaged diff
	unstaged, _ := RunGit(worktreePath, "diff")
	// Staged diff
	staged, _ := RunGit(worktreePath, "diff", "--cached")
	// Untracked files
	untracked, _ := RunGit(worktreePath, "status", "--porcelain")

	var sb strings.Builder
	if staged != "" {
		sb.WriteString(staged + "\n")
	}
	if unstaged != "" {
		sb.WriteString(unstaged + "\n")
	}
	if untracked != "" {
		for _, l := range strings.Split(untracked, "\n") {
			l = strings.TrimSpace(l)
			if strings.HasPrefix(l, "??") {
				path := strings.TrimSpace(strings.TrimPrefix(l, "??"))
				content, _ := os.ReadFile(filepath.Join(worktreePath, path))
				sb.WriteString(fmt.Sprintf("diff --git a/%s b/%s\nnew file\n--- /dev/null\n+++ b/%s\n@@ -0,0 +1,%d @@\n", path, path, path, len(strings.Split(string(content), "\n"))))
				for _, line := range strings.Split(string(content), "\n") {
					sb.WriteString("+" + line + "\n")
				}
			}
		}
	}

	return sb.String(), nil
}

// CommitCheckpoint stages all changes and creates a checkpoint commit.
func CommitCheckpoint(worktreePath, message string) (*Checkpoint, error) {
	if _, err := RunGit(worktreePath, "add", "-A"); err != nil {
		return nil, fmt.Errorf("failed to git add: %w", err)
	}

	// Check if there are changes to commit
	status, err := RunGit(worktreePath, "status", "--porcelain")
	if err != nil || strings.TrimSpace(status) == "" {
		// Nothing to commit, return current HEAD as checkpoint
		head, _ := RunGit(worktreePath, "rev-parse", "--short", "HEAD")
		return &Checkpoint{
			Hash:      head,
			Message:   message + " (no new changes)",
			Timestamp: time.Now(),
		}, nil
	}

	commitMsg := fmt.Sprintf("checkpoint: %s", message)
	if _, err := RunGit(worktreePath, "commit", "-m", commitMsg); err != nil {
		return nil, fmt.Errorf("failed to create checkpoint commit: %w", err)
	}

	head, err := RunGit(worktreePath, "rev-parse", "--short", "HEAD")
	if err != nil {
		return nil, err
	}

	diffStat, _ := RunGit(worktreePath, "diff", "--stat", "HEAD~1", "HEAD")

	return &Checkpoint{
		Hash:      head,
		Message:   commitMsg,
		Timestamp: time.Now(),
		DiffStat:  diffStat,
	}, nil
}

// RollbackToCheckpoint resets the worktree to a previous checkpoint hash.
func RollbackToCheckpoint(worktreePath, commitHash string) error {
	_, err := RunGit(worktreePath, "reset", "--hard", commitHash)
	return err
}

// GetFileDiff returns the diff for a specific file in the worktree.
func GetFileDiff(worktreePath, filePath string) (string, error) {
	// 1. Try diff against HEAD for tracked files
	out, err := RunGit(worktreePath, "diff", "HEAD", "--", filePath)
	if err == nil && strings.TrimSpace(out) != "" {
		return out, nil
	}

	// 2. Unstaged diff
	out, err = RunGit(worktreePath, "diff", "--", filePath)
	if err == nil && strings.TrimSpace(out) != "" {
		return out, nil
	}

	// 3. Staged diff
	out, err = RunGit(worktreePath, "diff", "--cached", "--", filePath)
	if err == nil && strings.TrimSpace(out) != "" {
		return out, nil
	}

	// 4. Untracked file
	fullPath := filepath.Join(worktreePath, filePath)
	if content, readErr := os.ReadFile(fullPath); readErr == nil {
		lines := strings.Split(string(content), "\n")
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("diff --git a/%s b/%s\nnew file mode 100644\n--- /dev/null\n+++ b/%s\n@@ -0,0 +1,%d @@\n", filePath, filePath, filePath, len(lines)))
		for _, l := range lines {
			sb.WriteString("+" + l + "\n")
		}
		return sb.String(), nil
	}

	return "", nil
}
