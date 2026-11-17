package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

func executableFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && (runtime.GOOS == "windows" || info.Mode()&0111 != 0)
}

func nodeCandidates(goos string, getenv func(string) string, home string) []string {
	var paths []string
	add := func(variable string, parts ...string) {
		if root := getenv(variable); root != "" {
			paths = append(paths, filepath.Join(append([]string{root}, parts...)...))
		}
	}
	if goos == "windows" {
		add("NVM_SYMLINK", "node.exe")
		add("FNM_MULTISHELL_PATH", "node.exe")
		add("VOLTA_HOME", "bin", "node.exe")
		add("ProgramFiles", "nodejs", "node.exe")
		add("ProgramFiles(x86)", "nodejs", "node.exe")
		add("LOCALAPPDATA", "Volta", "bin", "node.exe")
		add("LOCALAPPDATA", "Programs", "nodejs", "node.exe")
	} else {
		add("NVM_BIN", "node")
		add("FNM_MULTISHELL_PATH", "bin", "node")
		add("VOLTA_HOME", "bin", "node")
		add("ASDF_DATA_DIR", "shims", "node")
		add("MISE_DATA_DIR", "shims", "node")
		if home != "" {
			for _, directory := range []string{".volta/bin", ".asdf/shims", ".local/share/mise/shims", ".local/bin"} {
				paths = append(paths, filepath.Join(home, directory, "node"))
			}
		}
		paths = append(paths, "/usr/local/bin/node", "/opt/homebrew/bin/node", "/usr/bin/node", "/opt/local/bin/node")
	}
	return paths
}

func nodePath() (string, error) {
	if path := os.Getenv("ADP_NODE"); path != "" {
		if found, err := exec.LookPath(path); err == nil {
			return found, nil
		}
		return "", errors.New("ADP_NODE does not point to an executable Node.js installation.")
	}
	if path, err := exec.LookPath("node"); err == nil {
		return path, nil
	}
	// GUI launches may not inherit the shell initialization used by nvm/fnm and
	// other managers. Ask the user's shell once at startup, never on each hook.
	if runtime.GOOS != "windows" {
		if shell := os.Getenv("SHELL"); filepath.IsAbs(shell) && executableFile(shell) {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			command := exec.CommandContext(ctx, shell, "-ilc", "command -v node")
			command.WaitDelay = 100 * time.Millisecond
			output, err := command.Output()
			cancel()
			if err == nil {
				for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
					path := strings.TrimSpace(line)
					if filepath.IsAbs(path) && executableFile(path) {
						return path, nil
					}
				}
			}
		}
	}
	home, _ := os.UserHomeDir()
	for _, path := range nodeCandidates(runtime.GOOS, os.Getenv, home) {
		if executableFile(path) {
			return path, nil
		}
	}
	return "", errors.New("Node.js 22+ was not found. Install Node.js, initialize your version manager in your shell, or set ADP_NODE to its executable path.")
}
