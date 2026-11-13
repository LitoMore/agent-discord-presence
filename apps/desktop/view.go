package main

import (
	"fmt"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

func vector(paths string) *ui.SVG {
	return ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">` + paths + `</svg>`))
}

var icons = map[string]*ui.SVG{
	"radio":       vector(`<circle cx="12" cy="12" r="2"/><path d="M8 7a7 7 0 0 0 0 10m8-10a7 7 0 0 1 0 10M5 4a11 11 0 0 0 0 16M19 4a11 11 0 0 1 0 16"/>`),
	"Overview":    vector(`<path d="M2 12h5l3-8 4 16 3-8h5"/>`),
	"Agents":      vector(`<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>`),
	"Appearance":  vector(`<path d="M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 1-4c-2-1-1-3 1-3h2a3 3 0 0 0 3-3 9 9 0 0 0-9-8z"/><circle cx="7" cy="11" r=".7"/><circle cx="10" cy="7" r=".7"/><circle cx="15" cy="8" r=".7"/>`),
	"Summaries":   vector(`<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4m-2-2h4"/>`),
	"Preferences": vector(`<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>`),
	"pin":         vector(`<path d="m15 3 6 6-4 1-3 5-2 1-4-4 1-2 5-3zM9 15l-6 6"/>`),
	"game":        vector(`<path d="M7 7h10c3 0 4 12 2 12l-4-4H9l-4 4C3 19 4 7 7 7zM7 10v4m-2-2h4M16 11h.1M18 13h.1"/>`),
}
var navPages = []string{"Overview", "Agents", "Appearance", "Summaries"}
var descriptions = map[string]string{"Overview": "Your agents at work, at a glance.", "Agents": "Connect once. Keep your work in sync.", "Appearance": "Make every line feel like you.", "Summaries": "Turn your work into a clear, concise activity.", "Preferences": "Manage appearance and your local service."}

func muted(c *ui.Context, text string) ui.Element {
	return ui.Text(c, text).FontSize(11).TextColor(c.Theme().TextMuted)
}
func heading(c *ui.Context, title, extra string) {
	ui.Row(c).Gap(8).Margin(0, 0, 14, 0).Children(func() {
		ui.Text(c, title).FontSize(13).FontWeight(600).Grow(1)
		if extra != "" {
			muted(c, extra)
		}
	})
}
func dot(c *ui.Context, color ui.Color) { ui.Box(c).Size(6, 6).Radius(3).Background(color).Shrink(0) }
func (a *nativeApp) theme(c *ui.Context) {
	dark := c.Theme().Dark
	if a.live {
		dark = mygo.Theme.IsDark()
	}
	if a.prefs.Theme == "Light" {
		dark = false
	}
	if a.prefs.Theme == "Dark" {
		dark = true
	}
	t := ui.LightTheme()
	if dark {
		t = ui.DarkTheme()
	}
	t = t.WithPreferences(c.Preferences()).WithAccent(ui.Hex("#6261d7"))
	t.FontSize = 13
	t.Radius = 6
	if dark {
		t.Background = ui.Hex("#191b20")
		t.Surface = ui.Hex("#24272e")
		t.Border = ui.Hex("#33363d")
	} else {
		t.Background = ui.Hex("#ffffff")
		t.Surface = ui.Hex("#f7f7f6")
		t.Border = ui.Hex("#e7e7e7")
	}
	c.SetTheme(t)
}
func (a *nativeApp) view(c *ui.Context) {
	a.theme(c)
	t := c.Theme()
	if c.Vibrancy() {
		c.Root().Background(ui.Transparent)
	}
	c.After(time.Second)
	ui.Row(c).Fill().AlignItems(ui.Stretch).Children(func() {
		a.sidebar(c)
		ui.Column(c).Grow(1).MinWidth(0).Background(t.Background).Children(func() {
			ui.Box(c).Height(44).Shrink(0).DragWindow()
			ui.Scroll(c).Grow(1).Children(func() {
				ui.Column(c).Padding(12, 28, 30, 28).Gap(0).Children(func() {
					ui.Row(c).AlignItems(ui.Center).Gap(16).Margin(0, 0, 30, 0).Children(func() {
						ui.Column(c).Grow(1).Gap(7).Children(func() {
							ui.Text(c, "YOUR WORK, VISIBLE.").FontSize(9).LetterSpacing(1.8).TextColor(t.TextMuted)
							ui.Text(c, a.page).FontSize(25).FontWeight(600)
							ui.Text(c, descriptions[a.page]).FontSize(12).TextColor(t.TextMuted)
						})
						label := "Start service"
						if a.running() {
							label = "Stop service"
						}
						ui.Button(c.Key("power"), label).Disabled(a.busy || a.data == nil).OnClick(a.power)
					})
					if a.err != "" {
						ui.Text(c, a.err).FontSize(12).TextColor(t.Danger).Padding(12).Background(t.Danger.Alpha(.06)).Radius(6).Margin(0, 0, 16, 0).Role(ui.RoleAlert)
					}
					if a.data != nil && a.data.ConfigurationError != nil {
						ui.Text(c, "Configuration file error: "+*a.data.ConfigurationError).TextColor(t.Danger).FontSize(12).Margin(0, 0, 16, 0)
					}
					if a.data != nil && a.data.ServiceError != nil {
						ui.Text(c, *a.data.ServiceError).TextColor(t.Danger).FontSize(12).Margin(0, 0, 16, 0)
					}
					if a.running() && a.data.Status.SettingsError != nil {
						ui.Text(c, "The service is using its last valid configuration.").TextColor(t.Danger).FontSize(12).Margin(0, 0, 16, 0)
					}
					width, _ := c.Size()
					if width >= 980 {
						ui.Row(c).AlignItems(ui.Start).Gap(26).Children(func() {
							ui.Column(c).Grow(1).MinWidth(0).Children(func() { a.pageView(c) })
							ui.Column(c).Width(306).Shrink(0).Padding(0, 0, 0, 24).BorderWidth(0, 0, 0, 1).BorderColor(t.Border).Children(func() { a.profileView(c) })
						})
					} else {
						ui.Column(c).Gap(28).Children(func() { a.pageView(c); ui.Column(c).MaxWidth(340).FillWidth().Children(func() { a.profileView(c) }) })
					}
				})
			})
			ui.Row(c).Padding(7, 15).Gap(7).BorderWidth(1, 0, 0, 0).BorderColor(t.Border).Background(t.Surface).Children(func() {
				color := t.TextMuted
				if a.running() && a.data.Status.Discord == "connected" {
					color = t.Success
				}
				dot(c, color)
				muted(c, a.connection())
				ui.Spacer(c)
				muted(c, "One local service · All your agents")
			})
		})
	})
	a.setupDialog(c)
	if c.Shortcut(ui.Cmd, ui.KeyS) {
		a.saveEditor()
	}
}
func (a *nativeApp) sidebar(c *ui.Context) {
	t := c.Theme()
	background := ui.Hex("#f5f5f4")
	if t.Dark {
		background = ui.Hex("#202227")
	}
	if c.Vibrancy() {
		background = ui.Transparent
	}
	ui.Column(c).Width(184).Shrink(0).Background(background).BorderWidth(0, 1, 0, 0).BorderColor(t.Border).Padding(0, 12, 15, 12).Children(func() {
		ui.Box(c).Height(44).Shrink(0).DragWindow()
		ui.Row(c).Gap(10).Padding(18, 7, 30, 7).Children(func() {
			ui.Box(c).Size(34, 34).Radius(10).Background(t.Accent).Center().Children(func() { ui.Icon(c, icons["radio"]).Size(23, 23).TextColor(t.AccentText) })
			ui.Column(c).Gap(2).Children(func() {
				ui.Text(c, "Presence").FontSize(19).FontWeight(600)
				ui.Text(c, "STAY IN SYNC").FontSize(9).LetterSpacing(1.2).TextColor(t.TextMuted)
			})
		})
		for _, page := range navPages {
			button := ui.ButtonBase(c.Key(page)).Label(page).Padding(10, 12).Gap(10).Radius(7).Margin(0, 0, 5, 0)
			if a.page == page {
				button.Background(t.Accent.Alpha(.10)).TextColor(t.Accent)
			} else if button.Hovered() {
				button.Background(t.SurfaceHover)
			} else {
				button.TextColor(t.TextMuted)
			}
			button.Children(func() {
				ui.Icon(c, icons[page]).Size(17, 17)
				ui.Text(c, page).FontSize(12).Grow(1)
				if page == "Overview" {
					ui.Text(c, fmt.Sprint(len(a.sessions()))).FontSize(10)
				}
			})
			button.OnClick(func() { a.page = page; a.notice = ""; a.edit = nil })
		}
		ui.Spacer(c)
		ui.Row(c).Gap(7).Padding(12, 8).Children(func() {
			color := t.TextMuted
			label := "Service stopped"
			if a.running() {
				color = t.Success
				label = "Local service running"
			}
			dot(c, color)
			muted(c, label)
		})
		ui.ButtonBase(c.Key("preferences")).Label("Preferences").Padding(9, 8).Gap(7).Radius(6).Children(func() {
			ui.Icon(c, icons["Preferences"]).Size(16, 16)
			ui.Text(c, "Preferences").FontSize(11).Grow(1)
			muted(c, "v0.0.3")
		}).OnClick(func() { a.page = "Preferences"; a.edit = nil })
	})
}
func (a *nativeApp) pageView(c *ui.Context) {
	if a.data == nil {
		muted(c, "Connecting to the local service…")
		return
	}
	switch a.page {
	case "Overview":
		a.overview(c)
	case "Agents":
		a.agentsView(c)
	case "Appearance", "Summaries":
		a.settingsView(c)
	case "Preferences":
		a.preferencesView(c)
	}
	if a.notice != "" {
		ui.Text(c, a.notice).FontSize(11).TextColor(c.Theme().Success).Margin(18, 0, 0, 0).Role(ui.RoleStatus)
	}
}
func (a *nativeApp) overview(c *ui.Context) {
	t := c.Theme()
	sessions := a.sessions()
	heading(c, fmt.Sprintf("Active sessions  %d", len(sessions)), "Current sessions only")
	if len(sessions) > 0 {
		ui.Row(c).Padding(13).Gap(10).Background(t.Surface).Border(1, t.Border).Radius(8).Margin(0, 0, 14, 0).Children(func() {
			ui.Icon(c, icons["radio"]).Size(16, 16).TextColor(t.TextMuted)
			ui.Column(c).Grow(1).Gap(3).Children(func() {
				label := "Automatic selection"
				help := "Shows the most recently active working session"
				if a.pinned() {
					label = "Pinned session"
					help = "Keeps the selected session visible"
				}
				ui.Text(c, label).FontSize(12).FontWeight(500)
				muted(c, help)
			})
			if a.pinned() {
				ui.Button(c, "Use automatic").FontSize(11).Disabled(a.busy).OnClick(func() { a.dispatch(map[string]any{"action": "pin", "key": nil}, "Resumed automatic selection.") })
			} else {
				ui.Text(c, "Enabled").FontSize(10).TextColor(t.TextMuted)
			}
		})
		for _, s := range sessions {
			a.sessionRow(c, s, false)
		}
		muted(c, "Click a session to pin it to your Discord activity.").Margin(4, 0, 0, 0)
	} else {
		ui.Column(c).MinHeight(230).Padding(25).Gap(12).Radius(8).Background(t.Surface).Center().Children(func() {
			ui.Icon(c, icons["radio"]).Size(28, 28).TextColor(t.TextMuted)
			title := "The local service is stopped"
			help := "Start the service to receive activity from your agents."
			if a.running() {
				title = "Waiting for your agent"
				help = "Connect an agent and start a task. Your session will appear here."
			}
			ui.Text(c, title).FontSize(14).FontWeight(500)
			muted(c, help).TextAlign(ui.Center)
			if a.running() {
				ui.Button(c, "Set up an agent").Margin(5, 0, 0, 0).OnClick(func() { a.page = "Agents" })
			}
		})
	}
	ui.Column(c).Margin(30, 0, 0, 0).Children(func() {
		heading(c, "Recent events", "Since opening the app")
		if len(a.events) == 0 {
			muted(c, "No events yet")
		}
		for _, event := range a.events {
			ui.Row(c).Gap(8).Padding(8, 0).Children(func() {
				dot(c, t.Border)
				ui.Text(c, event.Text).FontSize(11).Grow(1)
				age := "Just now"
				if elapsed := time.Since(event.At); elapsed >= time.Minute {
					age = fmt.Sprintf("%dm ago", int(elapsed.Minutes()))
				}
				muted(c, age).FontSize(10)
			})
		}
	})
}
func agentIcon(c *ui.Context, id string, size float32) {
	t := c.Theme()
	ui.Box(c).Size(size, size).Shrink(0).Radius(8).Border(1, t.Border).Background(t.Background).Center().Children(func() {
		art, ok := brandArt[id]
		if !ok {
			ui.Icon(c, icons["game"]).Size(size*.6, size*.6)
			return
		}
		image := art.Light
		if t.Dark {
			image = art.Dark
		}
		ui.Image(c, image).Size(size*.68, size*.68).Fit(ui.Contain).TextColor(t.Text)
	})
}
func (a *nativeApp) sessionRow(c *ui.Context, s session, compact bool) {
	t := c.Theme()
	selected := a.running() && a.data.Status.Selected != nil && *a.data.Status.Selected == s.Key
	row := ui.ButtonBase(c.Key(s.Key)).Label("Pin "+agentLabels[s.agent()]+": "+s.title()).Padding(14, 12).Gap(11).Radius(8).Border(1, t.Border).Margin(0, 0, 9, 0).Disabled(a.busy)
	if compact {
		row.Padding(9).Border(0, t.Border).Margin(0, 0, 4, 0)
	}
	if selected {
		row.Background(t.Accent.Alpha(.10))
		if !compact {
			row.Border(1, t.Accent)
		}
	} else if row.Hovered() {
		row.Background(t.SurfaceHover)
	}
	row.Children(func() {
		size := float32(35)
		if compact {
			size = 29
		}
		agentIcon(c, s.agent(), size)
		ui.Column(c).Grow(1).MinWidth(0).Gap(5).Children(func() {
			ui.Row(c).Gap(6).Children(func() {
				ui.Text(c, agentLabels[s.agent()]).FontSize(12).FontWeight(500).Grow(1)
				if selected {
					label := "Showing"
					if a.pinned() {
						label = "Pinned"
					}
					ui.Text(c, label).FontSize(10).TextColor(t.Accent)
				}
			})
			if !compact {
				ui.Text(c, s.title()).FontSize(12)
			}
			ui.Row(c).Gap(6).Children(func() {
				color := t.TextMuted
				if s.State == "working" {
					color = t.Success
				}
				if s.State == "waiting" {
					color = t.Warning
				}
				if s.State == "error" {
					color = t.Danger
				}
				dot(c, color)
				muted(c, stateLabels[s.State])
				if !compact {
					muted(c, "· "+elapsed(s.StartedAt))
				}
			})
		})
	})
	row.OnClick(func() { a.dispatch(map[string]any{"action": "pin", "key": s.Key}, "Session pinned.") })
}
func (a *nativeApp) agentsView(c *ui.Context) {
	t := c.Theme()
	heading(c, "Your agents", "5 supported agents")
	for _, id := range agentIDs {
		count := 0
		for _, s := range a.sessions() {
			if s.agent() == id {
				count++
			}
		}
		ui.Row(c).Gap(12).Padding(16, 0).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
			agentIcon(c, id, 36)
			ui.Column(c).Grow(1).Gap(4).Children(func() {
				ui.Text(c, agentLabels[id]).FontSize(12).FontWeight(500)
				label := "No sessions detected"
				if count > 0 {
					label = fmt.Sprintf("%d active sessions", count)
				}
				muted(c, label)
			})
			ui.Button(c.Key("setup-"+id), "Setup").Label("Set up " + agentLabels[id]).FontSize(11).Disabled(a.busy).OnClick(func() { a.dispatch(map[string]any{"action": "integration", "agent": id}, "") })
		})
	}
	ui.Column(c).Padding(15).Gap(5).Background(t.Surface).Radius(7).Margin(24, 0, 20, 0).Children(func() {
		ui.Text(c, "One service. Individual settings.").FontSize(12).FontWeight(500)
		muted(c, "Agents inherit global settings. Override their summary model and appearance individually.")
	})
	ui.Button(c, "Manage agent settings").OnClick(func() { a.page = "Summaries"; a.edit = nil })
}
func (a *nativeApp) settingsView(c *ui.Context) {
	t := c.Theme()
	options := []string{"Global · All agents"}
	for _, id := range agentIDs {
		options = append(options, agentLabels[id])
	}
	ui.Row(c).Gap(14).Margin(0, 0, 22, 0).Children(func() {
		caption := muted(c, "Settings scope").Grow(1)
		if ui.Select(c.Key("scope"), &a.scope, options).LabelledBy(caption).Width(190).Changed() {
			a.edit = nil
		}
	})
	e := a.editor()
	tag := "Global settings"
	if e.Scope != "global" {
		tag = "Agent override"
	}
	title := "Display"
	if a.page == "Summaries" {
		title = "Automatic summaries"
	}
	heading(c, title, tag)
	ui.Column(c.Key(a.page + e.Scope)).Gap(0).Disabled(a.busy || a.data.ConfigurationError != nil).Children(func() {
		if a.page == "Appearance" {
			a.appearanceForm(c, e)
		} else {
			a.summaryForm(c, e)
		}
		ui.Row(c).Gap(10).Margin(20, 0, 0, 0).Padding(17, 0, 0, 0).BorderWidth(1, 0, 0, 0).BorderColor(t.Border).Children(func() {
			label := "Restore defaults"
			if e.Scope != "global" {
				label = "Inherit global"
			}
			ui.Button(c, label).FontSize(11).OnClick(a.resetEditor)
			ui.Spacer(c)
			ui.PrimaryButton(c, "Save changes").Disabled(!e.Dirty).OnClick(a.saveEditor)
		})
	})
}
func field(c *ui.Context, label string, value *string, placeholder, help string, maxLength int) bool {
	changed := false
	ui.Column(c).Gap(7).Margin(0, 0, 18, 0).Children(func() {
		caption := ui.Text(c, label).FontSize(12)
		changed = ui.TextInput(c.Key(label), value).LabelledBy(caption).Placeholder(placeholder).MaxLength(maxLength).FillWidth().Changed()
		if help != "" {
			muted(c, help).FontSize(10)
		}
	})
	return changed
}
func (a *nativeApp) appearanceForm(c *ui.Context, e *editor) {
	ui.Column(c).Gap(7).Margin(0, 0, 18, 0).Children(func() {
		ui.Text(c, "Activity type").FontSize(12)
		if ui.Select(c, &e.Type, []string{"Playing", "Listening", "Watching", "Competing"}).Label("Activity type").FillWidth().Changed() {
			e.Dirty = true
		}
	})
	if field(c, "Activity name", &e.Name, "{topic}", "{topic} Work summary · {agent} Agent name", 128) {
		e.Dirty = true
	}
	if field(c, "Details", &e.Details, "{phase}", "{phase} Activity state; leave blank to hide this line", 128) {
		e.Dirty = true
	}
	if field(c, "Subtitle", &e.Subtitle, "{subtitle}", "{subtitle} Summary subtitle; leave blank to hide this line", 128) {
		e.Dirty = true
	}
	if ui.Checkbox(c, &e.Timer, "Show elapsed time").Margin(0, 0, 13, 0).Changed() {
		e.Dirty = true
	}
	if ui.Checkbox(c, &e.ShowImage, "Show activity image").Margin(0, 0, 17, 0).Changed() {
		e.Dirty = true
	}
	if e.ShowImage && field(c, "Custom large image", &e.Image, "HTTPS image URL or Discord asset key", "Leave blank to use the default agent icon.", 2048) {
		e.Dirty = true
		a.loadImage(e.Image)
	}
}
func (a *nativeApp) summaryForm(c *ui.Context, e *editor) {
	if ui.Checkbox(c, &e.Enabled, "Generate summaries automatically").Margin(0, 0, 24, 0).Changed() {
		e.Dirty = true
	}
	ui.Column(c).Disabled(!e.Enabled).Children(func() {
		ui.Column(c).Gap(7).Margin(0, 0, 18, 0).Children(func() {
			ui.Text(c, "Model source").FontSize(12)
			if ui.Select(c, &e.Source, []string{"Follow agent session", "Custom compatible service"}).FillWidth().Label("Model source").Changed() {
				e.Dirty = true
			}
			muted(c, "Use the model and provider from the current session.").FontSize(10)
		})
		if e.Source == "Custom compatible service" {
			if field(c, "Service URL", &e.BaseURL, "https://api.example.com/v1", "", 2048) {
				e.Dirty = true
			}
			if field(c, "API key environment variable", &e.KeyEnv, "OPENAI_API_KEY", "Enter the variable name. The local service reads its value.", 128) {
				e.Dirty = true
			}
		}
		if field(c, "Model override", &e.Model, "Leave blank to follow the current session", "Optional", 128) {
			e.Dirty = true
		}
		ui.Column(c).Gap(7).Margin(0, 0, 18, 0).Children(func() {
			ui.Text(c, "Custom prompt").FontSize(12)
			if ui.TextArea(c.Key("prompt"), &e.Prompt).Label("Custom prompt").Placeholder("Keep summaries concise, specific, and relaxed.").MaxLength(4000).Height(100).Changed() {
				e.Dirty = true
			}
		})
		ui.Row(c).Margin(0, 0, 8, 0).Children(func() {
			ui.Text(c, "Summary length").FontSize(12).Grow(1)
			muted(c, fmt.Sprintf("%d characters", int(e.Length)))
		})
		if ui.StepSlider(c, &e.Length, 20, 120, 1).Label("Summary length").FillWidth().Changed() {
			e.Dirty = true
		}
	})
	muted(c, "Lifecycle updates continue when automatic summaries are off.").Margin(15, 0, 0, 0)
}
func (a *nativeApp) preferencesView(c *ui.Context) {
	t := c.Theme()
	heading(c, "Appearance", "")
	ui.Column(c).Gap(7).Children(func() {
		ui.Text(c, "Theme").FontSize(12)
		if ui.Select(c, &a.prefs.Theme, []string{"System", "Light", "Dark"}).Label("Theme").FillWidth().Changed() {
			a.savePreferences()
		}
	})
	ui.Column(c).Margin(30, 0, 0, 0).Children(func() {
		heading(c, "Service & connections", "")
		running := "Stopped"
		pid := "—"
		if a.running() {
			running = "Running"
			pid = fmt.Sprint(a.data.Status.PID)
		}
		for _, item := range [][2]string{{"Local service", running}, {"Discord", a.connection()}, {"Process", pid}} {
			ui.Row(c).Padding(12, 0).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() { muted(c, item[0]).Grow(1); ui.Text(c, item[1]).FontSize(12) })
		}
	})
	for _, item := range [][2]string{{"Configuration file", a.data.ConfigPath}, {"Local socket", a.data.SocketPath}} {
		ui.Column(c).Gap(8).Margin(20, 0, 0, 0).Children(func() {
			muted(c, item[0])
			ui.Text(c, item[1]).Font("monospace").FontSize(11).Selectable().Padding(9).Background(t.Surface).Radius(5)
		})
	}
	ui.Button(c, "Refresh connection").Margin(20, 0, 0, 0).Disabled(a.busy).OnClick(func() { a.dispatch(map[string]any{"action": "snapshot"}, "Connection status refreshed.") })
	muted(c, "Closing the window keeps Presence in the tray. Quitting the app leaves the background service running.").Margin(18, 0, 0, 0)
}
func (a *nativeApp) setupDialog(c *ui.Context) {
	if a.setup == nil {
		return
	}
	ui.Modal(c, &a.setupOpen, func() {
		ui.Column(c).Width(560).MaxWidthPercent(100).Gap(14).Children(func() {
			ui.Text(c, "Set up "+agentLabels[a.setup.Agent]).FontSize(19).FontWeight(600)
			if ui.Segmented(c, &a.setupMode, "Agent prompt", "Manual configuration").FillEqually().Label("Setup method").Changed() {
				a.setupCopiedUntil = time.Time{}
				a.setupCopyError = ""
			}
			content, copyLabel, fieldLabel := &a.setup.Prompt, "Copy prompt", "Setup prompt"
			ui.Column(c).MinHeight(72).Gap(8).Children(func() {
				if a.setupMode == 0 {
					ui.Text(c, "Paste this prompt into "+agentLabels[a.setup.Agent]+" and let it configure the integration for you.").FontSize(12)
				} else {
					content, copyLabel, fieldLabel = &a.setup.Content, "Copy configuration", "Integration configuration"
					ui.Text(c, a.setup.Instructions).FontSize(12)
					if a.setup.Path != "" {
						ui.Text(c, a.setup.Path).Font("monospace").FontSize(11).Selectable()
					}
				}
			})
			ui.TextArea(c.Key(a.setupMode), content).Label(fieldLabel).ReadOnly(true).Height(240).Font("monospace").FontSize(11)
			copied := c.Now().Before(a.setupCopiedUntil)
			if copied {
				c.After(a.setupCopiedUntil.Sub(c.Now()))
			}
			if a.setupCopyError != "" {
				ui.Text(c, a.setupCopyError).FontSize(11).TextColor(c.Theme().Danger).Role(ui.RoleAlert)
			}
			ui.Row(c.Key("setup-actions")).Gap(10).Justify(ui.End).Children(func() {
				if copied {
					ui.Text(c, "Copied to clipboard.").FontSize(11).TextColor(c.Theme().Success).Role(ui.RoleStatus)
				}
				ui.Button(c.Key("setup-close"), "Close").OnClick(func() { a.setupOpen = false })
				label := copyLabel
				if copied {
					label = "Copied"
				}
				ui.PrimaryButton(c.Key("setup-copy"), label).MinWidth(140).OnClick(func() {
					at, services, mode, setup := c.Now(), c.Services(), a.setupMode, a.setup
					a.setupCopyError = ""
					c.WriteClipboardThen(*content, func(err error) {
						if a.setup != setup || a.setupMode != mode {
							return
						}
						if err != nil {
							a.setupCopiedUntil = time.Time{}
							a.setupCopyError = "Could not copy. Select and copy the text manually."
						} else {
							a.setupCopiedUntil = at.Add(2 * time.Second)
						}
						services.Invalidate()
					})
				})
			})
		})
	})
}
func (a *nativeApp) preview() (*activity, *session, bool) {
	s := a.selected()
	if !a.running() {
		return nil, s, false
	}
	if a.edit == nil || !a.edit.Dirty || a.page != "Appearance" {
		return a.data.Status.Activity, s, false
	}
	e := a.edit
	if e.Scope != "global" {
		s = nil
		for _, candidate := range a.sessions() {
			if candidate.agent() == e.Scope {
				s = &candidate
				break
			}
		}
	}
	if s == nil {
		return nil, nil, true
	}
	p := cloneMap(a.data.AgentSettings[s.agent()].Presence)
	for key, value := range e.presence() {
		p[key] = value
	}
	if e.ShowImage && e.Image == "" {
		assets, _ := p["assets"].(map[string]any)
		assets = cloneMap(assets)
		assets["large_image"] = "native:" + s.agent()
		p["assets"] = assets
	}
	return renderPreview(s, p), s, true
}
func (a *nativeApp) profileView(c *ui.Context) {
	t := c.Theme()
	heading(c, "DISCORD PREVIEW", "")
	ui.Row(c).Gap(5).Justify(ui.End).Margin(-34, 0, 12, 0).Children(func() {
		for _, theme := range []string{"Light", "Dark"} {
			ui.Button(c.Key("preview-"+theme), theme).Label(theme+" profile card").FontSize(10).Padding(4, 7).OnClick(func() { a.prefs.PreviewTheme = theme; a.savePreferences() })
		}
	})
	act, s, draft := a.preview()
	var user *profile
	if a.running() {
		user = a.data.Status.Profile
	}
	name, username := "Your Discord profile", "Connect Discord to show your profile"
	if user != nil {
		name = user.GlobalName
		if name == "" {
			name = user.Username
		}
		username = user.Username
	}
	dc := ui.DarkTheme()
	dc.Background = ui.Hex("#242429")
	dc.Surface = ui.Hex("#323237")
	dc.Text = ui.Hex("#f2f3f5")
	dc.TextMuted = ui.Hex("#b5bac1")
	if a.prefs.PreviewTheme == "Light" {
		dc = ui.LightTheme()
		dc.Background = ui.Hex("#ffffff")
		dc.Surface = ui.Hex("#f2f3f5")
	}
	dc.FontSize = 12
	ui.Themed(c, dc).Radius(12).Clip().Border(1, t.Border).Children(func() {
		ui.Box(c).Height(76).Shrink(0).Background(ui.Hex("#68716b"))
		ui.Column(c).Padding(49, 16, 16, 16).Gap(4).Children(func() {
			ui.Text(c, name).FontSize(20).FontWeight(650)
			ui.Text(c, username).FontSize(12).TextColor(dc.TextMuted)
			ui.Box(c).Absolute().Top(-39).Left(13).Size(82, 82).Background(dc.Background).Radius(41).Padding(6).Children(func() {
				var bitmap *ui.Bitmap
				if user != nil && user.Avatar != "" {
					bitmap = a.images["https://cdn.discordapp.com/avatars/"+user.ID+"/"+user.Avatar+".png?size=128"]
				}
				if bitmap != nil {
					ui.Image(c, bitmap).Size(70, 70).Fit(ui.Cover).Radius(35).Label(name)
				} else {
					initial := "?"
					if letters := []rune(name); len(letters) > 0 {
						initial = string(letters[0])
					}
					ui.Box(c).Size(70, 70).Radius(35).Background(ui.Hex("#7c8278")).Center().Children(func() {
						ui.Text(c, initial).FontSize(32).TextColor(ui.Hex("#f5f1e6"))
					})
				}
				ui.Box(c).Absolute().Right(0).Bottom(0).Size(22, 22).Radius(11).Background(ui.Hex("#43a25a")).Border(5, dc.Background).Tooltip("Example status indicator")
			})
			ui.Text(c, "···").Absolute().Right(16).Top(7).FontSize(22).TextColor(dc.TextMuted)
		})
		ui.Column(c).Padding(0, 12, 12, 12).Children(func() {
			ui.Column(c).Background(dc.Surface).Radius(8).Padding(13, 12).Gap(12).Children(func() {
				if act == nil {
					ui.Column(c).Padding(12, 0).Gap(10).Center().Children(func() {
						ui.Icon(c, icons["game"]).Size(26, 26).TextColor(dc.TextMuted)
						ui.Text(c, "No activity to display").FontSize(12).FontWeight(500)
						ui.Text(c, "Your activity appears here when an agent starts working.").FontSize(11).TextColor(dc.TextMuted).TextAlign(ui.Center)
					})
				} else {
					category := map[int]string{0: "Playing", 2: "Listening", 3: "Watching", 5: "Competing"}[act.Type]
					if category == "" {
						category = "Playing"
					}
					ui.Row(c).Children(func() {
						ui.Text(c, category).FontSize(10).TextColor(dc.TextMuted).Grow(1)
						ui.Text(c, "···").FontSize(14).TextColor(dc.TextMuted)
					})
					ui.Row(c).AlignItems(ui.Start).Gap(11).Children(func() {
						if act.Assets != nil && act.Assets.LargeImage != "" {
							a.activityImage(c, act, s, dc)
						}
						ui.Column(c).Grow(1).MinWidth(0).Gap(4).Children(func() {
							ui.Text(c, act.Name).FontSize(12).FontWeight(650)
							if act.Details != "" {
								ui.Text(c, act.Details).FontSize(11)
							}
							if act.State != "" {
								ui.Text(c, act.State).FontSize(11)
							}
							if act.Party != nil && len(act.Party.Size) == 2 {
								ui.Text(c, fmt.Sprintf("%d / %d members", act.Party.Size[0], act.Party.Size[1])).FontSize(11)
							}
							if act.Timestamps != nil {
								if act.Timestamps.End > 0 {
									remaining := max(int64(0), act.Timestamps.End-time.Now().Unix())
									ui.Text(c, fmt.Sprintf("%02d:%02d remaining", remaining/60, remaining%60)).FontSize(11).TextColor(dc.TextMuted)
								} else if act.Timestamps.Start > 0 {
									ui.Text(c, elapsed(act.Timestamps.Start*1000)+" elapsed").FontSize(11).TextColor(dc.TextMuted)
								}
							}
						})
					})
					for _, button := range act.Buttons {
						ui.Box(c).Padding(8).Radius(5).Background(dc.Border).Center().Tooltip(button.URL).Children(func() { ui.Text(c, button.Label).FontSize(11).TextAlign(ui.Center) })
					}
				}
			})
		})
	})
	label := "Local preview"
	color := t.TextMuted
	if a.running() && a.data.Status.Discord == "dry-run" {
		label = "Dry run · Activity is not published"
	}
	if a.running() && a.data.Status.Discord == "connected" && a.data.Status.ActivityAcknowledged != nil && *a.data.Status.ActivityAcknowledged {
		label = "Synced to Discord"
		color = t.Success
	}
	if draft {
		label = "Unsaved appearance preview"
		color = t.TextMuted
	}
	ui.Row(c).Gap(6).Justify(ui.Center).Margin(16, 0, 5, 0).Children(func() { dot(c, color); muted(c, label) })
	muted(c, "Final appearance depends on your Discord client.").FontSize(10).TextAlign(ui.Center)
}
func (a *nativeApp) activityImage(c *ui.Context, act *activity, s *session, dc *ui.Theme) {
	ui.Box(c).Size(58, 58).Shrink(0).Background(dc.Border).Radius(9).Center().Tooltip(act.Assets.LargeText).Children(func() {
		if bitmap := a.images[act.Assets.LargeImage]; bitmap != nil {
			ui.Image(c, bitmap).Size(58, 58).Radius(9).Fit(ui.Cover)
		} else if s != nil {
			agentIcon(c, s.agent(), 42)
		} else {
			ui.Icon(c, icons["game"]).Size(30, 30)
		}
		if act.Assets.SmallImage != "" {
			ui.Box(c).Size(22, 22).Radius(11).Border(3, dc.Surface).Background(ui.Hex("#5865f2")).Absolute().Right(-4).Bottom(-4).Center().Children(func() {
				if bitmap := a.images[act.Assets.SmallImage]; bitmap != nil {
					ui.Image(c, bitmap).Size(16, 16).Radius(8)
				} else {
					ui.Icon(c, icons["game"]).Size(12, 12).TextColor(ui.Hex("#ffffff"))
				}
			})
		}
	})
}
func (a *nativeApp) trayView(c *ui.Context) {
	a.theme(c)
	t := c.Theme()
	c.After(time.Second)
	ui.Column(c).Fill().Padding(20).Children(func() {
		ui.Row(c).Gap(8).Margin(0, 0, 24, 0).Children(func() {
			ui.Icon(c, icons["radio"]).Size(21, 21).TextColor(t.Accent)
			ui.Text(c, "Presence").FontSize(15).FontWeight(600).Grow(1)
			muted(c, a.connection()).FontSize(10)
		})
		act, s, _ := a.preview()
		ui.Row(c).Gap(12).Margin(0, 0, 23, 0).Children(func() {
			id := "codex"
			if s != nil {
				id = s.agent()
			}
			agentIcon(c, id, 48)
			ui.Column(c).Grow(1).MinWidth(0).Gap(4).Children(func() {
				label := "Agent Discord Presence"
				if s != nil {
					label = agentLabels[s.agent()]
				}
				muted(c, label)
				title := "Waiting for an agent"
				if !a.running() {
					title = "Service stopped"
				}
				if act != nil {
					title = act.Name
				}
				ui.Text(c, title).FontSize(14).FontWeight(500)
				if s != nil {
					muted(c, stateLabels[s.State]+" · "+elapsed(s.StartedAt))
				}
			})
		})
		ui.Divider(c)
		ui.Row(c).Margin(14, 0, 12, 0).Children(func() {
			ui.Text(c, "Activity source").FontSize(11).Grow(1)
			ui.Button(c, "Use automatic").FontSize(10).Disabled(!a.pinned() || a.busy).OnClick(func() { a.dispatch(map[string]any{"action": "pin", "key": nil}, "") })
		})
		ui.Scroll(c).Grow(1).Children(func() {
			ui.Column(c).Children(func() {
				sessions := a.sessions()
				for _, s := range sessions {
					a.sessionRow(c, s, true)
				}
				if len(sessions) == 0 {
					muted(c, "No active sessions").Padding(25, 5)
				}
			})
		})
		if a.err != "" {
			ui.Text(c, a.err).FontSize(11).TextColor(t.Danger).Margin(10, 0).Role(ui.RoleAlert)
		}
		ui.Divider(c)
		ui.Row(c).Gap(12).Padding(15, 0, 0, 0).Children(func() {
			ui.Button(c, "Open main window").FontSize(11).OnClick(a.bridge.OpenMain)
			ui.Spacer(c)
			label := "Start service"
			if a.running() {
				label = "Stop service"
			}
			ui.Button(c, label).FontSize(11).Disabled(a.busy || a.data == nil).OnClick(a.power)
		})
	})
	if c.Shortcut(0, ui.KeyEscape) || c.Shortcut(ui.Cmd, ui.KeyW) {
		if a.bridge.panel != nil {
			a.bridge.panel.Hide()
		}
	}
}
