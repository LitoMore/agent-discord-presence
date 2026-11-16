package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestBackendScenarioCatalogFitsNativeSetup(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node.js is not installed")
	}
	if _, err := os.Stat("../../dist/desktop.js"); err != nil {
		t.Skip("Build the shared service before checking its native setup catalog")
	}
	t.Setenv("ADP_CONFIG", filepath.Join(t.TempDir(), "config.json"))
	for _, agent := range []string{"codex", "claude-code", "pi"} {
		command := exec.Command(node, "--input-type=module", "-e", `import {handleDesktopRequest} from '../../dist/desktop.js'; console.log(JSON.stringify(await handleDesktopRequest({action:'integration',agent:process.argv[1],path:process.argv[2]})));`, agent, filepath.Join(t.TempDir(), "integration.json"))
		data, err := command.Output()
		if err != nil {
			t.Fatal(err)
		}
		var response desktopResponse
		if err := json.Unmarshal(data, &response); err != nil {
			t.Fatal(err)
		}
		if response.SetupPlan == nil || len(response.SetupPlan.Scenarios) < 4 {
			t.Fatalf("missing backend scenarios: %s", data)
		}
		for _, language := range []string{languageEnglish, languageChinese} {
			for _, size := range [][2]int{{1120, 820}, {760, 620}} {
				a := fixtureApp()
				a.page, a.prefs.Language = "Agents", language
				a.accept(&response)
				tt := ui.NewTester(a.view, size[0], size[1])
				if !tt.HasText(a.t("Summarize after each reply")) || tt.HasText(a.t("Events to register")) {
					t.Fatal("scenario catalog did not reach the native view")
				}
				for _, info := range tt.AccessAll() {
					if info.Role == ui.RoleButton && info.Name == a.t("Apply configuration") && info.Bounds.Y+info.Bounds.H > float32(size[1])+1 {
						t.Fatalf("scenario footer overflows: %+v", info)
					}
				}
				saveTestImage(t, tt, fmt.Sprintf("native-scenarios-%s-%s-%d.png", agent, language, size[0]))
				if err := tt.Click(a.t("Advanced: individual events")); err != nil {
					t.Fatal(err)
				}
				if !tt.HasText(a.t("Events to register")) {
					t.Fatal("advanced hook selection disappeared")
				}
				saveTestImage(t, tt, fmt.Sprintf("native-scenarios-advanced-%s-%s-%d.png", agent, language, size[0]))
			}
		}
	}
}

func managedFixture() (*nativeApp, *setupPlan) {
	a := fixtureApp()
	a.page = "Agents"
	p := &setupPlan{Agent: "codex", Path: "/tmp/project/.codex/hooks.json", Kind: "hooks", Status: "ready", Revision: "preview-revision",
		SelectedEvents: []string{"SessionStart", "Stop", "PreToolUse", "SessionEnd"}, InstalledEvents: []string{"SessionStart", "Stop"}, Added: []string{"PreToolUse", "SessionEnd"}, Kept: []string{"SessionStart", "Stop"},
		Catalog: []integrationEvent{
			{ID: "SessionStart", Capability: "presence", Description: "Initialize session activity."},
			{ID: "Stop", Capability: "presence", Description: "Show idle after a reply and provide completed text for automatic summaries."},
			{ID: "PreToolUse", Capability: "tools", Description: "Show working before a tool runs."},
			{ID: "SessionEnd", Capability: "cleanup", Description: "Clear the session immediately when it ends."},
		}, Note: "Review the selected events. Other hooks and settings will be preserved."}
	p.SummaryTriggers = []string{"reply"}
	p.Scenarios = []integrationScenario{
		{ID: "reply-summary", Label: "Summarize after each reply", Events: []string{"Stop"}, SummaryTrigger: "reply"},
		{ID: "tool-summary", Label: "Summarize during tool calls", Events: []string{"PreToolUse"}, SummaryTrigger: "tool"},
	}
	a.accept(&desktopResponse{Integration: &integration{Agent: "codex", Prompt: "selected prompt", Content: "selected configuration"}, SetupPlan: p})
	return a, p
}
func TestManagedSetupSelectsAndPreviewsBeforeApplying(t *testing.T) {
	for _, language := range []string{languageEnglish, languageChinese} {
		a, p := managedFixture()
		a.prefs.Language = language
		var requests []map[string]any
		a.dispatch = func(request map[string]any, _ string) { requests = append(requests, request) }
		tt := ui.NewTester(a.view, 1120, 820)
		if !tt.HasText(a.t("Direct configuration")) || !tt.HasText(a.t("Add: %s", "PreToolUse, SessionEnd")) {
			t.Fatal("setup options and actual diff are missing")
		}
		if err := tt.Click(a.t("Advanced: individual events")); err != nil {
			t.Fatal(err)
		}
		if err := tt.Click(a.t("Tool activity")); err != nil {
			t.Fatal(err)
		}
		if a.setupSelected["PreToolUse"] || !a.setupDirty {
			t.Fatal("capability selection did not change the draft")
		}
		_ = tt.Click(a.t("Apply configuration"))
		if len(requests) != 0 {
			t.Fatal("changed selection was applied without preview")
		}
		if err := tt.Click(a.t("Preview configuration")); err != nil {
			t.Fatal(err)
		}
		last := requests[len(requests)-1]
		if last["action"] != "integration" || last["path"] != p.Path || !reflect.DeepEqual(last["events"], []string{"SessionStart", "Stop", "SessionEnd"}) {
			t.Fatalf("preview: %#v", last)
		}
		p.SelectedEvents = []string{"SessionStart", "Stop", "SessionEnd"}
		p.Added = []string{"SessionEnd"}
		a.accept(&desktopResponse{Integration: a.setup, SetupPlan: p})
		tt.Frame()
		if err := tt.Click(a.t("Apply configuration")); err != nil {
			t.Fatal(err)
		}
		last = requests[len(requests)-1]
		if last["action"] != "setup" || last["revision"] != p.Revision || !reflect.DeepEqual(last["events"], p.SelectedEvents) {
			t.Fatalf("apply: %#v", last)
		}
		a.accept(&desktopResponse{SetupResult: &setupResult{Plan: *p, Changed: true, Backup: "/tmp/hooks.backup"}})
		tt.Frame()
		if !tt.HasText(a.t("Configuration applied. Reload the agent or start a new session.")) {
			t.Fatal("setup completion is missing")
		}
		if err := tt.Click(a.t("Agent prompt")); err != nil {
			t.Fatal(err)
		}
		if err := tt.Click(a.t("Copy prompt")); err != nil {
			t.Fatal(err)
		}
		if tt.Clipboard() != a.setup.Prompt {
			t.Fatal("selected prompt was not copied")
		}
	}
}

