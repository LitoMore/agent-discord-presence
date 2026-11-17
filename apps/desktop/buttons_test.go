package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestProfileButtonEditor(t *testing.T) {
	for _, language := range []string{languageEnglish, languageChinese} {
		t.Run(language, func(t *testing.T) {
			a := fixtureApp()
			a.page, a.scope, a.prefs.Language = "Appearance", "Codex", language
			var requests []map[string]any
			a.dispatch = func(r map[string]any, _ string) { requests = append(requests, r) }
			tt := ui.NewTester(a.view, 1120, 1800)
			click := func(label string, args ...any) {
				t.Helper()
				if err := tt.Click(a.t(label, args...)); err != nil {
					t.Fatal(err)
				}
			}
			fill := func(label, value string) {
				t.Helper()
				click(label, 1)
				tt.Key(ui.Cmd, ui.KeyA)
				tt.Type(value)
			}
			click("Add button")
			tt.Key(ui.Cmd, ui.KeyS)
			if len(requests) != 0 || a.edit.buttonsError() == "" {
				t.Fatal("an incomplete button was saved")
			}
			fill("Button %d text", "{agent} project")
			fill("Button %d URL", "http://example.com")
			tt.Key(ui.Cmd, ui.KeyS)
			if len(requests) != 0 {
				t.Fatal("an HTTP link was saved")
			}
			fill("Button %d URL", "https://example.com/project")
			a.err = ""
			tt.Frame()
			if !tt.HasText("Codex project") {
				t.Fatal("draft button did not render in the profile preview")
			}
			click("Add button")
			click("Button %d text", 2)
			tt.Type("Community")
			click("Button %d URL", 2)
			tt.Type("https://example.com/community")
			if info, ok := tt.Access(a.t("Add button")); !ok || !info.Disabled {
				t.Fatal("the two-button limit was not enforced")
			}
			click("Save changes")
			if len(requests) != 1 || requests[0]["scope"] != "codex" {
				t.Fatalf("scoped save: %#v", requests)
			}
			p := requests[0]["patch"].(map[string]any)["presence"].(map[string]any)
			act := renderPreview(&a.data.Status.Sessions[0], p)
			if len(act.Buttons) != 2 || act.Buttons[0].Label != "Codex project" || act.Buttons[1].URL != "https://example.com/community" {
				t.Fatalf("saved buttons: %+v", act.Buttons)
			}
			tt.SetSize(1120, 820)
			tt.Scroll(500, 500, 0, 500)
			saveTestImage(t, tt, "native-buttons-"+language+".png")
			tt.SetSize(1120, 1800)
			tt.Scroll(500, 500, 0, -3000)
			click("Remove button %d", 1)
			if len(a.edit.Buttons) != 1 || a.edit.Buttons[0].Label != "Community" {
				t.Fatalf("removing the first button did not keep the second: %+v", a.edit.Buttons)
			}
			if info, ok := tt.AccessByRole(ui.RoleTextField, a.t("Button %d text", 1)); !ok || info.Value != "Community" {
				t.Fatalf("remaining button field did not refresh: %+v", info)
			}
			click("Remove button %d", 1)
			click("Save changes")
			p = requests[len(requests)-1]["patch"].(map[string]any)["presence"].(map[string]any)
			if buttons, ok := p["buttons"].([]any); !ok || len(buttons) != 0 {
				t.Fatalf("removing all buttons must send an empty array: %#v", p)
			}
			click("Inherit global")
			if requests[len(requests)-1]["action"] != "reset" || requests[len(requests)-1]["scope"] != "codex" {
				t.Fatal("inherit global did not reset agent appearance")
			}
		})
	}
}

func TestProfileButtonsFitSmallWindows(t *testing.T) {
	for _, language := range []string{languageEnglish, languageChinese} {
		for _, size := range [][2]int{{1120, 820}, {980, 740}, {760, 620}} {
			a := fixtureApp()
			a.page, a.prefs.Language = "Appearance", language
			saved := false
			a.dispatch = func(r map[string]any, _ string) { saved = r["action"] == "save" }
			e := a.editor()
			e.Buttons = []presenceButton{{Label: "Project", URL: "https://example.com"}, {Label: "Community", URL: "https://example.com/community"}}
			e.ButtonsDirty, e.Dirty = true, true
			tt := ui.NewTester(a.view, size[0], size[1])
			for attempt := 0; attempt < 12; attempt++ {
				if err := tt.Click(a.t("Save changes")); err == nil {
					break
				}
				tt.Scroll(500, 500, 0, 180)
			}
			for _, info := range tt.AccessAll() {
				if info.Bounds.W > 0 && info.Bounds.H > 0 && (info.Bounds.X < 0 || info.Bounds.X+info.Bounds.W > float32(size[0])+1) {
					t.Fatalf("buttons overflow at %v (%s): %+v", size, language, info)
				}
			}
			if !saved {
				t.Fatalf("save is unreachable at %v (%s)", size, language)
			}
		}
	}
}

func TestProfileButtonInheritanceAndValidation(t *testing.T) {
	a := fixtureApp()
	a.page = "Appearance"
	a.data.Effective.Presence = map[string]any{"buttons": []any{map[string]any{"label": "Global project", "url": "https://example.com"}}, "details_url": "https://example.com/details"}
	a.data.AgentSettings["codex"] = a.data.Effective
	a.scope = "Codex"
	e := a.editor()
	if len(e.Buttons) != 1 || e.Buttons[0].Label != "Global project" {
		t.Fatal("inherited buttons were not loaded into the editor")
	}
	e.Buttons[0].Label, e.ButtonsDirty = "New project", true
	p := e.presence()
	if p["details_url"] != "https://example.com/details" || a.data.Effective.Presence["buttons"].([]any)[0].(map[string]any)["label"] != "Global project" {
		t.Fatal("editing buttons changed unrelated or inherited settings")
	}
	// A new snapshot reopens the form from the saved settings.
	a.data.AgentSettings["codex"] = settings{Presence: p}
	a.edit = nil
	if a.editor().Buttons[0].Label != "New project" {
		t.Fatal("saved buttons were not restored")
	}
	for _, button := range []presenceButton{
		{Label: "", URL: "https://example.com"},
		{Label: strings.Repeat("字", 33), URL: "https://example.com"},
		{Label: "Control\x00", URL: "https://example.com"},
		{Label: "Project", URL: "https://user:pass@example.com"},
		{Label: "Project", URL: "https:///missing-host"},
		{Label: "Project", URL: "javascript:alert(1)"},
	} {
		if (&editor{Buttons: []presenceButton{button}}).buttonsError() == "" {
			t.Fatalf("accepted invalid button: %+v", button)
		}
	}
	valid := &editor{Buttons: []presenceButton{{Label: strings.Repeat("字", 32), URL: "https://example.com"}}}
	if valid.buttonsError() != "" {
		t.Fatal("valid Unicode label was rejected")
	}
	valid.Base = settings{Presence: map[string]any{}}
	data, _ := json.Marshal(valid.presence())
	if strings.Contains(string(data), "buttons") {
		t.Fatal("unrelated edits introduced a button override")
	}
}
