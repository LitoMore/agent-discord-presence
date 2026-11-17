package main

import (
	"github.com/egoist/mygo/ui"
	"testing"
)

func TestPluginTranslationsStayScopedAndFollowLanguage(t *testing.T) {
	a := fixtureApp()
	a.data.Agents = append(a.agents(),
		agentDescriptor{ID: "orbit", Plugin: true, Locales: map[string]map[string]string{"zh-CN": {"Shared event": "轨道事件", "Cancel": "插件取消"}}},
		agentDescriptor{ID: "other", Plugin: true, Locales: map[string]map[string]string{"zh-CN": {"Shared event": "其他事件"}}},
	)
	a.prefs.Language = languageChinese
	if a.agentText("orbit", "Shared event") != "轨道事件" || a.agentText("other", "Shared event") != "其他事件" {
		t.Fatal("plugin translations crossed Agent scopes")
	}
	if a.t("Cancel") != "取消" || a.agentText("orbit", "Cancel") != "插件取消" || a.agentText("other", "Cancel") != "Cancel" {
		t.Fatal("application and plugin catalogs must be independent, with source fallback")
	}
	catalog := []integrationEvent{{ID: "reply", Capability: "summary", Description: "Shared event"}}
	for _, language := range []string{languageChinese, languageEnglish, "fr"} {
		a.prefs.Language = language
		want := "Shared event"
		if language == languageChinese {
			want = "轨道事件"
		}
		tt := ui.NewTester(func(c *ui.Context) {
			a.eventChoices(c, "orbit", catalog, map[string]bool{}, false, func() {})
		}, 600, 400)
		if !tt.HasText(want) {
			t.Fatalf("event description did not follow interface language: %s", language)
		}
	}
	a.prefs.Language = languageChinese
	if a.agentText("codex", "Cancel") != "取消" {
		t.Fatal("core translations stopped working")
	}
}

func TestExternalPluginManagementLivesInAgents(t *testing.T) {
	for _, width := range []int{1120, 760} {
		for _, language := range []string{languageEnglish, languageChinese} {
			a := fixtureApp()
			a.page = "Agents"
			a.prefs.Language = language
			if language == languageChinese {
				a.prefs.Theme = "Dark"
			}
			agents := a.agents()
			plugin := agentDescriptor{ID: "orbit", Name: "Orbit Agent", Version: "1.0.0", Description: "An external Agent integration", Installed: true, Enabled: true, Plugin: true}
			a.data.Agents = append(agents, plugin)
			a.data.Plugins = []agentDescriptor{plugin}
			a.data.AgentSettings["orbit"] = a.data.Effective
			var requests []map[string]any
			a.dispatch = func(r map[string]any, _ string) { requests = append(requests, r) }
			tt := ui.NewTester(a.view, width, 820)
			if !tt.HasText(a.t("Install local Agent plugin")) || !tt.HasText("Orbit Agent") {
				t.Fatal("external plugin is missing from Agents")
			}
			if tt.HasText("DISCORD PREVIEW") || tt.HasText("Plugins") {
				t.Fatal("Agents management must use a single page")
			}
			for _, info := range tt.AccessAll() {
				if info.Bounds.W > 0 && (info.Bounds.X < 0 || info.Bounds.X+info.Bounds.W > float32(width)+1) {
					t.Fatalf("Agent row overflows: %s", info.Name)
				}
			}
			saveTestImage(t, tt, "external-agents-"+language+".png")
			if err := tt.Click(a.t("Set up %s", "Orbit Agent")); err != nil {
				t.Fatal(err)
			}
			if len(requests) != 1 || requests[0]["agent"] != "orbit" || requests[0]["action"] != "integration" {
				t.Fatal("Setup lost the external Agent ID")
			}
			if err := tt.Click(a.t("Manage %s integration", "Orbit Agent")); err != nil {
				t.Fatal(err)
			}
			if err := tt.ChooseMenuItem(a.t("Disable plugin")); err != nil {
				t.Fatal(err)
			}
			if len(requests) != 2 || requests[1]["action"] != "plugin-disable" {
				t.Fatal("plugin toggle is missing")
			}
			if err := tt.Click(a.t("Manage %s integration", "Orbit Agent")); err != nil {
				t.Fatal(err)
			}
			if err := tt.ChooseMenuItem(a.t("Remove plugin…")); err != nil {
				t.Fatal(err)
			}
			if len(requests) != 2 {
				t.Fatal("plugin removed before confirmation")
			}
			if err := tt.Click(a.t("Confirm removal")); err != nil {
				t.Fatal(err)
			}
			if len(requests) != 3 || requests[2]["action"] != "plugin-remove" {
				t.Fatal("plugin removal is missing")
			}
			a.page = "Summaries"
			a.scope = "Orbit Agent"
			a.edit = nil
			tt.Frame()
			if a.editor().Scope != "orbit" {
				t.Fatal("external Agent settings scope is missing")
			}
		}
	}
}

func TestFreshDesktopHasNoPreinstalledPlugins(t *testing.T) {
	a := fixtureApp()
	a.page = "Agents"
	tt := ui.NewTester(a.view, 1120, 820)
	if len(a.agents()) != 5 || !tt.HasText("Pi") {
		t.Fatal("external plugins must not be preinstalled")
	}
	saveTestImage(t, tt, "agents-no-plugins.png")
}

func TestPolicyPluginOffersPartialIntegrationRemoval(t *testing.T) {
	a := fixtureApp()
	a.page = "Agents"
	a.data.Agents = append(a.agents(), agentDescriptor{ID: "orbit", Name: "Orbit Agent", Installed: true, Enabled: true, Plugin: true, ManagedIntegration: true})
	var requests []map[string]any
	a.dispatch = func(r map[string]any, _ string) { requests = append(requests, r) }
	tt := ui.NewTester(a.view, 1120, 820)
	if err := tt.Click(a.t("Manage %s integration", "Orbit Agent")); err != nil {
		t.Fatal(err)
	}
	if err := tt.ChooseMenuItem(a.t("Remove integration…")); err != nil {
		t.Fatal(err)
	}
	if len(requests) != 1 || requests[0]["action"] != "uninstall-preview" || requests[0]["agent"] != "orbit" {
		t.Fatal("policy plugin removal must request a preview")
	}
	plan := &uninstallPlan{Agent: "orbit", Kind: "managed", Status: "ready", Partial: true, Revision: "reviewed", Path: "/tmp/orbit.json", InstalledEvents: []string{"session/start", "approval/request"}, SelectedEvents: []string{"approval/request"}, Catalog: []integrationEvent{{ID: "session/start", Capability: "presence", Description: "Initialize session activity.", Required: true}, {ID: "approval/request", Capability: "waiting", Description: "Show waiting for approval."}}}
	a.accept(&desktopResponse{UninstallPlan: plan})
	tt.Frame()
	if a.removalAll || !tt.HasText(a.t("Events to remove")) || !a.removalSelected["approval/request"] {
		t.Fatal("partial preview was reset to entire integration removal")
	}
	if err := tt.Click(a.t("Remove selected")); err != nil {
		t.Fatal(err)
	}
	if len(requests) != 2 || requests[1]["action"] != "uninstall" {
		t.Fatal("selected policy removal was not dispatched")
	}
	events, ok := requests[1]["events"].([]string)
	if !ok || len(events) != 1 || events[0] != "approval/request" {
		t.Fatal("removal expanded beyond the selected events")
	}
}
