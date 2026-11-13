package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWorkerRoundTripAndRecovery(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node.js is not installed")
	}
	path := filepath.Join(t.TempDir(), "bridge.mjs")
	source := `import {createInterface} from 'node:readline';
for await (const line of createInterface({input:process.stdin})) {
  if (line.includes('stall')) await new Promise(resolve => setTimeout(resolve, 60000));
  else process.stdout.write(JSON.stringify({echo:JSON.parse(line)})+'\n');
}`
	if err := os.WriteFile(path, []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ADP_NODE", node)
	t.Setenv("ADP_DESKTOP_BRIDGE", path)
	d := &Desktop{}
	t.Cleanup(d.close)
	result, err := d.Call(context.Background(), `{"action":"snapshot"}`)
	if err != nil || !strings.Contains(result, `"snapshot"`) {
		t.Fatalf("round trip: %q, %v", result, err)
	}
	if _, err := d.Call(context.Background(), "{}\n{}"); err == nil {
		t.Fatal("accepted a multi-line request")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := d.Call(ctx, `{"action":"stall"}`); err == nil {
		t.Fatal("expected cancellation")
	}
	if d.worker != nil {
		t.Fatal("canceled worker was not discarded")
	}
	result, err = d.Call(context.Background(), `{"action":"recovered"}`)
	if err != nil || !strings.Contains(result, "recovered") {
		t.Fatalf("recovery: %q, %v", result, err)
	}
}
