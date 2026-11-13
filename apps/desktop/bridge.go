package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// Desktop connects the UI to the same Node service and validators as the CLI.
type Desktop struct {
	mu     sync.Mutex
	worker *exec.Cmd
	input  io.WriteCloser
	output chan string
	main   *mygo.Window
	panel  *mygo.Window
}

func bridgePath() (string, error) {
	if path := os.Getenv("ADP_DESKTOP_BRIDGE"); path != "" {
		return filepath.Abs(path)
	}
	resources, _ := mygo.App.Path(mygo.PathResources)
	candidates := []string{filepath.Join(resources, "dist", "desktop-bridge.js")}
	if cwd, err := os.Getwd(); err == nil {
		for range 5 {
			candidates = append(candidates, filepath.Join(cwd, "dist", "desktop-bridge.js"))
			cwd = filepath.Dir(cwd)
		}
	}
	_, source, _, _ := runtime.Caller(0)
	candidates = append(candidates, filepath.Join(filepath.Dir(source), "..", "..", "dist", "desktop-bridge.js"))
	for _, path := range candidates {
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			return filepath.Abs(path)
		}
	}
	return "", errors.New("Local service files were not found. Run npm run build from the repository root, or rebuild the desktop app.")
}

func nodePath() (string, error) {
	if path := os.Getenv("ADP_NODE"); path != "" {
		return path, nil
	}
	if path, err := exec.LookPath("node"); err == nil {
		return path, nil
	}
	for _, path := range []string{"/opt/homebrew/bin/node", "/usr/local/bin/node"} {
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}
	return "", errors.New("Node.js 22+ was not found. Install Node.js or set ADP_NODE to its executable path.")
}

func (d *Desktop) startWorker() error {
	if d.worker != nil {
		return nil
	}
	path, err := bridgePath()
	if err != nil {
		return err
	}
	node, err := nodePath()
	if err != nil {
		return err
	}
	cmd := exec.Command(node, path)
	input, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		input.Close()
		return err
	}
	cmd.Stderr = os.Stderr
	if err = cmd.Start(); err != nil {
		input.Close()
		output.Close()
		return err
	}
	d.worker, d.input, d.output = cmd, input, make(chan string, 1)
	lines := d.output
	go func() {
		defer close(lines)
		scanner := bufio.NewScanner(output)
		scanner.Buffer(make([]byte, 64*1024), 1024*1024)
		for scanner.Scan() {
			lines <- scanner.Text()
		}
	}()
	return nil
}

func (d *Desktop) stopWorker() {
	if d.worker == nil {
		return
	}
	d.input.Close()
	_ = d.worker.Process.Kill()
	_ = d.worker.Wait()
	d.worker, d.input, d.output = nil, nil, nil
}

// Call executes one allowlisted desktop command. It never accepts shell commands.
func (d *Desktop) Call(ctx context.Context, payload string) (string, error) {
	if len(payload) > 131072 || strings.ContainsAny(payload, "\r\n") {
		return "", errors.New("invalid desktop request")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if err := d.startWorker(); err != nil {
		return "", err
	}
	if _, err := fmt.Fprintln(d.input, payload); err != nil {
		d.stopWorker()
		return "", err
	}
	deadline, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	select {
	case line, ok := <-d.output:
		if !ok {
			d.stopWorker()
			return "", errors.New("The local service connection was interrupted. Please retry.")
		}
		return line, nil
	case <-deadline.Done():
		d.stopWorker()
		return "", errors.New("The local service did not respond in time. Please retry.")
	}
}

// OpenMain shows the full application from the tray panel.
func (d *Desktop) OpenMain() { d.main.Show(); d.main.Restore(); d.main.Focus(); d.panel.Hide() }

// DismissPanel hides the tray panel, including on Escape.
func (d *Desktop) DismissPanel() {
	if d.panel != nil {
		d.panel.Hide()
	}
}

func (d *Desktop) close() { d.mu.Lock(); defer d.mu.Unlock(); d.stopWorker() }
