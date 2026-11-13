package main

import (
	"encoding/json"
	"errors"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
)

func fixtureApp() *nativeApp {
	a := newNativeApp(&Desktop{})
	base := settings{Enabled: true, MaxLength: 72, Service: "session", APIKeyEnv: "OPENAI_API_KEY", Presence: map[string]any{}}
	var data snapshot
	_ = json.Unmarshal([]byte(`{"status":{"discord":"dry-run","activityAcknowledged":false,"pid":42,"selected":"codex:one","sessions":[{"key":"codex:one","agent":"codex","state":"working","summary":{"topic":"Designing the desktop app","subtitle":"Refining native UI"}},{"key":"claude-code:two","agent":"claude-code","state":"waiting","summary":{"topic":"Updating project docs"}}]},"configuration":{},"configPath":"/tmp/presence/config.json","socketPath":"/tmp/presence/service.sock","version":"0.0.3"}`), &data)
	data.Effective = base
	data.AgentSettings = map[string]settings{}
	for _, id := range agentIDs {
		data.AgentSettings[id] = base
	}
	for i := range data.Status.Sessions {
		data.Status.Sessions[i].StartedAt = time.Now().Add(-12 * time.Minute).UnixMilli()
	}
	data.Status.Activity = renderPreview(&data.Status.Sessions[0], map[string]any{"assets": map[string]any{"large_image": "fixture-agent"}})
	a.data = &data
	return a
}

func TestNativeNavigationPinAndScopedForms(t *testing.T) {
	a := fixtureApp()
	var requests []map[string]any
	a.dispatch = func(request map[string]any, _ string) { requests = append(requests, request) }
	tt := ui.NewTester(a.view, 1120, 820)
	if !tt.HasText("Designing the desktop app") {
		t.Fatal("live session is missing")
	}
	if err := tt.Click("Pin Claude Code: Updating project docs"); err != nil {
		t.Fatal(err)
	}
	if len(requests) != 1 || requests[0]["action"] != "pin" || requests[0]["key"] != "claude-code:two" {
		t.Fatalf("pin request: %#v", requests)
	}
	if err := tt.Click("Appearance"); err != nil {
		t.Fatal(err)
	}
	if !tt.HasText("Activity name") || !tt.HasText("Save changes") {
		t.Fatal("native appearance form is missing")
	}
	if err := tt.Click("Activity name"); err != nil {
		t.Fatal(err)
	}
	tt.Key(ui.Cmd, ui.KeyA)
	tt.Type("{agent} · Native preview")
	if a.edit == nil || !a.edit.Dirty || a.edit.Name != "{agent} · Native preview" {
		t.Fatalf("editing: %+v", a.edit)
	}
	if !tt.HasText("Codex · Native preview") {
		t.Fatal("unsaved appearance did not update the profile preview")
	}
	if err := tt.Click("Save changes"); err != nil {
		t.Fatal(err)
	}
	last := requests[len(requests)-1]
	if last["action"] != "save" || last["scope"] != "global" {
		t.Fatalf("save request: %#v", last)
	}
	if err := tt.Click("Summaries"); err != nil {
		t.Fatal(err)
	}
	if !tt.HasText("Generate summaries automatically") {
		t.Fatal("native summary controls are missing")
	}
	if err := tt.Click("Settings scope"); err != nil {
		t.Fatal(err)
	}
	tt.Key(0, ui.KeySpace)
	if err := tt.Click("Codex"); err != nil {
		t.Fatal(err)
	}
	if a.edit.Scope != "codex" {
		t.Fatalf("scope: %s", a.edit.Scope)
	}
	if err := tt.Click("Generate summaries automatically"); err != nil {
		t.Fatal(err)
	}
	if a.edit.Enabled {
		t.Fatal("summary checkbox did not update the draft")
	}
	if err := tt.Click("Save changes"); err != nil {
		t.Fatal(err)
	}
	last = requests[len(requests)-1]
	if last["scope"] != "codex" || last["patch"].(map[string]any)["enabled"] != false {
		t.Fatalf("agent override: %#v", last)
	}
}

