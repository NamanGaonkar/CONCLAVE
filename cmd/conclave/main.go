package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"conclave/pkg/agent"
	"conclave/pkg/gitops"
	"conclave/pkg/jobmgr"
	"conclave/pkg/server"
	"conclave/pkg/store"
	"conclave/ui"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "probe" {
		runProbe()
		return
	}

	portFlag := flag.Int("port", 4100, "Base port to listen on (127.0.0.1 only)")
	dirFlag := flag.String("dir", "", "Initial project directory")
	noOpenFlag := flag.Bool("no-open", false, "Do not launch desktop app window automatically")
	flag.Parse()

	cfgDir, err := store.AppDataDir()
	if err != nil {
		log.Fatalf("Failed to initialize AppData: %v", err)
	}

	// Setup Windows Job Object to kill all child processes on exit/crash
	job, err := jobmgr.New()
	if err == nil {
		defer job.Close()
	}

	// Verify or resolve initial project directory
	initialDir := *dirFlag
	if initialDir != "" {
		abs, err := filepath.Abs(initialDir)
		if err == nil {
			initialDir = abs
		}
	} else {
		// Use current directory if it's a git repo
		cwd, err := os.Getwd()
		if err == nil && gitops.IsGitRepo(cwd) {
			initialDir = cwd
		}
	}

	port, err := pickFreePort(*portFlag)
	if err != nil {
		log.Fatalf("Port selection error: %v", err)
	}

	srv, err := server.New("", cfgDir, initialDir, ui.Assets)
	if err != nil {
		log.Fatalf("Server initialization failed: %v", err)
	}

	httpServer := &http.Server{
		Addr:    fmt.Sprintf("127.0.0.1:%d", port),
		Handler: srv.Handler(),
	}

	appURL := fmt.Sprintf("http://127.0.0.1:%d/?t=%s", port, srv.Token)
	fmt.Printf("\n=============================================================\n")
	fmt.Printf("  CONCLAVE Desktop Hub Running\n")
	fmt.Printf("  URL:   %s\n", appURL)
	fmt.Printf("  Bound: 127.0.0.1 (Token-Authenticated)\n")
	fmt.Printf("=============================================================\n\n")

	if !*noOpenFlag {
		go func() {
			time.Sleep(300 * time.Millisecond)
			openDesktopWindow(appURL)
		}()
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)

	errCh := make(chan error, 1)
	go func() {
		errCh <- httpServer.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	case <-sig:
		fmt.Println("\n[CONCLAVE] Shutting down...")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
	srv.Close()
	if job != nil {
		_ = job.Close()
	}
	fmt.Println("[CONCLAVE] Clean exit. Child process trees terminated.")
}

func pickFreePort(base int) (int, error) {
	for p := base; p < base+60; p++ {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			_ = ln.Close()
			return p, nil
		}
	}
	return 0, fmt.Errorf("no free port available near %d", base)
}

func openDesktopWindow(url string) {
	candidates := []string{
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Microsoft", "Edge", "Application", "msedge.exe"),
		"msedge.exe",
		filepath.Join(os.Getenv("ProgramFiles"), "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Google", "Chrome", "Application", "chrome.exe"),
	}

	for _, cand := range candidates {
		if fi, err := os.Stat(cand); err == nil && !fi.IsDir() {
			cmd := exec.Command(cand, fmt.Sprintf("--app=%s", url), "--window-size=1440,900")
			if err := cmd.Start(); err == nil {
				return
			}
		}
	}

	// Fallback to start command
	_ = exec.Command("cmd", "/c", "start", "", url).Start()
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
