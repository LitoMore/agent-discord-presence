package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
)

func chooseOption(t *testing.T, tt *ui.Tester, control, option string) {
	t.Helper()
	if err := tt.Click(control); err != nil {
		t.Fatal(err)
	}
	if !tt.HasText(option) {
		tt.Key(0, ui.KeySpace)
	}
	if err := tt.Click(option); err != nil {
		t.Fatal(err)
	}
}

func TestLanguageSwitchPersistsAndUpdatesViews(t *testing.T) {
	a := fixtureApp()
	a.prefsPath = filepath.Join(t.TempDir(), "appearance.json")
	activityBefore, _ := json.Marshal(a.data.Status.Activity)
	a.events = []recentEvent{
		{Text: "Connected to the local service", At: time.Now()},
		{Agent: "codex", State: "working", At: time.Now()},
	}
	a.notice = "Settings reset."
	tt := ui.NewTester(a.view, 1120, 820)
	if err := tt.Click("Preferences"); err != nil {
		t.Fatal(err)
	}
	chooseOption(t, tt, "Interface language", "简体中文")
	if a.prefs.Language != languageChinese || a.page != "Preferences" || !tt.HasText("偏好设置") || !tt.HasText("跟随系统") || !tt.HasText("设置已重置。") {
		t.Fatalf("language switch did not update the current view: %+v", a.prefs)
	}
	saveTestImage(t, tt, "native-preferences-zh.png")

	restored := newNativeApp(&Desktop{})
	restored.prefsPath = a.prefsPath
	restored.loadPreferences()
	if restored.prefs != a.prefs {
		t.Fatalf("preferences were not restored: got %+v, want %+v", restored.prefs, a.prefs)
	}
	if err := tt.Click("概览"); err != nil {
		t.Fatal(err)
	}
	if !tt.HasText("已连接本地服务") || !tt.HasText("Codex · 工作中") || !tt.HasText("Designing the desktop app") {
		t.Fatal("existing events or session content did not render correctly after switching")
	}
	saveTestImage(t, tt, "native-overview-zh.png")
	tray := ui.NewTester(a.trayView, 400, 550)
	if !tray.HasText("活动来源") || !tray.HasText("打开主窗口") || !tray.HasText("试运行") {
		t.Fatal("tray panel did not use the selected language")
	}
	saveTestImage(t, tray, "native-tray-zh.png")
	activityAfter, _ := json.Marshal(a.data.Status.Activity)
	if string(activityAfter) != string(activityBefore) {
		t.Fatal("interface language changed published activity")
	}
	if err := tt.Click("偏好设置"); err != nil {
		t.Fatal(err)
	}
	chooseOption(t, tt, "界面语言", "English")
	if a.prefs.Language != languageEnglish || !tt.HasText("Preferences") || !tt.HasText("System") {
		t.Fatal("switching back to English failed")
	}
	restored.loadPreferences()
	if restored.prefs.Language != languageEnglish {
		t.Fatal("English selection was not saved")
	}
}

func TestLanguageSelectionWithoutServiceSnapshot(t *testing.T) {
	a := newNativeApp(&Desktop{})
	tt := ui.NewTester(a.view, 760, 620)
	if err := tt.Click("Preferences"); err != nil {
		t.Fatal(err)
	}
	chooseOption(t, tt, "Interface language", "简体中文")
	if a.prefs.Language != languageChinese || !tt.HasText("界面语言") {
		t.Fatal("language selection depends on the local service")
	}
}