func TestPartialRemovalSelectsOnlyRequestedEvents(t *testing.T) {
	a, setup := managedFixture()
	a.setupOpen = false
	p := &uninstallPlan{Agent: "codex", Path: setup.Path, Kind: "hooks", Status: "ready", Count: 4, Revision: "removal-preview", Catalog: setup.Catalog, InstalledEvents: setup.SelectedEvents, SelectedEvents: setup.SelectedEvents}
	a.accept(&desktopResponse{UninstallPlan: p})
	var requests []map[string]any
	a.dispatch = func(request map[string]any, _ string) { requests = append(requests, request) }
	tt := ui.NewTester(a.view, 1120, 820)
	if !tt.HasText("Select the events you want to remove.") || a.removalAll || len(selectedIDs(p.Catalog, a.removalSelected)) != 0 {
		t.Fatal("removal should open with visible, unselected events")
	}
	saveTestImage(t, tt, "native-removal-checkbox-default.png")
	if err := tt.Click("Select all"); err != nil {
		t.Fatal(err)
	}
	if len(selectedIDs(p.Catalog, a.removalSelected)) != len(p.InstalledEvents) {
		t.Fatal("select all did not select the installed events")
	}
	if err := tt.Click("Clear selection"); err != nil {
		t.Fatal(err)
	}
	if len(selectedIDs(p.Catalog, a.removalSelected)) != 0 {
		t.Fatal("clear selection did not clear the event checkboxes")
	}
	if err := tt.Click("PreToolUse"); err != nil {
		t.Fatal(err)
	}
	if !a.removalDirty || !a.removalSelected["PreToolUse"] {
		t.Fatal("removal selection did not change")
	}
	_ = tt.Click("Remove selected")
	if len(requests) != 0 {
		t.Fatal("partial removal skipped preview")
	}
	if err := tt.Click("Preview again"); err != nil {
		t.Fatal(err)
	}
	last := requests[len(requests)-1]
	expected := []string{"PreToolUse"}
	if !reflect.DeepEqual(last["events"], expected) {
		t.Fatalf("partial preview: %#v", last)
	}
	p.SelectedEvents = expected
	p.Partial = true
	a.accept(&desktopResponse{UninstallPlan: p})
	tt.Frame()
	if err := tt.Click("Remove selected"); err != nil {
		t.Fatal(err)
	}
	last = requests[len(requests)-1]
	if last["action"] != "uninstall" || !reflect.DeepEqual(last["events"], expected) {
		t.Fatalf("partial confirmation: %#v", last)
	}
}

func TestPairedPluginEventsAndRequiredCallbacks(t *testing.T) {
	catalog := []integrationEvent{{ID: "start", Required: true}, {ID: "asked", Requires: []string{"replied"}}, {ID: "replied", Requires: []string{"asked"}}}
	selected := selectionMap([]string{"start"})
	toggleEvent(catalog, selected, "asked", true, false)
	if !selected["asked"] || !selected["replied"] {
		t.Fatal("setup did not include paired callbacks")
	}
	toggleEvent(catalog, selected, "replied", false, false)
	if selected["asked"] || selected["replied"] {
		t.Fatal("setup did not disable paired callbacks")
	}
	selected = map[string]bool{}
	toggleEvent(catalog, selected, "asked", true, true)
	if !selected["asked"] || !selected["replied"] {
		t.Fatal("removal did not include dependent callbacks")
	}
	toggleEvent(catalog, selected, "asked", false, true)
	if selected["asked"] || selected["replied"] {
		t.Fatal("removal did not deselect paired callbacks")
	}
}

