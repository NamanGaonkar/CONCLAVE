package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"conclave/pkg/agent"
	"conclave/pkg/store"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "probe" {
		runProbe()
		return
	}

	fmt.Println("=============================================================")
	fmt.Println("  CONCLAVE - Multi-Agent Isolated Desktop Coding Hub")
	fmt.Println("=============================================================")
	fmt.Println("Commands:")
	fmt.Println("  conclave probe      Probe installed CLI agents and record modes")
	fmt.Println("  conclave            Launch CONCLAVE desktop application")
	fmt.Println()

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage of conclave:\n")
		flag.PrintDefaults()
	}
	flag.Parse()
}

func runProbe() {
	fmt.Println("-------------------------------------------------------------")
	fmt.Println(" [CONCLAVE] Probing installed CLI agents in temp workspaces...")
	fmt.Println(" Probing order: (1) Non-interactive flag -> (2) Server/API -> (3) ConPTY")
	fmt.Println("-------------------------------------------------------------")

	cfgDir, err := store.AppDataDir()
	if err != nil {
		fmt.Printf("Error resolving config directory: %v\n", err)
		os.Exit(1)
	}

	agents, err := agent.LoadAgents(cfgDir)
	if err != nil {
		fmt.Printf("Error loading agents: %v\n", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
	defer cancel()

	for i := range agents {
		def := &agents[i]
		fmt.Printf("\n--> Probing Agent: %s (Command: '%s')...\n", def.Name, def.Command)
		res := agent.ProbeAgent(ctx, *def)
		def.ProbeResult = &res

		if !res.Supported {
			fmt.Printf("    Status: [NOT INSTALLED] %s\n", res.Error)
		} else if res.Success {
			fmt.Printf("    Status: [SUCCESS] Mode: %s\n", res.Mode)
			if res.SampleOutput != "" {
				lines := strings.Split(res.SampleOutput, "\n")
				samplePreview := lines[0]
				if len(samplePreview) > 80 {
					samplePreview = samplePreview[:80] + "..."
				}
				fmt.Printf("    Sample: %s\n", samplePreview)
			}
		} else {
			fmt.Printf("    Status: [FAILED] %s\n", res.Error)
		}
	}

	if err := agent.SaveAgents(cfgDir, agents); err != nil {
		fmt.Printf("\nError saving probe results to agents.json: %v\n", err)
	} else {
		fmt.Printf("\n[CONCLAVE] Probe completed. Results recorded in: %s\n", filepath.Join(cfgDir, "agents.json"))
	}
}
