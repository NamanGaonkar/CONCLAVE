package agent

import (
	"regexp"
	"strings"
	"time"
)

var (
	ansiRegex     = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b[()][AB012]`)
	toolCallRegex = regexp.MustCompile(`(?i)(?:Executing|Running(?: command)?|Tool Call|Command)\s*[:>]\s*(.+)`)
	fileEditRegex = regexp.MustCompile(`(?i)(?:Wrote|Created|Modified|Edited|Saved|Updating)\s*(?:file\s*)?[:"']?\s*([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)`)
	diffStatRegex = regexp.MustCompile(`([+\-]\d+(?:\s*[+\-]\d+)?)`)
)

// StripANSI removes all ANSI terminal escape sequences.
func StripANSI(s string) string {
	return ansiRegex.ReplaceAllString(s, "")
}

// ParseLine parses a single line of agent output and returns an Event.
func ParseLine(rawLine string) Event {
	clean := strings.TrimRight(StripANSI(rawLine), "\r\n")
	now := time.Now()

	if clean == "" {
		return Event{
			Type:      EventTypeText,
			Text:      "",
			Raw:       rawLine,
			Timestamp: now,
		}
	}

	// 1. Check for file edit
	if m := fileEditRegex.FindStringSubmatch(clean); len(m) > 1 {
		filePath := strings.Trim(m[1], `"' `)
		diffSummary := ""
		if ds := diffStatRegex.FindString(clean); ds != "" {
			diffSummary = ds
		}
		return Event{
			Type:        EventTypeFileEdit,
			FilePath:    filePath,
			DiffSummary: diffSummary,
			Text:        clean,
			Raw:         rawLine,
			Timestamp:   now,
		}
	}

	// 2. Check for tool call
	if m := toolCallRegex.FindStringSubmatch(clean); len(m) > 1 {
		toolStr := strings.TrimSpace(m[1])
		parts := strings.SplitN(toolStr, " ", 2)
		toolName := parts[0]
		toolArgs := ""
		if len(parts) > 1 {
			toolArgs = parts[1]
		}
		return Event{
			Type:      EventTypeToolCall,
			Tool:      toolName,
			Args:      toolArgs,
			Text:      clean,
			Raw:       rawLine,
			Timestamp: now,
		}
	}

	// 3. Fallback: regular conversational text
	return Event{
		Type:      EventTypeText,
		Text:      clean,
		Raw:       rawLine,
		Timestamp: now,
	}
}
