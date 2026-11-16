package main

import (
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestRemovalMenuPreviewAndConfirmation(t *testing.T) {
	for _, language := range []string{languageEnglish, languageChinese} {
		t.Run(language, func(t *testing.T) {
			a := fixtureApp()
			a.page = "Agents"
			a.prefs.Language = language
			var requests []map[string]any
			a.dispatch = func(request map[string]any, _ string) { requests = append(requests, request) }
			tt := ui.NewTester(a.view, 1120, 820)
			for _, agent := range agentIDs {
				if err := tt.Click(a.t("Manage %s integration", agentLabels[agent])); err != nil {
					t.Fatal(err)
				}
				if err := tt.ChooseMenuItem(a.t("Remove integration…")); err != nil {
					t.Fatal(err)
				}
				last := requests[len(requests)-1]
				if last["action"] != "uninstall-preview" || last["agent"] != agent {
					t.Fatalf("menu removed without preview or selected the wrong agent: %#v", last)
				}
			}
			plan := &uninstallPlan{Agent: "codex", Path: "/tmp/project/.codex/hooks.json", Status: "ready", Kind: "hooks", Count: 2, Revision: "reviewed-revision", Details: []string{"Stop: adp hook codex", "SessionEnd: adp hook codex"}, Note: "Only recognized Presence hook commands will be removed."}
			a.accept(&desktopResponse{UninstallPlan: plan})
			tt.Frame()
			if !tt.HasText(a.t("Remove %s integration", "Codex")) || !tt.HasText(a.t("Remove %d Presence hook command(s).", 2)) {
				t.Fatal("removal preview is missing")
			}
			before := len(requests)
			if err := tt.Click(a.t("Cancel")); err != nil {
				t.Fatal(err)
			}
			if a.removalOpen || len(requests) != before {
				t.Fatal("cancel modified the integration")
			}
			a.accept(&desktopResponse{UninstallPlan: plan})
			tt.Frame()
			saveTestImage(t, tt, "native-uninstall-"+language+".png")
			if err := tt.Click(a.t("Integration file")); err != nil {
				t.Fatal(err)
			}
			tt.Key(ui.Cmd, ui.KeyA)
			tt.Type("/tmp/another-project/hooks.json")
			_ = tt.Click(a.t("Remove integration"))
			if len(requests) != before {
				t.Fatal("a changed path could be removed without another preview")
			}
			if err := tt.Click(a.t("Preview again")); err != nil {
				t.Fatal(err)
			}
			last := requests[len(requests)-1]
			if last["action"] != "uninstall-preview" || last["path"] != a.removalPath {
				t.Fatalf("custom path was not previewed: %#v", last)
			}
			a.accept(&desktopResponse{UninstallPlan: plan})
			tt.Frame()
			if err := tt.Click(a.t("Remove integration")); err != nil {
				t.Fatal(err)
			}
			last = requests[len(requests)-1]
			if last["action"] != "uninstall" || last["agent"] != "codex" || last["path"] != plan.Path || last["revision"] != plan.Revision {
				t.Fatalf("confirmation did not use the reviewed plan: %#v", last)
			}
			a.accept(&desktopResponse{UninstallResult: &uninstallResult{Plan: *plan, Removed: true, Backup: "/tmp/hooks.json.backup"}})
			tt.Frame()
			if !tt.HasText(a.t("Integration removed.")) || !tt.HasText(a.t("Backup: %s", "/tmp/hooks.json.backup")) {
				t.Fatal("removal result or backup path is missing")
			}
			if _, ok := tt.Find(a.t("Remove integration")); ok {
				t.Fatal("completed removal can be submitted again")
			}
			saveTestImage(t, tt, "native-uninstall-result-"+language+".png")
		})
	}
}

func TestRemovalUnavailableStatesAndErrors(t *testing.T) {
	for _, language := range []string{languageEnglish, languageChinese} {
		for _, status := range []string{"not-found", "manual", "ready"} {
			for _, size := range [][2]int{{1120, 820}, {760, 620}} {
				a := fixtureApp()
				a.page = "Agents"
				a.prefs.Language = language
				a.accept(&desktopResponse{UninstallPlan: &uninstallPlan{Agent: "pi", Path: "/tmp/agent-presence.ts", Kind: "entry", Status: status, Count: 1, Details: []string{"export { default } from 'agent-discord-presence/pi';"}}})
				a.removalError = "The integration file changed. Preview the removal again."
				a.accept(&desktopResponse{Snapshot: a.data})
				tt := ui.NewTester(a.view, size[0], size[1])
				if !tt.HasText(a.t(a.removalError)) || a.removalError == "" {
					t.Fatal("removal error is hidden by the modal")
				}
				if _, ok := tt.Find(a.t("Remove integration")); ok && status != "ready" {
					t.Fatal("manual or missing integration offered automatic removal")
				}
				for _, info := range tt.AccessAll() {
					if info.Bounds.W > 0 && info.Bounds.H > 0 && (info.Bounds.X < 0 || info.Bounds.X+info.Bounds.W > float32(size[0])+1) {
						t.Fatalf("removal dialog overflows: %s %+v", info.Name, info.Bounds)
					}
				}
			}
		}
	}
}
