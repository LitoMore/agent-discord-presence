package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

var agentIDs = []string{"codex", "claude-code", "opencode", "pi", "deepseek-harness"}
var agentLabels = map[string]string{"codex": "Codex", "claude-code": "Claude Code", "opencode": "OpenCode", "pi": "Pi", "deepseek-harness": "DeepSeek Harness"}
var phaseLabels = map[string]string{"working": "Working", "waiting": "Waiting for input", "idle": "Ready for a prompt", "error": "Needs attention", "closed": "Closed"}
var stateLabels = map[string]string{"working": "Working", "waiting": "Waiting for input", "idle": "Idle", "error": "Needs attention", "closed": "Closed"}

type session struct {
	Key, Agent, State, Model, Provider, Label string
	StartedAt, UpdatedAt, LastSeen            int64
	Summary                                   *struct{ Topic, Subtitle string }
}

func (s session) agent() string {
	if s.Agent != "" {
		return s.Agent
	}
	return strings.SplitN(s.Key, ":", 2)[0]
}
func (s session) title() string {
	if s.Summary != nil {
		return s.Summary.Topic
	}
	return "Coding with " + s.label()
}
func (s session) label() string {
	if s.Label != "" {
		return s.Label
	}
	if label := agentLabels[s.agent()]; label != "" {
		return label
	}
	return s.agent()
}

type activity struct {
	Type       int                         `json:"type"`
	Name       string                      `json:"name"`
	Details    string                      `json:"details"`
	State      string                      `json:"state"`
	Timestamps *struct{ Start, End int64 } `json:"timestamps"`
	Assets     *struct {
		LargeImage string `json:"large_image"`
		LargeText  string `json:"large_text"`
		SmallImage string `json:"small_image"`
		SmallText  string `json:"small_text"`
	} `json:"assets"`
	Buttons []struct{ Label, URL string } `json:"buttons"`
	Party   *struct{ Size []int }         `json:"party"`
}
type profile struct{ ID, Username, GlobalName, Avatar string }
type status struct {
	Discord              string
	ActivityAcknowledged *bool
	Pinned               *string
	PID                  int
	Activity             *activity
	Selected             *string
	SettingsError        *string
	Sessions             []session
	Profile              *profile
}
type settings struct {
	Enabled                                      bool
	SummaryTriggers                              []string
	CustomPrompt                                 string
	MaxLength                                    int
	Model, Service, Provider, BaseURL, APIKeyEnv string
	Presence                                     map[string]any
}
type snapshot struct {
	Agents, Plugins                  []agentDescriptor
	PluginError                      *string
	Status                           *status
	ServiceError, ConfigurationError *string
	Configuration                    map[string]json.RawMessage
	Effective                        settings
	AgentSettings                    map[string]settings
	ConfigPath, SocketPath, Version  string
}
type integration struct{ Agent, Path, Content, Instructions, Prompt, SummaryCommand string }
type integrationScenario struct {
	ID, Label, Description, SummaryTrigger string
	Events                                 []string
}
type integrationEvent struct {
	ID, Capability, Description, Source string
	Required                            bool
	Requires                            []string
}
type setupPlan struct {
	Agent, Path, Kind, Status, Revision, Note                       string
	SelectedEvents, InstalledEvents, Added, Removed, Kept, Warnings []string
	Catalog                                                         []integrationEvent
	Scenarios                                                       []integrationScenario
	SummaryTriggers                                                 []string
}
type setupResult struct {
	Plan    setupPlan
	Changed bool
	Backup  string
}
type uninstallPlan struct {
	Agent, Path, Status, Kind, Revision, Note string
	Count                                     int
	Details                                   []string
	ManualReview                              bool
	Partial                                   bool
	NoteAgent                                 bool
	InstalledEvents, SelectedEvents, Warnings []string
	Catalog                                   []integrationEvent
}
type uninstallResult struct {
	Plan    uninstallPlan
	Removed bool
	Backup  string
}
type desktopResponse struct {
	OK              bool
	Error           string
	Snapshot        *snapshot
	Integration     *integration
	SetupPlan       *setupPlan
	SetupResult     *setupResult
	UninstallPlan   *uninstallPlan
	UninstallResult *uninstallResult
}
type recentEvent struct {
	Text         string
	At           time.Time
	Agent, State string
}
type preferences struct {
	Language     string `json:"language"`
	Theme        string `json:"theme"`
	PreviewTheme string `json:"previewTheme"`
}
type presenceButton struct{ Label, URL string }
type editor struct {
	Scope, Page                                  string
	Base                                         settings
	Name, Details, Subtitle, Type, Image, Source string
	Timer, ShowImage, Dirty                      bool
	Enabled                                      bool
	Model, BaseURL, KeyEnv, Prompt               string
	Length                                       float64
	Buttons                                      []presenceButton
	ButtonsDirty                                 bool
}

