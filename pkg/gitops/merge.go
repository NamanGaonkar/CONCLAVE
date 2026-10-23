package gitops

import (
	"bytes"
	"fmt"
	"os/exec"
	"strings"
)

// MergeResult details the outcome of a dry-run or actual merge.
type MergeResult struct {
	Success      bool     `json:"success"`
	HasConflicts bool     `json:"hasConflicts"`
	Conflicts    []string `json:"conflicts,omitempty"`
	Output       string   `json:"output"`
	MergedCommit string   `json:"mergedCommit,omitempty"`
}

// DryRunMerge checks if merging branch into targetBranch would cause conflicts,
// without altering the current working tree.
func DryRunMerge(repoRoot, branch, targetBranch string) (*MergeResult, error) {
	root, err := RepoRoot(repoRoot)
	if err != nil {
		return nil, err
	}

	// Modern git merge-tree --write-tree (Git 2.38+)
	// Exit code 0 = Clean merge without conflicts
	// Exit code 1 = Conflicts detected
	cmd := exec.Command("git", "merge-tree", "--write-tree", targetBranch, branch)
	cmd.Dir = root
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	runErr := cmd.Run()
	outText := stdout.String() + "\n" + stderr.String()

	if runErr == nil {
		// Clean merge without conflicts
		return &MergeResult{
			Success:      true,
			HasConflicts: false,
			Output:       strings.TrimSpace(stdout.String()),
		}, nil
	}

	// Exit code 1 indicates merge conflicts were encountered
	var conflictLines []string
	for _, l := range strings.Split(outText, "\n") {
		l = strings.TrimSpace(l)
		if strings.Contains(l, "CONFLICT") || strings.Contains(l, "Auto-merging") {
			conflictLines = append(conflictLines, l)
		}
	}

	if len(conflictLines) == 0 {
		conflictLines = append(conflictLines, "Merge conflict detected between "+branch+" and "+targetBranch)
	}

	return &MergeResult{
		Success:      false,
		HasConflicts: true,
		Conflicts:    conflictLines,
		Output:       outText,
	}, nil
}

// ExecuteMerge performs the actual merge of branch into targetBranch in repoRoot.
// It aborts if there are conflicts and never leaves the repo in a broken state.
func ExecuteMerge(repoRoot, branch, targetBranch string) (*MergeResult, error) {
	root, err := RepoRoot(repoRoot)
	if err != nil {
		return nil, err
	}

	// 1. Dry run first!
	dryRun, err := DryRunMerge(root, branch, targetBranch)
	if err != nil || (dryRun != nil && dryRun.HasConflicts) {
		conflicts := []string{"Dry-run merge failed with potential conflicts"}
		if dryRun != nil && len(dryRun.Conflicts) > 0 {
			conflicts = dryRun.Conflicts
		}
		return &MergeResult{
			Success:      false,
			HasConflicts: true,
			Conflicts:    conflicts,
			Output:       "Aborted: branch has merge conflicts with " + targetBranch,
		}, nil
	}

	// 2. Ensure main repo is on targetBranch and clean
	dirty, err := IsDirty(root)
	if err != nil {
		return nil, err
	}
	if dirty {
		return &MergeResult{
			Success: false,
			Output:  "Main repository has uncommitted changes. Please commit or stash before merging.",
		}, nil
	}

	curBranch, err := CurrentBranch(root)
	if err != nil {
		return nil, err
	}
	if curBranch != targetBranch {
		if _, err := RunGit(root, "checkout", targetBranch); err != nil {
			return nil, fmt.Errorf("failed to checkout %s: %w", targetBranch, err)
		}
	}

	// 3. Perform merge with --no-ff
	mergeMsg := fmt.Sprintf("Merge branch '%s' via Conclave", branch)
	out, err := RunGit(root, "merge", "--no-ff", "-m", mergeMsg, branch)
	if err != nil {
		// Merge failed, immediately abort
		_, _ = RunGit(root, "merge", "--abort")
		return &MergeResult{
			Success:      false,
			HasConflicts: true,
			Conflicts:    []string{err.Error()},
			Output:       out,
		}, nil
	}

	head, _ := RunGit(root, "rev-parse", "--short", "HEAD")
	return &MergeResult{
		Success:      true,
		HasConflicts: false,
		MergedCommit: head,
		Output:       out,
	}, nil
}

// ExecuteSelectiveMerge merges only the specified files from branch into targetBranch.
// This implements Cursor/GitButler-style granular staging and merge commit.
func ExecuteSelectiveMerge(repoRoot, branch, targetBranch string, files []string) (*MergeResult, error) {
	root, err := RepoRoot(repoRoot)
	if err != nil {
		return nil, err
	}

	if len(files) == 0 {
		return ExecuteMerge(root, branch, targetBranch)
	}

	// 1. Ensure target branch is clean
	dirty, err := IsDirty(root)
	if err != nil {
		return nil, err
	}
	if dirty {
		return &MergeResult{
			Success: false,
			Output:  "Main repository has uncommitted changes. Please commit or stash before merging.",
		}, nil
	}

	curBranch, err := CurrentBranch(root)
	if err != nil {
		return nil, err
	}
	if curBranch != targetBranch {
		if _, err := RunGit(root, "checkout", targetBranch); err != nil {
			return nil, fmt.Errorf("failed to checkout %s: %w", targetBranch, err)
		}
	}

	// 2. Checkout each selected file from the agent's branch
	for _, f := range files {
		f = strings.TrimSpace(f)
		if f == "" {
			continue
		}
		// Try checking out the file from branch
		if _, err := RunGit(root, "checkout", branch, "--", f); err != nil {
			return &MergeResult{
				Success:      false,
				HasConflicts: true,
				Conflicts:    []string{fmt.Sprintf("Failed to checkout %s from %s: %v", f, branch, err)},
				Output:       err.Error(),
			}, nil
		}
		// Stage the file
		if _, err := RunGit(root, "add", "-A", "--", f); err != nil {
			return &MergeResult{
				Success: false,
				Output:  fmt.Sprintf("Failed to stage %s: %v", f, err),
			}, nil
		}
	}

	// Check if there are staged changes
	statusOut, _ := RunGit(root, "status", "--porcelain")
	if strings.TrimSpace(statusOut) == "" {
		return &MergeResult{
			Success: true,
			Output:  "No changes to merge for the selected files.",
		}, nil
	}

	// 3. Create merge commit for selective files
	mergeMsg := fmt.Sprintf("Merge selective changes (%d files) from '%s' via Conclave\n\nSelected files:\n- %s",
		len(files), branch, strings.Join(files, "\n- "))
	out, err := RunGit(root, "commit", "-m", mergeMsg)
	if err != nil {
		return &MergeResult{
			Success: false,
			Output:  fmt.Sprintf("Failed to commit selective merge: %v", err),
		}, nil
	}

	head, _ := RunGit(root, "rev-parse", "--short", "HEAD")
	return &MergeResult{
		Success:      true,
		MergedCommit: head,
		Output:       out,
	}, nil
}
