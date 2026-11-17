package main

import (
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
)

func TestNodeCandidates(t *testing.T) {
	environment := map[string]string{
		"NVM_BIN": "/custom/nvm/bin", "FNM_MULTISHELL_PATH": "/custom/fnm",
		"VOLTA_HOME": "/custom/volta", "NVM_SYMLINK": "/custom/nvm-link",
		"ProgramFiles": "/program files", "ASDF_DATA_DIR": "/custom/asdf",
	}
	getenv := func(key string) string { return environment[key] }
	for _, test := range []struct {
		goos string
		want []string
	}{
		{"darwin", []string{"/custom/nvm/bin/node", "/custom/fnm/bin/node", "/custom/volta/bin/node", "/custom/asdf/shims/node", "/usr/local/bin/node"}},
		{"windows", []string{"/custom/nvm-link/node.exe", "/custom/fnm/node.exe", "/custom/volta/bin/node.exe", "/program files/nodejs/node.exe"}},
	} {
		paths := nodeCandidates(test.goos, getenv, "/users/test")
		for _, path := range test.want {
			if !slices.ContainsFunc(paths, func(candidate string) bool { return filepath.FromSlash(candidate) == filepath.FromSlash(path) }) {
				t.Errorf("%s: missing %s in %v", test.goos, path, paths)
			}
		}
	}
}

func TestNodeOverrideAndPATH(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell executable fixture")
	}
	directory := t.TempDir()
	path := filepath.Join(directory, "node")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", directory)
	t.Setenv("ADP_NODE", "")
	if found, err := nodePath(); err != nil || found != path {
		t.Fatalf("PATH: %q, %v", found, err)
	}
	t.Setenv("ADP_NODE", path)
	t.Setenv("PATH", "")
	if found, err := nodePath(); err != nil || found != path {
		t.Fatalf("override: %q, %v", found, err)
	}
	t.Setenv("ADP_NODE", filepath.Join(directory, "missing"))
	if _, err := nodePath(); err == nil || !strings.Contains(err.Error(), "ADP_NODE") {
		t.Fatalf("invalid explicit override must not silently fall back: %v", err)
	}
}

func TestNodeFromInitializedShell(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX shell discovery")
	}
	directory := t.TempDir()
	node := filepath.Join(directory, "node from manager")
	shell := filepath.Join(directory, "shell")
	if err := os.WriteFile(node, []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(shell, []byte("#!/bin/sh\nprintf '%s\\n' 'shell startup output' '"+node+"'\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ADP_NODE", "")
	t.Setenv("PATH", "")
	t.Setenv("SHELL", shell)
	if found, err := nodePath(); err != nil || found != node {
		t.Fatalf("initialized shell: %q, %v", found, err)
	}
}