func TestNativeViewsFitAndControlsHaveNames(t *testing.T) {
	for _, size := range [][2]float32{{1120, 820}, {980, 740}, {760, 620}} {
		for _, page := range []string{"Overview", "Agents", "Appearance", "Summaries", "Preferences"} {
			a := fixtureApp()
			a.page = page
			a.dispatch = func(map[string]any, string) {}
			tt := ui.NewTester(a.view, int(size[0]), int(size[1]))
			for _, info := range tt.AccessAll() {
				if info.Role == ui.RoleButton && strings.TrimSpace(info.Name) == "" {
					t.Fatalf("unnamed button on %s: %+v", page, info)
				}
				if info.Bounds.W > 0 && info.Bounds.H > 0 && (info.Bounds.X < 0 || info.Bounds.X+info.Bounds.W > size[0]+1) {
					t.Fatalf("%s at %v overflows horizontally: %s %+v", page, size, info.Name, info.Bounds)
				}
			}
			if page == "Overview" && size[0] == 1120 {
				saveTestImage(t, tt, "native-overview.png")
			}
		}
	}
}

func TestNativeTrayAndIntegrationDialog(t *testing.T) {
	a := fixtureApp()
	var requested map[string]any
	a.dispatch = func(request map[string]any, _ string) { requested = request }
	tt := ui.NewTester(a.trayView, 400, 550)
	if err := tt.Click("Pin Claude Code: Updating project docs"); err != nil {
		t.Fatal(err)
	}
	if requested["key"] != "claude-code:two" {
		t.Fatalf("tray pin: %#v", requested)
	}
	saveTestImage(t, tt, "native-tray.png")
	a.page = "Agents"
	a.setup = &integration{Agent: "codex", Path: "/tmp/hooks.json", Content: `{"hooks":{}}`, Instructions: "Merge these hooks into your configuration.", Prompt: "Set up Agent Discord Presence for Codex, preserving my existing hooks."}
	a.setupOpen = true
	tt = ui.NewTester(a.view, 1120, 820)
	if !tt.HasText("Set up Codex") {
		t.Fatal("native integration dialog is missing")
	}
	if err := tt.Click("Copy prompt"); err != nil {
		t.Fatal(err)
	}
	if tt.Clipboard() != a.setup.Prompt || !tt.HasText("Copied to clipboard.") {
		t.Fatal("prompt copy did not confirm the copied prompt")
	}
	tt.Advance(2 * time.Second)
	if !tt.HasText("Copy prompt") {
		t.Fatal("copy feedback did not reset")
	}
	if err := tt.Click("Manual configuration"); err != nil {
		t.Fatal(err)
	}
	if tt.Clipboard() != a.setup.Prompt {
		t.Fatal("switching setup method changed the clipboard")
	}
	if err := tt.Click("Copy configuration"); err != nil {
		t.Fatal(err)
	}
	if tt.Clipboard() != a.setup.Content {
		t.Fatal("integration copy did not reach the native clipboard service")
	}
	tt.Advance(2 * time.Second)
	tt.FailClipboard(errors.New("clipboard unavailable"))
	if err := tt.Click("Copy configuration"); err != nil {
		t.Fatal(err)
	}
	if !tt.HasText("Could not copy.") || tt.HasText("Copied to clipboard.") {
		t.Fatal("clipboard failure was reported as success")
	}
}

func TestDraftPreviewPreservesUnicodeAndDoesNotPublish(t *testing.T) {
	s := session{Key: "codex:fixture", Agent: "codex", State: "working", StartedAt: 1234567}
	p := map[string]any{"name": "{agent} · {topic}", "details": nil, "state": "{phase}", "timestamps": map[string]any{"start": "session"}, "buttons": []any{map[string]any{"label": "{agent} project", "url": "https://example.com"}}}
	act := renderPreview(&s, p)
	if act.Name != "Codex · Coding with Codex" || act.Details != "" || act.State != "Working" || act.Timestamps.Start != 1234 || act.Buttons[0].Label != "Codex project" {
		t.Fatalf("render: %+v", act)
	}
	if p["timestamps"].(map[string]any)["start"] != "session" {
		t.Fatal("preview mutated stored settings")
	}
	if renderPreview(nil, p) != nil {
		t.Fatal("preview invented a session")
	}
}

func saveTestImage(t *testing.T, tt *ui.Tester, name string) {
	t.Helper()
	dir := os.Getenv("ADP_UI_SNAPSHOTS")
	if dir == "" {
		return
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if err := png.Encode(file, tt.Image()); err != nil {
		t.Fatal(err)
	}
}