func TestScenarioSelectionPreservesSharedAndRequiredEvents(t *testing.T) {
	p := &setupPlan{Catalog: []integrationEvent{{ID: "start", Required: true}, {ID: "Stop"}, {ID: "tool"}}, Scenarios: []integrationScenario{
		{ID: "status", Events: []string{"start", "Stop"}},
		{ID: "reply", Events: []string{"Stop"}, SummaryTrigger: "reply"},
		{ID: "tools", Events: []string{"tool"}, SummaryTrigger: "tool"},
	}}
	selected, triggers := selectionMap([]string{"start", "Stop", "tool"}), selectionMap([]string{"reply", "tool"})
	toggleScenario(p, selected, triggers, p.Scenarios[1], false)
	if triggers["reply"] || !selected["Stop"] {
		t.Fatal("disabling summaries disabled shared idle status")
	}
	toggleScenario(p, selected, triggers, p.Scenarios[0], false)
	if !selected["start"] || selected["Stop"] {
		t.Fatal("required lifecycle events were not preserved")
	}
	toggleScenario(p, selected, triggers, p.Scenarios[2], false)
	if triggers["tool"] || selected["tool"] {
		t.Fatal("tool scenario was not disabled")
	}
}

func TestScenariosLeadSetupAndAdvancedExclusionsSurvivePreview(t *testing.T) {
	for _, language := range []string{languageEnglish, languageChinese} {
		a, p := managedFixture()
		a.prefs.Language = language
		var requested map[string]any
		a.dispatch = func(request map[string]any, _ string) { requested = request }
		tt := ui.NewTester(a.view, 1120, 820)
		if !tt.HasText(a.t("When should Presence update?")) || tt.HasText(a.t("Events to register")) {
			t.Fatal("raw hooks are still the primary setup interface")
		}
		if err := tt.Click(a.t("Summarize during tool calls")); err != nil {
			t.Fatal(err)
		}
		if !a.setupTriggers["tool"] || !a.setupSelected["PreToolUse"] || !a.setupDirty {
			t.Fatal("scenario did not include its hook combination and summary timing")
		}
		if err := tt.Click(a.t("Advanced: individual events")); err != nil {
			t.Fatal(err)
		}
		if err := tt.Click("PreToolUse"); err != nil {
			t.Fatal(err)
		}
		if !a.setupTriggers["tool"] || a.setupSelected["PreToolUse"] {
			t.Fatal("advanced override lost the scenario intent")
		}
		if err := tt.Click(a.t("Advanced: individual events")); err != nil {
			t.Fatal(err)
		}
		if !tt.HasText(a.t("Some required events are disabled in Advanced. This scenario may not update.")) {
			t.Fatal("missing hook consequences are not visible")
		}
		if err := tt.Click(a.t("Preview configuration")); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(requested["summaryTriggers"], []string{"reply", "tool"}) {
			t.Fatalf("preview lost summary timing: %#v", requested)
		}
		p.SelectedEvents = []string{"SessionStart", "Stop", "SessionEnd"}
		p.SummaryTriggers = []string{"reply", "tool"}
		a.accept(&desktopResponse{Integration: a.setup, SetupPlan: p})
		tt.Frame()
		if a.setupSelected["PreToolUse"] || !a.setupTriggers["tool"] {
			t.Fatal("preview silently re-enabled an excluded hook")
		}
		saveTestImage(t, tt, "native-scenario-setup-"+language+".png")
	}
}

func TestManagedDialogsFitBothLanguagesAndWindowSizes(t *testing.T) {
	for _, language := range []string{languageEnglish, languageChinese} {
		for _, size := range [][2]int{{1120, 820}, {760, 620}} {
			a, p := managedFixture()
			a.prefs.Language = language
			tt := ui.NewTester(a.view, size[0], size[1])
			for _, info := range tt.AccessAll() {
				if info.Role == ui.RoleButton && (info.Name == a.t("Apply configuration") || info.Name == a.t("Close")) && (info.Bounds.Y < 0 || info.Bounds.Y+info.Bounds.H > float32(size[1])+1) {
					t.Fatalf("setup buttons overflow: %+v", info)
				}
			}
			saveTestImage(t, tt, "native-event-setup-"+language+".png")
			a.setupOpen = false
			a.accept(&desktopResponse{UninstallPlan: &uninstallPlan{Agent: "codex", Path: p.Path, Kind: "hooks", Status: "ready", Count: 1, Partial: true, Catalog: p.Catalog, InstalledEvents: p.SelectedEvents, SelectedEvents: []string{"PreToolUse"}, Details: []string{"PreToolUse: adp hook codex"}}})
			tt.Frame()
			for _, info := range tt.AccessAll() {
				if info.Role == ui.RoleButton && info.Name == a.t("Remove selected") && (info.Bounds.Y < 0 || info.Bounds.Y+info.Bounds.H > float32(size[1])+1) {
					t.Fatalf("removal button overflows: %+v", info)
				}
			}
			saveTestImage(t, tt, "native-event-removal-"+language+".png")
		}
	}
}