func TestChineseSelectionsKeepStableConfigurationValues(t *testing.T) {
	a := fixtureApp()
	a.prefs.Language = languageChinese
	a.page = "Appearance"
	var requested map[string]any
	a.dispatch = func(request map[string]any, _ string) { requested = request }
	tt := ui.NewTester(a.view, 1120, 820)
	chooseOption(t, tt, "活动类型", "正在听")
	if a.edit.Type != "Listening" || !a.edit.Dirty {
		t.Fatalf("localized type was stored in the editor: %+v", a.edit)
	}
	if err := tt.Click("保存更改"); err != nil {
		t.Fatal(err)
	}
	patch := requested["patch"].(map[string]any)
	if requested["scope"] != "global" || patch["presence"].(map[string]any)["type"] != 2 {
		t.Fatalf("localized type changed the protocol: %#v", requested)
	}
	saveTestImage(t, tt, "native-appearance-zh.png")
	if err := tt.Click("摘要"); err != nil {
		t.Fatal(err)
	}
	chooseOption(t, tt, "设置范围", "Codex")
	chooseOption(t, tt, "模型来源", "自定义兼容服务")
	if a.edit.Scope != "codex" || a.edit.Source != "Custom compatible service" || !tt.HasText("服务地址") {
		t.Fatalf("localized source or scope changed the editor: %+v", a.edit)
	}
	tt.Key(ui.Cmd, ui.KeyS)
	patch = requested["patch"].(map[string]any)
	if requested["scope"] != "codex" || patch["service"] != "openai-compatible" {
		t.Fatalf("localized source changed the protocol: %#v", requested)
	}
}

func TestSetupRequestsUseInterfaceLanguage(t *testing.T) {
	for _, language := range []string{languageEnglish, languageChinese} {
		t.Run(language, func(t *testing.T) {
			a := fixtureApp()
			a.prefs.Language = language
			a.page = "Agents"
			var requested map[string]any
			a.dispatch = func(request map[string]any, _ string) { requested = request }
			tt := ui.NewTester(a.view, 1120, 820)
			for _, agent := range agentIDs {
				if err := tt.Click(a.t("Set up %s", agentLabels[agent])); err != nil {
					t.Fatal(err)
				}
				if requested["action"] != "integration" || requested["agent"] != agent || requested["language"] != language {
					t.Fatalf("setup request did not include the selected language: %#v", requested)
				}
			}
		})
	}
}

func TestChineseSetupDialogCopiesChinesePrompt(t *testing.T) {
	a := fixtureApp()
	a.prefs.Language = languageChinese
	a.page = "Agents"
	a.setup = &integration{Agent: "codex", Content: `{"hooks":{}}`, Prompt: "请在这台电脑上为 Codex 配置 Agent Discord Presence，保留现有设置和钩子。"}
	a.setupOpen = true
	tt := ui.NewTester(a.view, 1120, 820)
	if err := tt.Click("复制提示词"); err != nil {
		t.Fatal(err)
	}
	if tt.Clipboard() != a.setup.Prompt || !tt.HasText("已复制到剪贴板。") {
		t.Fatal("localized dialog did not copy the Chinese setup prompt or lost copy feedback")
	}
	if err := tt.Click("手动配置"); err != nil {
		t.Fatal(err)
	}
	if err := tt.Click("复制配置"); err != nil {
		t.Fatal(err)
	}
	if tt.Clipboard() != a.setup.Content {
		t.Fatal("localized dialog changed integration configuration")
	}
	saveTestImage(t, tt, "native-setup-zh.png")
}

func TestPreferencesLanguageFallback(t *testing.T) {
	for _, input := range []string{
		`{"theme":"Dark","previewTheme":"Light"}`,
		`{"language":"fr","theme":"Dark","previewTheme":"Light"}`,
		`{"language":null,"theme":"Dark","previewTheme":"Light"}`,
	} {
		t.Run(input, func(t *testing.T) {
			a := newNativeApp(&Desktop{})
			a.prefsPath = filepath.Join(t.TempDir(), "appearance.json")
			if err := os.WriteFile(a.prefsPath, []byte(input), 0600); err != nil {
				t.Fatal(err)
			}
			a.loadPreferences()
			if a.prefs.Language != languageEnglish || a.prefs.Theme != "Dark" || a.prefs.PreviewTheme != "Light" {
				t.Fatalf("legacy or unsupported language lost appearance preferences: %+v", a.prefs)
			}
		})
	}
	a := newNativeApp(&Desktop{})
	a.prefs.Language = languageChinese
	if got := a.t("Unknown message: 100%"); got != "Unknown message: 100%" {
		t.Fatalf("unknown message was changed: %q", got)
	}
	if got := a.t("%d characters", 72); got != "72 个字符" || strings.Contains(got, "%!") {
		t.Fatalf("localized formatting failed: %q", got)
	}
}
