package main

import (
	"github.com/egoist/mygo/ui"
	"strings"
	"testing"
)

func TestGitHubPluginInstallProgressAndCancellation(t *testing.T) {
	for _, width := range []int{760, 1120} {
		for _, language := range []string{languageEnglish, languageChinese} {
			a := fixtureApp()
			a.page, a.prefs.Language = "Agents", language
			var requests []map[string]any
			a.dispatch = func(r map[string]any, _ string) { requests = append(requests, r) }
			tt := ui.NewTester(a.view, width, 820)
			if err := tt.Click(a.t("Install from GitHub…")); err != nil {
				t.Fatal(err)
			}
			dialog := false
			for _, info := range tt.AccessAll() {
				dialog = dialog || info.Role == ui.RoleDialog
			}
			if !dialog {
				t.Fatal("GitHub installation must open in a modal")
			}
			if err := tt.Click(a.t("GitHub source")); err != nil {
				t.Fatal(err)
			}
			tt.Type("github:owner/repo#feature/plugins")
			if err := tt.Click(a.t("Install plugin")); err != nil {
				t.Fatal(err)
			}
			if len(requests) != 1 || requests[0]["action"] != "plugin-install-start" || requests[0]["source"] != "github:owner/repo#feature/plugins" {
				t.Fatalf("install request: %#v", requests)
			}
			a.data.PluginInstall = &pluginInstallState{ID: "download-one", Spec: "github:owner/repo#" + strings.Repeat("a", 240), Phase: "downloading", Bytes: 1024, Total: 2048}
			tt.Frame()
			if !tt.HasText(a.t("Downloading plugin…")) || !tt.HasText("1 / 2 KB (50%)") {
				t.Fatal("real download progress is missing")
			}
			for _, info := range tt.AccessAll() {
				if info.Bounds.W > 0 && (info.Bounds.X < 0 || info.Bounds.X+info.Bounds.W > float32(width)+1) {
					t.Fatalf("install UI overflows: %s", info.Name)
				}
			}
			if err := tt.Click(a.t("Cancel installation")); err != nil {
				t.Fatal(err)
			}
			if len(requests) != 2 || requests[1]["action"] != "plugin-install-cancel" || requests[1]["id"] != "download-one" {
				t.Fatalf("cancel request: %#v", requests)
			}
			a.data.PluginInstall.Phase = "cancelling"
			tt.Frame()
			if !tt.HasText(a.t("Cancelling installation…")) {
				t.Fatal("cancel was reported complete before cleanup")
			}
			message := "No ADP plugin found. The source must contain adp-plugin.json at its root. Check the repository address or plugin folder."
			a.data.PluginInstall.Phase, a.data.PluginInstall.Error = "failed", message
			a.accept(&desktopResponse{Snapshot: a.data})
			tt.Frame()
			if !a.pluginSourceOpen || !tt.HasText(a.t("Plugin installation failed")) || !tt.HasText(a.t(message)) {
				t.Fatal("installation error is missing")
			}
			if language == languageChinese && tt.HasText(message) {
				t.Fatal("installation error was not translated")
			}
			if err := tt.Click(a.t("Close")); err != nil {
				t.Fatal(err)
			}
			if tt.HasText(a.t("Plugin installation failed")) || tt.HasText(a.t(message)) {
				t.Fatal("closed installation errors must not remain on the Agents page")
			}
			if err := tt.Click(a.t("Install from GitHub…")); err != nil {
				t.Fatal(err)
			}
			a.data.PluginInstall.ID = "download-two"
			a.data.PluginInstall.Phase, a.data.PluginInstall.Error, a.data.PluginInstall.Agent = "installed", "", "orbit"
			a.accept(&desktopResponse{Snapshot: a.data})
			tt.Frame()
			if a.pluginSourceOpen || a.pluginSource != "" || tt.HasText(a.t("GitHub source")) {
				t.Fatal("successful installation did not close and clear the modal")
			}
			if tt.HasText(a.t("Installed · waiting for Agent integration")) {
				t.Fatal("completed installation results must not remain on the Agents page")
			}
			saveTestImage(t, tt, "plugin-install-"+language+".png")
			if err := tt.Click(a.t("Install from GitHub…")); err != nil {
				t.Fatal(err)
			}
			a.accept(&desktopResponse{Snapshot: a.data})
			tt.Frame()
			if !a.pluginSourceOpen || !tt.HasText(a.t("GitHub source")) {
				t.Fatal("an earlier installation result closed the reopened modal")
			}
		}
	}
}

func TestActiveLocalPluginProgressCanBeReopened(t *testing.T) {
	a := fixtureApp()
	a.page = "Agents"
	a.data.PluginInstall = &pluginInstallState{ID: "local-one", Spec: "/tmp/plugin", Phase: "installing"}
	tt := ui.NewTester(a.view, 760, 620)
	if tt.HasText("Installing plugin…") {
		t.Fatal("installation progress must stay in its modal")
	}
	if err := tt.Click("Installation progress…"); err != nil {
		t.Fatal(err)
	}
	if !tt.HasText("Installing plugin…") || tt.HasText("GitHub source") {
		t.Fatal("local installation did not reopen its progress modal")
	}
	if err := tt.Click("Close"); err != nil {
		t.Fatal(err)
	}
	if tt.HasText("Installing plugin…") {
		t.Fatal("closing progress left a panel on the Agents page")
	}
}

func TestIdlePluginDoesNotLookBrokenOrClaimToBeConnected(t *testing.T) {
	a := fixtureApp()
	a.page = "Agents"
	a.data.Agents = append(a.agents(), agentDescriptor{ID: "orbit", Name: "Orbit", Installed: true, Enabled: true, Plugin: true})
	tt := ui.NewTester(a.view, 1120, 820)
	if !tt.HasText("Installed · waiting for Agent activity") {
		t.Fatal("idle plugin state is missing")
	}
	a.data.Status.Sessions = append(a.data.Status.Sessions, session{Key: "orbit:one", Agent: "orbit", State: "idle"})
	tt.Frame()
	if tt.HasText("Installed · waiting for Agent activity") {
		t.Fatal("a real session was ignored")
	}
}

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
			dialog := false
			for _, info := range tt.AccessAll() {
				dialog = dialog || info.Role == ui.RoleDialog
			}
			if !dialog || !tt.HasText(a.t("Remove %s plugin?", "Orbit Agent")) {
				t.Fatal("plugin removal must open a confirmation modal")
			}
			if err := tt.Click(a.t("Cancel")); err != nil {
				t.Fatal(err)
			}
			if len(requests) != 2 || tt.HasText(a.t("Confirm removal")) {
				t.Fatal("cancelling removal must close the modal without changing the plugin")
			}
			if err := tt.Click(a.t("Manage %s integration", "Orbit Agent")); err != nil {
				t.Fatal(err)
			}
			if err := tt.ChooseMenuItem(a.t("Remove plugin…")); err != nil {
				t.Fatal(err)
			}
			tt.Key(0, ui.KeyEscape)
			if a.pluginConfirm != "" || tt.HasText(a.t("Confirm removal")) {
				t.Fatal("Escape must dismiss plugin removal")
			}
			if err := tt.Click(a.t("Manage %s integration", "Orbit Agent")); err != nil {
				t.Fatal(err)
			}
			if err := tt.ChooseMenuItem(a.t("Remove plugin…")); err != nil {
				t.Fatal(err)
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