type nativeApp struct {
	pluginConfirm                       string
	pluginIcons                         map[string]ui.ImageSource
	pluginIconData                      map[string]string
	bridge                              *Desktop
	data                                *snapshot
	page, scope                         string
	edit                                *editor
	prefs                               preferences
	prefsPath                           string
	err, notice                         string
	busy, loading                       bool
	events                              []recentEvent
	setup                               *integration
	setupOpen                           bool
	setupMode                           int
	setupCopiedUntil                    time.Time
	setupCopyError                      string
	setupPlan                           *setupPlan
	setupResult                         *setupResult
	setupPath, setupProfile, setupError string
	setupSelected                       map[string]bool
	setupTriggers                       map[string]bool
	setupAdvanced                       bool
	setupDirty                          bool
	removal                             *uninstallPlan
	removalResult                       *uninstallResult
	removalOpen                         bool
	removalPath                         string
	removalError                        string
	removalSelected                     map[string]bool
	removalAll, removalDirty            bool
	images                              map[string]*ui.Bitmap
	imagePending                        map[string]bool
	live                                bool
	closed                              atomic.Bool
	cancel                              context.CancelFunc
	updateTrayMenu                      func()
	// Tests substitute a command runner without starting a GUI or a daemon.
	dispatch func(map[string]any, string)
}

