package monitor

import (
	"path/filepath"
	"strings"
)

// ScopeViolation reports a file edited outside the requested scope globs.
type ScopeViolation struct {
	FilePath string   `json:"filePath"`
	Scopes   []string `json:"scopes"`
}

// MatchesScope checks whether a file matches at least one of the scope patterns.
// If scopes is empty, all files are considered in-scope.
func MatchesScope(filePath string, scopes []string) bool {
	if len(scopes) == 0 {
		return true
	}

	normPath := filepath.ToSlash(filePath)

	for _, s := range scopes {
		pattern := filepath.ToSlash(strings.TrimSpace(s))
		if pattern == "" || pattern == "*" {
			return true
		}

		// Exact match
		if normPath == pattern {
			return true
		}

		// Prefix directory match (e.g. "pkg/" matches "pkg/agent/types.go")
		if strings.HasSuffix(pattern, "/") && strings.HasPrefix(normPath, pattern) {
			return true
		}

		// Glob match
		matched, err := filepath.Match(pattern, normPath)
		if err == nil && matched {
			return true
		}

		// Base filename match (e.g. "*.go" matches "pkg/agent/types.go")
		matchedBase, err := filepath.Match(pattern, filepath.Base(normPath))
		if err == nil && matchedBase {
			return true
		}

		// Recursive wildcard support (e.g. "pkg/**" or "**/*.go")
		if strings.Contains(pattern, "**") {
			prefix := strings.Split(pattern, "**")[0]
			if strings.HasPrefix(normPath, prefix) {
				return true
			}
		}
	}

	return false
}

// FindScopeViolations checks a list of changed files against declared scopes.
func FindScopeViolations(changedFiles []string, scopes []string) []ScopeViolation {
	if len(scopes) == 0 {
		return nil
	}

	var violations []ScopeViolation
	for _, f := range changedFiles {
		if !MatchesScope(f, scopes) {
			violations = append(violations, ScopeViolation{
				FilePath: f,
				Scopes:   scopes,
			})
		}
	}
	return violations
}
