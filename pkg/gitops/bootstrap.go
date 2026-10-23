package gitops

import (
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// BootstrapReport details files and directories bootstrapped into a worktree.
type BootstrapReport struct {
	CopiedEnvFiles []string `json:"copiedEnvFiles"`
	LinkedDirs     []string `json:"linkedDirs"`
}

// BootstrapWorktree automatically provisions environment and dependency links
// into a freshly created worktree so coding agents can execute tests and tools
// without missing .env or dependency errors (inspired by git-gtr / git-worktree-runner).
func BootstrapWorktree(repoRoot, worktreeDir string) (*BootstrapReport, error) {
	report := &BootstrapReport{
		CopiedEnvFiles: []string{},
		LinkedDirs:     []string{},
	}

	// 1. Copy .env files if present in root but missing in worktree
	envCandidates := []string{
		".env",
		".env.local",
		".env.development",
		".env.test",
		".env.production",
	}

	for _, name := range envCandidates {
		src := filepath.Join(repoRoot, name)
		dst := filepath.Join(worktreeDir, name)

		if info, err := os.Stat(src); err == nil && !info.IsDir() {
			if _, err := os.Stat(dst); os.IsNotExist(err) {
				if err := copyFile(src, dst); err == nil {
					report.CopiedEnvFiles = append(report.CopiedEnvFiles, name)
				}
			}
		}
	}

	// 2. Link common heavy dependency folders (node_modules, .venv, venv, vendor)
	depDirs := []string{
		"node_modules",
		".venv",
		"venv",
		"vendor",
	}

	for _, name := range depDirs {
		src := filepath.Join(repoRoot, name)
		dst := filepath.Join(worktreeDir, name)

		if info, err := os.Stat(src); err == nil && info.IsDir() {
			if _, err := os.Stat(dst); os.IsNotExist(err) {
				if err := linkDirectory(src, dst); err == nil {
					report.LinkedDirs = append(report.LinkedDirs, name)
				}
			}
		}
	}

	return report, nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err = io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}

func linkDirectory(target, link string) error {
	if runtime.GOOS == "windows" {
		// On Windows, NTFS Directory Junctions (/J) do not require Administrator privileges
		cmd := exec.Command("cmd", "/c", "mklink", "/J", link, target)
		if err := cmd.Run(); err == nil {
			return nil
		}
	}
	// Fallback to standard symlink
	return os.Symlink(target, link)
}
