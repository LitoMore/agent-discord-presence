package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestWindowsNodeDiscovery(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node.js is not installed")
	}
	t.Setenv("ADP_NODE", "")
	t.Setenv("PATH", filepath.Dir(node))
	if found, err := nodePath(); err != nil || found != node {
		t.Fatalf("Node on PATH: %q, %v", found, err)
	}
	t.Setenv("ADP_NODE", node)
	t.Setenv("PATH", "")
	if found, err := nodePath(); err != nil || found != node {
		t.Fatalf("explicit Node override: %q, %v", found, err)
	}
	t.Setenv("ADP_NODE", filepath.Join(t.TempDir(), "missing.exe"))
	if _, err := nodePath(); err == nil || !strings.Contains(err.Error(), "ADP_NODE") {
		t.Fatalf("invalid override must report an error: %v", err)
	}
}

func TestBackgroundProcessHasNoConsole(t *testing.T) {
	if os.Getenv("ADP_TEST_CONSOLE_CHILD") == "1" {
		console := syscall.NewLazyDLL("kernel32.dll").NewProc("GetConsoleWindow")
		window, _, _ := console.Call()
		fmt.Print(window)
		os.Exit(0)
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestBackgroundProcessHasNoConsole$")
	cmd.Env = append(os.Environ(), "ADP_TEST_CONSOLE_CHILD=1")
	hideConsole(cmd)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("background process failed: %v: %s", err, output)
	}
	if string(output) != "0" {
		t.Fatalf("background process allocated a console window: %s", output)
	}
}
