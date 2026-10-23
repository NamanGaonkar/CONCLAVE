package monitor

import (
	"path/filepath"
	"sync"
)

// FileOverlap represents a file simultaneously edited in multiple agent worktrees.
type FileOverlap struct {
	FilePath string   `json:"filePath"`
	Agents   []string `json:"agents"`
	Branches []string `json:"branches"`
}

// PortConflict represents two agents binding or using the same TCP port.
type PortConflict struct {
	Port   int      `json:"port"`
	Agents []string `json:"agents"`
}

// OverlapDetector coordinates real-time conflict and overlap checks across active agents.
type OverlapDetector struct {
	mu         sync.RWMutex
	agentFiles map[string][]string // agentID -> list of normalized modified file paths
	branches   map[string]string   // agentID -> branch name
	agentPorts map[string][]int    // agentID -> bound ports
}

// NewOverlapDetector initializes an overlap detector.
func NewOverlapDetector() *OverlapDetector {
	return &OverlapDetector{
		agentFiles: make(map[string][]string),
		branches:   make(map[string]string),
		agentPorts: make(map[string][]int),
	}
}

// SetAgentFiles updates the list of files modified by an agent.
func (d *OverlapDetector) SetAgentFiles(agentID, branch string, files []string) {
	d.mu.Lock()
	defer d.mu.Unlock()

	normFiles := make([]string, 0, len(files))
	for _, f := range files {
		normFiles = append(normFiles, filepath.ToSlash(f))
	}
	d.agentFiles[agentID] = normFiles
	d.branches[agentID] = branch
}

// ClearAgent removes an agent from tracking upon task finish or discard.
func (d *OverlapDetector) ClearAgent(agentID string) {
	d.mu.Lock()
	defer d.mu.Unlock()

	delete(d.agentFiles, agentID)
	delete(d.branches, agentID)
	delete(d.agentPorts, agentID)
}

// SetAgentPorts updates the list of ports actively bound or requested by an agent.
func (d *OverlapDetector) SetAgentPorts(agentID string, ports []int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.agentPorts[agentID] = ports
}

// DetectFileOverlaps inspects tracked agents and returns any files modified by >1 agent.
func (d *OverlapDetector) DetectFileOverlaps() []FileOverlap {
	d.mu.RLock()
	defer d.mu.RUnlock()

	fileToAgents := make(map[string][]string)
	for agentID, files := range d.agentFiles {
		for _, f := range files {
			fileToAgents[f] = append(fileToAgents[f], agentID)
		}
	}

	var overlaps []FileOverlap
	for f, agents := range fileToAgents {
		if len(agents) > 1 {
			var branchList []string
			for _, a := range agents {
				branchList = append(branchList, d.branches[a])
			}
			overlaps = append(overlaps, FileOverlap{
				FilePath: f,
				Agents:   agents,
				Branches: branchList,
			})
		}
	}

	return overlaps
}

// DetectPortConflicts checks if multiple agents are utilizing the identical port.
func (d *OverlapDetector) DetectPortConflicts() []PortConflict {
	d.mu.RLock()
	defer d.mu.RUnlock()

	portToAgents := make(map[int][]string)
	for agentID, ports := range d.agentPorts {
		for _, p := range ports {
			portToAgents[p] = append(portToAgents[p], agentID)
		}
	}

	var conflicts []PortConflict
	for p, agents := range portToAgents {
		if len(agents) > 1 {
			conflicts = append(conflicts, PortConflict{
				Port:   p,
				Agents: agents,
			})
		}
	}

	return conflicts
}