func newNativeApp(d *Desktop) *nativeApp {
	a := &nativeApp{bridge: d, page: "Overview", scope: "Global · All agents", prefs: preferences{Language: languageEnglish, Theme: "System", PreviewTheme: "Dark"}, images: map[string]*ui.Bitmap{}, imagePending: map[string]bool{}}
	a.dispatch = a.execute
	return a
}
func (a *nativeApp) invalidate() {
	if a.closed.Load() {
		return
	}
	if a.bridge.main != nil {
		a.bridge.main.Invalidate()
	}
	if a.bridge.panel != nil {
		a.bridge.panel.Invalidate()
	}
}
func (a *nativeApp) start() {
	a.live = true
	if dir, err := mygo.App.Path(mygo.PathUserData); err == nil {
		a.prefsPath = filepath.Join(dir, "appearance.json")
	}
	a.loadPreferences()
	mygo.Theme.SetSource(mygo.ThemeSource(strings.ToLower(a.prefs.Theme)))
	ctx, cancel := context.WithCancel(context.Background())
	a.cancel = cancel
	go func() {
		a.fetch(ctx)
		timer := time.NewTicker(2 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				a.fetch(ctx)
			}
		}
	}()
}
func (a *nativeApp) fetch(ctx context.Context) {
	result, err := a.call(ctx, map[string]any{"action": "snapshot"})
	if a.closed.Load() {
		return
	}
	mygo.RunOnMain(func() {
		if a.closed.Load() {
			return
		}
		if err != nil {
			a.err = err.Error()
		} else if !a.busy {
			a.accept(result)
			a.err = ""
		}
		a.invalidate()
	})
}
func (a *nativeApp) call(ctx context.Context, request map[string]any) (*desktopResponse, error) {
	bytes, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	line, err := a.bridge.Call(ctx, string(bytes))
	if err != nil {
		return nil, err
	}
	var response desktopResponse
	if err = json.Unmarshal([]byte(line), &response); err != nil {
		return nil, err
	}
	if !response.OK {
		return nil, fmt.Errorf("%s", response.Error)
	}
	return &response, nil
}
func (a *nativeApp) execute(request map[string]any, notice string) {
	if a.busy {
		return
	}
	a.busy = true
	a.err = ""
	a.notice = ""
	removing := request["action"] == "uninstall" || request["action"] == "uninstall-preview"
	configuring := request["action"] == "setup" || request["action"] == "integration"
	if configuring {
		a.setupError = ""
	}
	if removing {
		a.removalError = ""
	}
	go func() {
		result, err := a.call(context.Background(), request)
		if a.closed.Load() {
			return
		}
		a.bridge.main.Update(func() {
			if a.closed.Load() {
				return
			}
			a.busy = false
			if err != nil {
				a.err = err.Error()
				if removing {
					a.removalError = err.Error()
				}
				if configuring {
					a.setupError = err.Error()
				}
			} else {
				a.accept(result)
				a.notice = notice
				if request["action"] == "save" || request["action"] == "reset" {
					a.edit = nil
				}
			}
			if a.bridge.panel != nil {
				a.bridge.panel.Invalidate()
			}
		})
	}()
}
func (a *nativeApp) accept(response *desktopResponse) {
	if response.UninstallPlan != nil {
		opening := a.removal == nil || !a.removalOpen || a.removal.Agent != response.UninstallPlan.Agent
		a.removalError = ""
		a.removal = response.UninstallPlan
		a.removalPath = response.UninstallPlan.Path
		a.removalResult = nil
		a.removalOpen = true
		a.removalAll = !response.UninstallPlan.Partial
		a.removalSelected = selectionMap(response.UninstallPlan.SelectedEvents)
		a.removalDirty = false
		if opening && !response.UninstallPlan.Partial && len(response.UninstallPlan.InstalledEvents) > 0 && len(response.UninstallPlan.Catalog) > 0 {
			a.removalAll = false
			a.removalSelected = map[string]bool{}
			a.removalDirty = true
		}
	}
	if response.UninstallResult != nil {
		a.removalError = ""
		a.removalResult = response.UninstallResult
		a.removal = &response.UninstallResult.Plan
		a.removalOpen = true
	}
	setupOpening := !a.setupOpen
	if response.Integration != nil {
		if response.SetupPlan == nil {
			a.setupPlan = nil
			a.setupResult = nil
			a.setupDirty = false
		}
		a.setup = response.Integration
		a.setupOpen = true
		a.setupMode = 0
		a.setupCopiedUntil = time.Time{}
		a.setupCopyError = ""
	}
	if response.SetupPlan != nil {
		opening := a.setupPlan == nil || setupOpening || a.setupPlan.Agent != response.SetupPlan.Agent
		a.setupPlan = response.SetupPlan
		a.setupResult = nil
		a.setupPath = response.SetupPlan.Path
		a.setupSelected = selectionMap(response.SetupPlan.SelectedEvents)
		a.setupTriggers = selectionMap(response.SetupPlan.SummaryTriggers)
		if opening {
			a.setupAdvanced = false
		}
		a.setupProfile = "Custom"
		all, light := true, true
		for _, event := range response.SetupPlan.Catalog {
			all = all && a.setupSelected[event.ID]
			expected := event.Required || (event.Capability != "waiting" && event.Capability != "tools" && event.Capability != "summary")
			light = light && a.setupSelected[event.ID] == expected
		}
		if all {
			a.setupProfile = "Recommended"
		} else if light {
			a.setupProfile = "Lightweight"
		}
		a.setupDirty = false
		a.setupError = ""
		a.setupMode = 2
	}
	if response.SetupResult != nil {
		a.setupResult = response.SetupResult
		a.setupPlan = &response.SetupResult.Plan
		a.setupError = ""
	}
	if response.Snapshot == nil {
		return
	}
	next := response.Snapshot
	var before *status
	if a.data != nil {
		before = a.data.Status
	}
	var changes []recentEvent
	if before == nil && next.Status != nil {
		changes = append(changes, recentEvent{Text: "Connected to the local service"})
	}
	if before != nil && next.Status == nil {
		changes = append(changes, recentEvent{Text: "Local service stopped"})
	}
	if next.Status != nil {
		if next.Status.Discord == "connected" && (before == nil || before.Discord != "connected") {
			changes = append(changes, recentEvent{Text: "Connected to Discord"})
		}
		for _, s := range next.Status.Sessions {
			found := false
			if before != nil {
				for _, old := range before.Sessions {
					if old.Key == s.Key && old.State == s.State {
						found = true
						break
					}
				}
			}
			if !found {
				changes = append(changes, recentEvent{Agent: s.agent(), State: s.State})
			}
		}
	}
	for _, event := range changes {
		event.At = time.Now()
		a.events = append([]recentEvent{event}, a.events...)
	}
	if len(a.events) > 6 {
		a.events = a.events[:6]
	}
	a.data = next
	a.refreshPluginIcons()
	if a.scope != "Global · All agents" && a.scopeID(a.scope) == "global" {
		a.scope = "Global · All agents"
		a.edit = nil
	}
	if next.Status != nil {
		if p := next.Status.Profile; p != nil && p.Avatar != "" {
			a.loadImage("https://cdn.discordapp.com/avatars/" + p.ID + "/" + p.Avatar + ".png?size=128")
		}
		if act := next.Status.Activity; act != nil && act.Assets != nil {
			a.loadImage(act.Assets.LargeImage)
			a.loadImage(act.Assets.SmallImage)
		}
	}
}
func (a *nativeApp) loadPreferences() {
	if data, err := os.ReadFile(a.prefsPath); err == nil {
		prefs := a.prefs
		if json.Unmarshal(data, &prefs) == nil {
			a.prefs = prefs
		}
	}
	if a.prefs.Language != languageChinese {
		a.prefs.Language = languageEnglish
	}
	if a.prefs.Theme != "System" && a.prefs.Theme != "Light" && a.prefs.Theme != "Dark" {
		a.prefs.Theme = "System"
	}
	if a.prefs.PreviewTheme != "Light" {
		a.prefs.PreviewTheme = "Dark"
	}
}
func (a *nativeApp) savePreferences() {
	if a.live {
		mygo.Theme.SetSource(mygo.ThemeSource(strings.ToLower(a.prefs.Theme)))
		if a.updateTrayMenu != nil {
			a.updateTrayMenu()
		}
		a.invalidate()
	}
	if a.prefsPath == "" {
		return
	}
	data, _ := json.MarshalIndent(a.prefs, "", "  ")
	if err := os.MkdirAll(filepath.Dir(a.prefsPath), 0700); err != nil {
		a.err = err.Error()
		return
	}
	temp := a.prefsPath + ".tmp"
	if err := os.WriteFile(temp, data, 0600); err != nil {
		a.err = err.Error()
		return
	}
	if err := os.Rename(temp, a.prefsPath); err != nil {
		a.err = err.Error()
	}
}
func (a *nativeApp) loadImage(raw string) {
	if !a.live || !strings.HasPrefix(raw, "https://") || a.imagePending[raw] || a.images[raw] != nil || len(a.imagePending) >= 64 {
		return
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil {
		return
	}
	a.imagePending[raw] = true
	go func() {
		client := http.Client{Timeout: 5 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > 4 || req.URL.Scheme != "https" {
				return fmt.Errorf("invalid image redirect")
			}
			return nil
		}}
		response, err := client.Get(raw)
		var bitmap *ui.Bitmap
		if err == nil {
			defer response.Body.Close()
			if response.StatusCode == http.StatusOK {
				if data, err := io.ReadAll(io.LimitReader(response.Body, 2*1024*1024+1)); err == nil && len(data) <= 2*1024*1024 {
					bitmap, _ = ui.DecodeBitmap(data)
				}
			}
		}
		if a.closed.Load() {
			return
		}
		mygo.RunOnMain(func() {
			if !a.closed.Load() {
				a.images[raw] = bitmap
				a.invalidate()
			}
		})
	}()
}
func (a *nativeApp) running() bool { return a.data != nil && a.data.Status != nil }
func (a *nativeApp) connection() string {
	if !a.running() {
		return a.t("Service stopped")
	}
	switch a.data.Status.Discord {
	case "connected":
		return a.t("Discord connected")
	case "dry-run":
		return a.t("Dry run")
	default:
		return a.t("Waiting for Discord")
	}
}
func (a *nativeApp) sessions() []session {
	if !a.running() {
		return nil
	}
	list := append([]session(nil), a.data.Status.Sessions...)
	priority := map[string]int{"working": 3, "waiting": 3, "error": 2, "idle": 1}
	sort.SliceStable(list, func(i, j int) bool {
		if priority[list[i].State] != priority[list[j].State] {
			return priority[list[i].State] > priority[list[j].State]
		}
		if list[i].UpdatedAt != list[j].UpdatedAt {
			return list[i].UpdatedAt > list[j].UpdatedAt
		}
		return list[i].Key < list[j].Key
	})
	return list
}
func (a *nativeApp) selected() *session {
	if !a.running() || a.data.Status.Selected == nil {
		return nil
	}
	for _, s := range a.data.Status.Sessions {
		if s.Key == *a.data.Status.Selected {
			return &s
		}
	}
	return nil
}
func (a *nativeApp) pinned() bool { return a.running() && a.data.Status.Pinned != nil }
func (a *nativeApp) power() {
	action := "start"
	notice := "Local service started."
	if a.running() {
		action = "stop"
		notice = "Service stopped and Discord activity cleared."
	}
	a.dispatch(map[string]any{"action": action}, notice)
}
func (a *nativeApp) scopeID(scope string) string {
	for _, agent := range a.agents() {
		if scope == agent.Name {
			return agent.ID
		}
	}
	return "global"
}
func cloneMap(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	b, _ := json.Marshal(value)
	var copy map[string]any
	_ = json.Unmarshal(b, &copy)
	return copy
}
func textValue(value any, fallback string) string {
	if value == nil {
		return fallback
	}
	if text, ok := value.(string); ok {
		return text
	}
	return fallback
}
func (a *nativeApp) editor() *editor {
	id := a.scopeID(a.scope)
	if a.edit != nil && a.edit.Scope == id && a.edit.Page == a.page {
		return a.edit
	}
	base := a.data.Effective
	if id != "global" {
		base = a.data.AgentSettings[id]
	}
	p := cloneMap(base.Presence)
	assets, _ := p["assets"].(map[string]any)
	details := "{phase}"
	if value, ok := p["details"]; ok {
		details = textValue(value, "")
	}
	subtitle := "{subtitle}"
	if value, ok := p["state"]; ok {
		subtitle = textValue(value, "")
	}
	showImage := true
	if value, ok := p["assets"]; ok && value == nil {
		showImage = false
	}
	timer := true
	if value, ok := p["timestamps"]; ok && value == nil {
		timer = false
	}
	kind := "Playing"
	if value, ok := p["type"].(float64); ok {
		kind = map[int]string{0: "Playing", 2: "Listening", 3: "Watching", 5: "Competing"}[int(value)]
	}
	source := "Follow agent session"
	if base.Service == "openai-compatible" {
		source = "Custom compatible service"
	}
	a.edit = &editor{Scope: id, Page: a.page, Base: base, Name: textValue(p["name"], "{topic}"), Details: details, Subtitle: subtitle, Type: kind, Image: textValue(assets["large_image"], ""), Timer: timer, ShowImage: showImage, Enabled: base.Enabled, Source: source, Model: base.Model, BaseURL: base.BaseURL, KeyEnv: base.APIKeyEnv, Prompt: base.CustomPrompt, Length: float64(base.MaxLength)}
	if buttons, ok := p["buttons"].([]any); ok {
		for _, value := range buttons {
			if button, ok := value.(map[string]any); ok {
				a.edit.Buttons = append(a.edit.Buttons, presenceButton{Label: textValue(button["label"], ""), URL: textValue(button["url"], "")})
			}
		}
	}
	return a.edit
}
func (e *editor) presence() map[string]any {
	p := cloneMap(e.Base.Presence)
	p["name"] = e.Name
	p["type"] = map[string]int{"Playing": 0, "Listening": 2, "Watching": 3, "Competing": 5}[e.Type]
	p["details"] = nil
	if e.Details != "" {
		p["details"] = e.Details
	}
	p["state"] = nil
	if e.Subtitle != "" {
		p["state"] = e.Subtitle
	}
	if !e.Timer {
		p["timestamps"] = nil
	} else if value, exists := p["timestamps"]; exists && value == nil {
		p["timestamps"] = map[string]any{"start": "session"}
	}
	if !e.ShowImage {
		p["assets"] = nil
	} else if e.Image != "" {
		assets, _ := p["assets"].(map[string]any)
		assets = cloneMap(assets)
		assets["large_image"] = e.Image
		p["assets"] = assets
	} else {
		assets, _ := p["assets"].(map[string]any)
		assets = cloneMap(assets)
		delete(assets, "large_image")
		p["assets"] = assets
	}
	if e.ButtonsDirty {
		buttons := make([]any, 0, len(e.Buttons))
		for _, button := range e.Buttons {
			buttons = append(buttons, map[string]any{"label": button.Label, "url": button.URL})
		}
		p["buttons"] = buttons
	}
	return p
}
func (e *editor) buttonsError() string {
	for _, button := range e.Buttons {
		if strings.TrimSpace(button.Label) == "" || len([]rune(button.Label)) > 32 || strings.ContainsFunc(button.Label, func(r rune) bool { return r < 32 || r == 127 }) {
			return "Button text must contain 1–32 characters without control characters."
		}
		u, err := url.Parse(button.URL)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || len([]rune(button.URL)) > 2048 || strings.ContainsFunc(button.URL, func(r rune) bool { return r <= 32 || r == 127 }) {
			return "Button links must use a valid HTTPS URL without credentials."
		}
	}
	return ""
}
func (a *nativeApp) saveEditor() {
	e := a.edit
	if e == nil || !e.Dirty || a.busy {
		return
	}
	var patch map[string]any
	if a.page == "Appearance" {
		if strings.TrimSpace(e.Name) == "" {
			a.err = "Activity name cannot be empty."
			return
		}
		if message := e.buttonsError(); message != "" {
			a.err = message
			return
		}
		patch = map[string]any{"presence": e.presence()}
	} else {
		service := "session"
		if e.Source == "Custom compatible service" {
			service = "openai-compatible"
		}
		patch = map[string]any{"enabled": e.Enabled, "customPrompt": e.Prompt, "maxLength": int(e.Length), "model": e.Model, "service": service, "provider": e.Base.Provider, "baseUrl": e.BaseURL, "apiKeyEnv": e.KeyEnv}
	}
	request := map[string]any{"action": "save", "scope": e.Scope, "patch": patch}
	if a.page == "Appearance" && e.ShowImage && e.Image == "" {
		request["unset"] = []string{"presence.assets.large_image"}
	}
	a.dispatch(request, "Settings saved. The service will apply them automatically.")
}
func (a *nativeApp) resetEditor() {
	keys := []string{"presence"}
	if a.page == "Summaries" {
		keys = []string{"enabled", "summaryTriggers", "customPrompt", "maxLength", "model", "service", "provider", "baseUrl", "apiKeyEnv"}
	}
	a.dispatch(map[string]any{"action": "reset", "scope": a.scopeID(a.scope), "keys": keys}, "Settings reset.")
}
func elapsed(start int64) string {
	seconds := max(int64(0), (time.Now().UnixMilli()-start)/1000)
	if seconds >= 3600 {
		return fmt.Sprintf("%d:%02d:%02d", seconds/3600, seconds/60%60, seconds%60)
	}
	return fmt.Sprintf("%02d:%02d", seconds/60, seconds%60)
}

