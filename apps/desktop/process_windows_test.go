package main

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"testing"
)

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
