package gitops

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// RunGit executes a git command in the specified directory.
func RunGit(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		return "", fmt.Errorf("git %s failed: %w (stderr: %s)", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(stdout.String()), nil
}

// IsGitRepo reports whether the directory is inside a valid git repository.
func IsGitRepo(dir string) bool {
	out, err := RunGit(dir, "rev-parse", "--is-inside-work-tree")
	return err == nil && out == "true"
}

// RepoRoot returns the top-level directory of the git repository.
func RepoRoot(dir string) (string, error) {
	return RunGit(dir, "rev-parse", "--show-toplevel")
}

// InitRepo initializes a new git repository in dir and creates an initial commit
// if the repo has no commits yet, ensuring worktrees can branch from HEAD.
func InitRepo(dir string) error {
	if _, err := RunGit(dir, "init"); err != nil {
		return fmt.Errorf("failed to git init: %w", err)
	}

	// Ensure .conclave is ignored
	ignorePath := filepath.Join(dir, ".gitignore")
	existingIgnore, _ := os.ReadFile(ignorePath)
	if !strings.Contains(string(existingIgnore), ".conclave") {
		f, err := os.OpenFile(ignorePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err == nil {
			_, _ = f.WriteString("\n# Conclave worktrees\n.conclave/\n")
			_ = f.Close()
		}
	}

	// Check if repository has any commits
	_, err := RunGit(dir, "rev-parse", "--verify", "HEAD")
	if err != nil {
		// No commits yet: create initial commit
		_ = os.WriteFile(filepath.Join(dir, "README.md"), []byte("# Project\nCreated with Conclave.\n"), 0644)
		if _, err := RunGit(dir, "add", "-A"); err != nil {
			return fmt.Errorf("failed to git add: %w", err)
		}
		if _, err := RunGit(dir, "commit", "-m", "initial commit"); err != nil {
			return fmt.Errorf("failed to git commit: %w", err)
		}
	}

	return nil
}

// CurrentBranch returns the name of the currently checked out branch.
func CurrentBranch(repoRoot string) (string, error) {
	branch, err := RunGit(repoRoot, "branch", "--show-current")
	if err != nil || branch == "" {
		// Fallback for detached HEAD
		return RunGit(repoRoot, "rev-parse", "--short", "HEAD")
	}
	return branch, nil
}

// IsDirty reports whether the main repository has uncommitted changes.
func IsDirty(repoRoot string) (bool, error) {
	status, err := RunGit(repoRoot, "status", "--porcelain")
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(status) != "", nil
}