func renderPreview(s *session, p map[string]any) *activity {
	if s == nil {
		return nil
	}
	subtitle := s.label() + " session"
	if s.Summary != nil && s.Summary.Subtitle != "" {
		subtitle = s.Summary.Subtitle
	}
	values := map[string]string{"topic": s.title(), "subtitle": subtitle, "agent": s.label(), "phase": phaseLabels[s.State], "state": s.State}
	render := func(text string) string {
		for key, value := range values {
			text = strings.ReplaceAll(text, "{"+key+"}", value)
		}
		runes := []rune(text)
		if len(runes) > 128 {
			runes = runes[:128]
		}
		return string(runes)
	}
	copy := cloneMap(p)
	copy["name"] = render(textValue(p["name"], "{topic}"))
	for key, fallback := range map[string]string{"details": "{phase}", "state": "{subtitle}"} {
		if value, ok := p[key]; ok && value == nil {
			delete(copy, key)
		} else {
			copy[key] = render(textValue(value, fallback))
		}
	}
	if timestamps, ok := p["timestamps"]; !ok {
		copy["timestamps"] = map[string]any{"start": s.StartedAt / 1000}
	} else if times, ok := timestamps.(map[string]any); ok && times["start"] == "session" {
		times = cloneMap(times)
		times["start"] = s.StartedAt / 1000
		copy["timestamps"] = times
	}
	if buttons, ok := copy["buttons"].([]any); ok {
		for _, value := range buttons {
			if button, ok := value.(map[string]any); ok {
				label := []rune(render(textValue(button["label"], "")))
				if len(label) > 32 {
					label = label[:32]
				}
				button["label"] = string(label)
			}
		}
	}
	data, _ := json.Marshal(copy)
	var act activity
	if json.Unmarshal(data, &act) != nil {
		return nil
	}
	return &act
}
