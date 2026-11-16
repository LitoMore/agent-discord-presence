package main

import (
	"reflect"
	"testing"

	"github.com/egoist/mygo/ui"
)

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
