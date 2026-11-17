package main

import (
	"bytes"
	"embed"
	"fmt"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

// Tabler Icons v3.52.0: https://github.com/tabler/tabler-icons/tree/v3.52.0/icons/outline
// Copyright (c) 2020-2026 Paweł Kuna
// Licensed under MIT; see ../../LICENSE for the full text.
//
//go:embed assets/tabler/*.svg
var tablerAssets embed.FS

func tablerIcon(name string) *ui.SVG {
	data, err := tablerAssets.ReadFile("assets/tabler/" + name + ".svg")
	if err != nil {
		panic(err)
	}
	return ui.MustParseSVG(bytes.Replace(data, []byte(`stroke-width="2"`), []byte(`stroke-width="1.6"`), 1))
}

var icons = map[string]*ui.SVG{
	"chevron":     tablerIcon("chevron-down"),
	"radio":       tablerIcon("broadcast"),
	"Overview":    tablerIcon("activity"),
	"Agents":      tablerIcon("layout-grid"),
	"Appearance":  tablerIcon("palette"),
	"Summaries":   tablerIcon("sparkles"),
	"Preferences": tablerIcon("adjustments-horizontal"),
	"pin":         tablerIcon("pin"),
	"game":        tablerIcon("device-gamepad"),
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
			ui.Scroll(c).Scrollbars(false).Grow(1).Children(func() {
				ui.Column(c).Padding(12, 28, 30, 28).Gap(0).Children(func() {
					ui.Row(c).AlignItems(ui.Center).Gap(16).Margin(0, 0, 30, 0).Children(func() {
						ui.Column(c).Grow(1).Gap(7).Children(func() {
							ui.Text(c, a.t("YOUR WORK, VISIBLE.")).FontSize(9).LetterSpacing(1.8).TextColor(t.TextMuted)
							ui.Text(c, a.t(a.page)).FontSize(25).FontWeight(600)
							ui.Text(c, a.t(descriptions[a.page])).FontSize(12).TextColor(t.TextMuted)
						})
						label := "Start service"
						if a.running() {
							label = "Stop service"
						}
						ui.Button(c.Key("power"), a.t(label)).Disabled(a.busy || a.data == nil).OnClick(a.power)
					})
					if a.err != "" {
						ui.Text(c, a.t(a.err)).FontSize(12).TextColor(t.Danger).Padding(12).Background(t.Danger.Alpha(.06)).Radius(6).Margin(0, 0, 16, 0).Role(ui.RoleAlert)
					}
					if a.data != nil && a.data.ConfigurationError != nil {
						ui.Text(c, a.t("Configuration file error: %s", *a.data.ConfigurationError)).TextColor(t.Danger).FontSize(12).Margin(0, 0, 16, 0)
					}
					if a.data != nil && a.data.ServiceError != nil {
						ui.Text(c, *a.data.ServiceError).TextColor(t.Danger).FontSize(12).Margin(0, 0, 16, 0)
					}
					if a.running() && a.data.Status.SettingsError != nil {
						ui.Text(c, a.t("The service is using its last valid configuration.")).TextColor(t.Danger).FontSize(12).Margin(0, 0, 16, 0)
					}
					width, _ := c.Size()
					if a.page == "Agents" {
						a.pageView(c)
					} else if width >= 980 {
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
				muted(c, a.t("One local service · All your agents"))
			})
		})
	})
	a.setupDialog(c)
	a.removalDialog(c)
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
				ui.Text(c, a.t("STAY IN SYNC")).FontSize(9).LetterSpacing(1.2).TextColor(t.TextMuted)
			})
		})
		for _, page := range navPages {
			button := ui.ButtonBase(c.Key(page)).Label(a.t(page)).Padding(10, 12).Gap(10).Radius(7).Margin(0, 0, 5, 0)
			if a.page == page {
				button.Background(t.Accent.Alpha(.10)).TextColor(t.Accent)
			} else if button.Hovered() {
				button.Background(t.SurfaceHover)
			} else {
				button.TextColor(t.TextMuted)
			}
			button.Children(func() {
				ui.Icon(c, icons[page]).Size(17, 17)
				ui.Text(c, a.t(page)).FontSize(12).Grow(1)
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
			muted(c, a.t(label))
		})
		preferences := ui.ButtonBase(c.Key("preferences")).Label(a.t("Preferences")).Padding(9, 8).Gap(7).Radius(6)
		if preferences.Hovered() {
			preferences.Background(t.SurfaceHover)
		}
		preferences.Children(func() {
			ui.Icon(c, icons["Preferences"]).Size(16, 16)
			ui.Text(c, a.t("Preferences")).FontSize(11).Grow(1)
			muted(c, "v0.0.3")
		}).OnClick(func() { a.page = "Preferences"; a.edit = nil })
	})
}
func (a *nativeApp) pageView(c *ui.Context) {
	if a.data == nil && a.page != "Preferences" {
		muted(c, a.t("Connecting to the local service…"))
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
		ui.Text(c, a.t(a.notice)).FontSize(11).TextColor(c.Theme().Success).Margin(18, 0, 0, 0).Role(ui.RoleStatus)
	}
}
func (a *nativeApp) overview(c *ui.Context) {
	t := c.Theme()
	sessions := a.sessions()
	heading(c, a.t("Active sessions  %d", len(sessions)), a.t("Current sessions only"))
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
				ui.Text(c, a.t(label)).FontSize(12).FontWeight(500)
				muted(c, a.t(help))
			})
			if a.pinned() {
				ui.Button(c, a.t("Use automatic")).FontSize(11).Disabled(a.busy).OnClick(func() { a.dispatch(map[string]any{"action": "pin", "key": nil}, "Resumed automatic selection.") })
			} else {
				ui.Text(c, a.t("Enabled")).FontSize(10).TextColor(t.TextMuted)
			}
		})
		for _, s := range sessions {
			a.sessionRow(c, s, false)
		}
		muted(c, a.t("Click a session to pin it to your Discord activity.")).Margin(4, 0, 0, 0)
	} else {
		ui.Column(c).MinHeight(230).Padding(25).Gap(12).Radius(8).Background(t.Surface).Center().Children(func() {
			ui.Icon(c, icons["radio"]).Size(28, 28).TextColor(t.TextMuted)
			title := "The local service is stopped"
			help := "Start the service to receive activity from your agents."
			if a.running() {
				title = "Waiting for your agent"
				help = "Connect an agent and start a task. Your session will appear here."
			}
			ui.Text(c, a.t(title)).FontSize(14).FontWeight(500)
			muted(c, a.t(help)).TextAlign(ui.Center)
			if a.running() {
				ui.Button(c, a.t("Set up an agent")).Margin(5, 0, 0, 0).OnClick(func() { a.page = "Agents" })
			}
		})
	}
	ui.Column(c).Margin(30, 0, 0, 0).Children(func() {
		heading(c, a.t("Recent events"), a.t("Since opening the app"))
		if len(a.events) == 0 {
			muted(c, a.t("No events yet"))
		}
		for _, event := range a.events {
			ui.Row(c).Gap(8).Padding(8, 0).Children(func() {
				dot(c, t.Border)
				text := a.t(event.Text)
				if event.Agent != "" {
					text = a.agentLabel(event.Agent) + " · " + a.t(stateLabels[event.State])
				}
				ui.Text(c, text).FontSize(11).Grow(1)
				age := "Just now"
				if elapsed := time.Since(event.At); elapsed >= time.Minute {
					age = a.t("%dm ago", int(elapsed.Minutes()))
				}
				muted(c, a.t(age)).FontSize(10)
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
	row := ui.ButtonBase(c.Key(s.Key)).Label(a.t("Pin %s: %s", a.agentLabel(s.agent()), a.sessionTitle(s))).Padding(14, 12).Gap(11).Radius(8).Border(1, t.Border).Margin(0, 0, 9, 0).Disabled(a.busy)
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
		a.agentIcon(c, s.agent(), size)
		ui.Column(c).Grow(1).MinWidth(0).Gap(5).Children(func() {
			ui.Row(c).Gap(6).Children(func() {
				ui.Text(c, a.agentLabel(s.agent())).FontSize(12).FontWeight(500).Grow(1)
				if selected {
					label := "Showing"
					if a.pinned() {
						label = "Pinned"
					}
					ui.Text(c, a.t(label)).FontSize(10).TextColor(t.Accent)
				}
			})
			if !compact {
				ui.Text(c, a.sessionTitle(s)).FontSize(12)
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
				muted(c, a.t(stateLabels[s.State]))
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
	ui.Row(c).AlignItems(ui.Center).Gap(12).Margin(0, 0, 14, 0).Children(func() {
		ui.Text(c, a.t("Your agents")).FontSize(13).FontWeight(600).Grow(1)
		muted(c, a.t("%d agents", len(a.agents())))
		ui.PrimaryButton(c, a.t("Install local plugin…")).Label(a.t("Install local Agent plugin")).FontSize(11).Disabled(a.busy).OnClick(a.selectPlugin)
	})
	if a.data.PluginError != nil {
		ui.Text(c, a.t(*a.data.PluginError)).FontSize(11).TextColor(t.Danger).Role(ui.RoleAlert).Margin(0, 0, 14, 0)
	}
	for _, agent := range a.agents() {
		id := agent.ID
		count := 0
		for _, s := range a.sessions() {
			if s.agent() == id {
				count++
			}
		}
		ui.Row(c).Gap(12).Padding(16, 0).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
			a.agentIcon(c, id, 36)
			ui.Column(c).Grow(1).MinWidth(0).Gap(4).Tooltip(strings.TrimSpace(agent.Version + "\n" + a.agentText(agent.ID, agent.Description))).Children(func() {
				ui.Row(c).AlignItems(ui.Center).Gap(8).Children(func() {
					ui.Text(c, a.agentLabel(id)).FontSize(12).FontWeight(500).SingleLine()
					source, help := "Bundled", "Included with the app"
					if agent.Plugin {
						source, help = "Plugin", "Installed separately"
					}
					muted(c, a.t(source)).FontSize(9).FontWeight(500).Padding(1, 5).Background(t.Surface).Radius(4).Shrink(0).Tooltip(a.t(help))
				})
				label := "No sessions detected"
				if agent.Plugin && !agent.Enabled {
					label = "Plugin disabled"
				}
				if agent.Error != "" {
					label = "Needs attention"
				}
				if count > 0 && agent.Enabled && agent.Error == "" {
					label = a.t("%d active sessions", count)
				}
				muted(c, a.t(label))
			})
			ui.Button(c.Key("setup-"+id), a.t("Setup")).Label(a.t("Set up %s", a.agentLabel(id))).FontSize(11).Disabled(a.busy || !agent.Enabled).OnClick(func() {
				a.dispatch(map[string]any{"action": "integration", "agent": id, "language": a.prefs.Language}, "")
			})
			ui.Button(c.Key("manage-"+id), "⋯").Label(a.t("Manage %s integration", a.agentLabel(id))).Disabled(a.busy).Menu(func(m *ui.Menu) {
				if (!agent.Plugin || agent.ManagedIntegration) && m.Item(a.t("Remove integration…")).Danger().Chosen() {
					a.dispatch(map[string]any{"action": "uninstall-preview", "agent": id}, "")
				}
				if agent.Plugin {
					action, label := "plugin-enable", "Enable plugin"
					if agent.Enabled {
						action, label = "plugin-disable", "Disable plugin"
					}
					if m.Item(a.t(label)).Chosen() {
						a.dispatch(map[string]any{"action": action, "agent": id}, "Agent plugin updated.")
					}
					if m.Item(a.t("Remove plugin…")).Danger().Chosen() {
						a.pluginConfirm = id
					}
				}
			})
		})
		if agent.Error != "" {
			ui.Text(c, agent.Error).FontSize(11).TextColor(t.Danger).Role(ui.RoleAlert)
		}
		a.pluginRemoval(c, agent)
	}
	ui.Column(c).Padding(15).Gap(5).Background(t.Surface).Radius(7).Margin(24, 0, 20, 0).Children(func() {
		ui.Text(c, a.t("One service. Individual settings.")).FontSize(12).FontWeight(500)
		muted(c, a.t("Agents inherit global settings. Override their summary model and appearance individually."))
	})
	ui.Button(c, a.t("Manage agent settings")).OnClick(func() { a.page = "Summaries"; a.edit = nil })
}
func (a *nativeApp) settingsView(c *ui.Context) {
	t := c.Theme()
	options := []string{"Global · All agents"}
	for _, agent := range a.agents() {
		options = append(options, agent.Name)
	}
	ui.Row(c).Gap(14).Margin(0, 0, 22, 0).Children(func() {
		caption := muted(c, a.t("Settings scope")).Grow(1)
		if a.selectValue(c.Key("scope"), &a.scope, options).LabelledBy(caption).Width(190).Changed() {
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
	heading(c, a.t(title), a.t(tag))
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
			ui.Button(c, a.t(label)).FontSize(11).OnClick(a.resetEditor)
			ui.Spacer(c)
			ui.PrimaryButton(c, a.t("Save changes")).Disabled(!e.Dirty).OnClick(a.saveEditor)
		})
	})
}
func (a *nativeApp) field(c *ui.Context, label string, value *string, placeholder, help string, maxLength int) bool {
	changed := false
	ui.Column(c).Gap(7).Margin(0, 0, 18, 0).Children(func() {
		caption := ui.Text(c, a.t(label)).FontSize(12)
		changed = ui.TextInput(c.Key(label), value).LabelledBy(caption).Placeholder(a.t(placeholder)).MaxLength(maxLength).FillWidth().Changed()
		if help != "" {
			muted(c, a.t(help)).FontSize(10)
		}
	})
	return changed
}
func (a *nativeApp) appearanceForm(c *ui.Context, e *editor) {
	ui.Column(c).Gap(7).Margin(0, 0, 18, 0).Children(func() {
		caption := ui.Text(c, a.t("Activity type")).FontSize(12)
		if a.selectValue(c, &e.Type, []string{"Playing", "Listening", "Watching", "Competing"}).LabelledBy(caption).FillWidth().Changed() {
			e.Dirty = true
		}
	})
	if a.field(c, "Activity name", &e.Name, "{topic}", "{topic} Work summary · {agent} Agent name", 128) {
		e.Dirty = true
	}
	if a.field(c, "Details", &e.Details, "{phase}", "{phase} Activity state; leave blank to hide this line", 128) {
		e.Dirty = true
	}
	if a.field(c, "Subtitle", &e.Subtitle, "{subtitle}", "{subtitle} Summary subtitle; leave blank to hide this line", 128) {
		e.Dirty = true
	}
	if ui.Checkbox(c, &e.Timer, a.t("Show elapsed time")).Margin(0, 0, 13, 0).Changed() {
		e.Dirty = true
	}
	if ui.Checkbox(c, &e.ShowImage, a.t("Show activity image")).Margin(0, 0, 17, 0).Changed() {
		e.Dirty = true
	}
	if e.ShowImage && a.field(c, "Custom large image", &e.Image, "HTTPS image URL or Discord asset key", "Leave blank to use the default agent icon.", 2048) {
		e.Dirty = true
		a.loadImage(e.Image)
	}
	ui.Column(c).Gap(8).Margin(12, 0, 0, 0).Children(func() {
		heading(c, a.t("Profile buttons"), a.t("Up to 2"))
		muted(c, a.t("Buttons are visible to other users on Discord. You cannot see them on your own profile."))
		muted(c, a.t("Button text supports {agent}, {topic}, {subtitle}, {phase}, and {state}. Links use HTTPS."))
		for i := range e.Buttons {
			ui.Column(c.Key(fmt.Sprintf("presence-button-%d", i))).Padding(12).Radius(6).Border(1, c.Theme().Border).Children(func() {
				ui.Row(c).Margin(0, 0, 12, 0).Children(func() {
					ui.Text(c, a.t("Button %d", i+1)).FontSize(12).Grow(1)
					ui.Button(c, a.t("Remove")).Label(a.t("Remove button %d", i+1)).FontSize(11).OnClick(func() {
						e.Buttons = append(e.Buttons[:i], e.Buttons[i+1:]...)
						e.ButtonsDirty, e.Dirty = true, true
					})
				})
				if a.field(c, a.t("Button %d text", i+1), &e.Buttons[i].Label, "View project", "", 32) {
					e.ButtonsDirty, e.Dirty = true, true
				}
				if a.field(c, a.t("Button %d URL", i+1), &e.Buttons[i].URL, "https://example.com", "", 2048) {
					e.ButtonsDirty, e.Dirty = true, true
				}
			})
		}
		if message := e.buttonsError(); message != "" {
			ui.Text(c, a.t(message)).FontSize(11).TextColor(c.Theme().Danger).Role(ui.RoleAlert)
		}
		ui.Button(c, a.t("Add button")).Disabled(len(e.Buttons) >= 2).OnClick(func() {
			e.Buttons = append(e.Buttons, presenceButton{})
			e.ButtonsDirty, e.Dirty = true, true
		})
	})
}
func (a *nativeApp) summaryForm(c *ui.Context, e *editor) {
	if ui.Checkbox(c, &e.Enabled, a.t("Generate summaries automatically")).Margin(0, 0, 24, 0).Changed() {
		e.Dirty = true
	}
	ui.Column(c).Disabled(!e.Enabled).Children(func() {
		ui.Column(c).Gap(7).Margin(0, 0, 18, 0).Children(func() {
			caption := ui.Text(c, a.t("Model source")).FontSize(12)
			if a.selectValue(c, &e.Source, []string{"Follow agent session", "Custom compatible service"}).FillWidth().LabelledBy(caption).Changed() {
				e.Dirty = true
			}
			muted(c, a.t("Use the model and provider from the current session.")).FontSize(10)
		})
		if e.Source == "Custom compatible service" {
			if a.field(c, "Service URL", &e.BaseURL, "https://api.example.com/v1", "", 2048) {
				e.Dirty = true
			}
			if a.field(c, "API key environment variable", &e.KeyEnv, "OPENAI_API_KEY", "Enter the variable name. The local service reads its value.", 128) {
				e.Dirty = true
			}
		}
		if a.field(c, "Model override", &e.Model, "Leave blank to follow the current session", "Optional", 128) {
			e.Dirty = true
		}
		ui.Column(c).Gap(7).Margin(0, 0, 18, 0).Children(func() {
			ui.Text(c, a.t("Custom prompt")).FontSize(12)
			if ui.TextArea(c.Key("prompt"), &e.Prompt).Label(a.t("Custom prompt")).Placeholder(a.t("Keep summaries concise, specific, and relaxed.")).MaxLength(4000).Height(100).Changed() {
				e.Dirty = true
			}
		})
		ui.Row(c).Margin(0, 0, 8, 0).Children(func() {
			ui.Text(c, a.t("Summary length")).FontSize(12).Grow(1)
			muted(c, a.t("%d characters", int(e.Length)))
		})
		if ui.StepSlider(c, &e.Length, 20, 120, 1).Label(a.t("Summary length")).FillWidth().Changed() {
			e.Dirty = true
		}
	})
	muted(c, a.t("Lifecycle updates continue when automatic summaries are off.")).Margin(15, 0, 0, 0)
}
func (a *nativeApp) preferencesView(c *ui.Context) {
	t := c.Theme()
	heading(c, a.t("Language"), "")
	ui.Column(c.Key("language")).Gap(7).Margin(0, 0, 26, 0).Children(func() {
		caption := ui.Text(c, a.t("Interface language")).FontSize(12)
		if a.selectValue(c, &a.prefs.Language, []string{languageEnglish, languageChinese}).LabelledBy(caption).FillWidth().Changed() {
			a.savePreferences()
		}
	})
	heading(c, a.t("Appearance"), "")
	ui.Column(c).Gap(7).Children(func() {
		caption := ui.Text(c, a.t("Theme")).FontSize(12)
		if a.selectValue(c, &a.prefs.Theme, []string{"System", "Light", "Dark"}).LabelledBy(caption).FillWidth().Changed() {
			a.savePreferences()
		}
	})
	if a.data == nil {
		return
	}
	ui.Column(c).Margin(30, 0, 0, 0).Children(func() {
		heading(c, a.t("Service & connections"), "")
		running := "Stopped"
		pid := "—"
		if a.running() {
			running = "Running"
			pid = fmt.Sprint(a.data.Status.PID)
		}
		for _, item := range [][2]string{{"Local service", running}, {"Discord", a.connection()}, {"Process", pid}} {
			ui.Row(c).Padding(12, 0).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() { muted(c, a.t(item[0])).Grow(1); ui.Text(c, a.t(item[1])).FontSize(12) })
		}
	})
	for _, item := range [][2]string{{"Configuration file", a.data.ConfigPath}, {"Local socket", a.data.SocketPath}} {
		ui.Column(c).Gap(8).Margin(20, 0, 0, 0).Children(func() {
			muted(c, a.t(item[0]))
			ui.Text(c, item[1]).Font("monospace").FontSize(11).Selectable().Padding(9).Background(t.Surface).Radius(5)
		})
	}
	ui.Button(c, a.t("Refresh connection")).Margin(20, 0, 0, 0).Disabled(a.busy).OnClick(func() { a.dispatch(map[string]any{"action": "snapshot"}, "Connection status refreshed.") })
	muted(c, a.t("Closing the window keeps Presence in the tray. Quitting the app leaves the background service running.")).Margin(18, 0, 0, 0)
}
func (a *nativeApp) setupDialog(c *ui.Context) {
	if a.setup == nil {
		return
	}
	if a.setupPlan != nil {
		a.managedSetupDialog(c)
		return
	}
	ui.Modal(c, &a.setupOpen, func() {
		ui.Column(c).Width(560).MaxWidthPercent(100).Gap(14).Children(func() {
			ui.Text(c, a.t("Set up %s", a.agentLabel(a.setup.Agent))).FontSize(19).FontWeight(600)
			if ui.Segmented(c, &a.setupMode, a.t("Agent prompt"), a.t("Manual configuration")).FillEqually().Label(a.t("Setup method")).Changed() {
				a.setupCopiedUntil = time.Time{}
				a.setupCopyError = ""
			}
			content, copyLabel, fieldLabel := &a.setup.Prompt, "Copy prompt", "Setup prompt"
			ui.Column(c).MinHeight(72).Gap(8).Children(func() {
				if a.setupMode == 0 {
					ui.Text(c, a.t("Paste this prompt into %s and let it configure the integration for you.", a.agentLabel(a.setup.Agent))).FontSize(12)
				} else {
					content, copyLabel, fieldLabel = &a.setup.Content, "Copy configuration", "Integration configuration"
					ui.Text(c, a.agentText(a.setup.Agent, a.setup.Instructions)).FontSize(12)
					if a.setup.Path != "" {
						ui.Text(c, a.setup.Path).Font("monospace").FontSize(11).Selectable()
					}
				}
			})
			ui.TextArea(c.Key(a.setupMode), content).Label(a.t(fieldLabel)).ReadOnly(true).Height(240).Font("monospace").FontSize(11)
			copied := c.Now().Before(a.setupCopiedUntil)
			if copied {
				c.After(a.setupCopiedUntil.Sub(c.Now()))
			}
			if a.setupCopyError != "" {
				ui.Text(c, a.t(a.setupCopyError)).FontSize(11).TextColor(c.Theme().Danger).Role(ui.RoleAlert)
			}
			ui.Row(c.Key("setup-actions")).Gap(10).Justify(ui.End).Children(func() {
				if copied {
					ui.Text(c, a.t("Copied to clipboard.")).FontSize(11).TextColor(c.Theme().Success).Role(ui.RoleStatus)
				}
				ui.Button(c.Key("setup-close"), a.t("Close")).OnClick(func() { a.setupOpen = false })
				label := copyLabel
				if copied {
					label = "Copied"
				}
				ui.PrimaryButton(c.Key("setup-copy"), a.t(label)).MinWidth(140).OnClick(func() {
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
func (a *nativeApp) removalDialog(c *ui.Context) {
	if a.removal == nil {
		return
	}
	p := a.removal
	done := a.removalResult != nil && a.removalResult.Removed
	ui.Modal(c, &a.removalOpen, func() {
		ui.Column(c).Width(640).MaxWidthPercent(100).Gap(18).Children(func() {
			ui.Text(c, a.t("Remove %s integration", a.agentLabel(p.Agent))).FontSize(19).FontWeight(600)
			ui.Scroll(c).Scrollbars(false).Height(integrationScrollHeight(c)).Children(func() {
				ui.Column(c).Gap(20).Children(func() {
					if p.Kind != "managed" && !done {
						a.integrationFileField(c, "removal-path", &a.removalPath, a.busy, func() {})
					} else if p.Path != "" {
						ui.Text(c, p.Path).Font("monospace").FontSize(11).Selectable()
					}
					if !done && len(p.InstalledEvents) > 0 {
						if p.Kind != "hooks" && ui.Checkbox(c, &a.removalAll, a.t("Remove entire integration")).Disabled(a.busy).Changed() {
							a.removalSelected = map[string]bool{}
							for _, event := range p.Catalog {
								a.removalSelected[event.ID] = a.removalAll || !event.Required
							}
							a.removalDirty = true
						}
						if !a.removalAll {
							var installed []integrationEvent
							for _, event := range p.Catalog {
								for _, id := range p.InstalledEvents {
									if event.ID == id {
										installed = append(installed, event)
										break
									}
								}
							}
							ui.Column(c).Gap(7).Children(func() {
								ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
									ui.Text(c, a.t("Events to remove")).FontSize(13).FontWeight(600).Grow(1)
									ui.Button(c, a.t("Select all")).FontSize(11).Disabled(a.busy).OnClick(func() {
										a.removalSelected = map[string]bool{}
										for _, event := range installed {
											if !event.Required {
												a.removalSelected[event.ID] = true
											}
										}
										a.removalDirty = true
									})
									ui.Button(c, a.t("Clear selection")).FontSize(11).Disabled(a.busy).OnClick(func() { a.removalSelected = map[string]bool{}; a.removalDirty = true })
								})
								muted(c, a.t("Select the events you want to remove."))
							})
							a.eventChoices(c, p.Agent, installed, a.removalSelected, true, func() { a.removalDirty = true })
							if p.Kind != "hooks" {
								muted(c, a.t("Required plugin events stay active. Related events are selected together."))
							}
						}
					}
					if done {
						label := "Integration removed."
						if p.Partial {
							label = "Selected hooks removed."
							if p.Kind != "hooks" {
								label = "Selected plugin events disabled."
							}
						}
						if p.ManualReview {
							label = "Recognized hooks removed. Manual review is still required."
						}
						ui.Text(c, a.t(label)).TextColor(c.Theme().Success).Role(ui.RoleStatus)
						if a.removalResult.Backup != "" {
							ui.Text(c, a.t("Backup: %s", a.removalResult.Backup)).FontSize(11).Selectable()
						}
						ui.Text(c, a.t("Reload extensions or restart the agent / start a new session to finish. Existing activity may remain until the session ends or expires.")).FontSize(12)
					} else {
						if p.Status == "ready" && !a.removalDirty {
							label := "Remove %d Presence hook command(s)."
							if p.Kind == "entry" {
								label = "Remove %d Presence entry file."
							}
							if p.Kind != "hooks" && !a.removalAll {
								label = "Disable %d plugin event(s)."
							}
							ui.Text(c, a.t(label, p.Count)).FontSize(12)
							details := strings.Join(p.Details, "\n")
							ui.TextArea(c.Key("removal-details"), &details).Label(a.t("Removal preview")).ReadOnly(true).Height(140).Font("monospace").FontSize(11)
							muted(c, a.t("Existing files will be backed up. Other hooks and settings will be preserved."))
						} else if !a.removalDirty && p.Status == "not-found" {
							ui.Text(c, a.t("No integration found.")).FontSize(12)
						} else if !a.removalDirty {
							ui.Text(c, a.t("Manual removal required.")).FontSize(12)
						}
					}
					if !done || p.ManualReview {
						note := a.t(p.Note)
						if p.NoteAgent {
							note = a.agentText(p.Agent, p.Note)
						}
						ui.Text(c, note).FontSize(12)
					}
					if a.removalDirty {
						muted(c, a.t("Preview the updated selection before removing it."))
					} else {
						for _, warning := range p.Warnings {
							ui.Text(c, a.t(warning)).FontSize(11).TextColor(c.Theme().Warning)
						}
					}
					if a.removalError != "" {
						ui.Text(c, a.t(a.removalError)).TextColor(c.Theme().Danger).FontSize(12).Role(ui.RoleAlert)
					}
				})
			})
			ui.Row(c.Key("removal-actions")).Gap(10).AlignItems(ui.Center).Justify(ui.End).Padding(14, 0, 0, 0).BorderWidth(1, 0, 0, 0).BorderColor(c.Theme().Border).Children(func() {
				if !done && !a.removalAll && len(p.InstalledEvents) > 0 {
					muted(c, a.t("Selected %d event(s).", len(selectedIDs(p.Catalog, a.removalSelected)))).Grow(1)
				}
				label := "Cancel"
				if done || p.Status != "ready" {
					label = "Close"
				}
				ui.Button(c, a.t(label)).Disabled(a.busy).OnClick(func() { a.removalOpen = false })
				if (p.Kind != "managed" || !a.removalAll) && !done {
					ui.Button(c, a.t("Preview again")).Disabled(a.busy || (p.Kind != "managed" && strings.TrimSpace(a.removalPath) == "") || (!a.removalAll && len(selectedIDs(p.Catalog, a.removalSelected)) == 0)).OnClick(func() {
						request := map[string]any{"action": "uninstall-preview", "agent": p.Agent}
						if p.Kind != "managed" {
							request["path"] = a.removalPath
						}
						if !a.removalAll {
							request["events"] = selectedIDs(p.Catalog, a.removalSelected)
						}
						a.dispatch(request, "")
					})
				}
				if p.Status == "ready" && !done {
					label := "Remove integration"
					if !a.removalAll && len(p.InstalledEvents) > 0 {
						label = "Remove selected"
					}
					ui.Button(c, a.t(label)).TextColor(c.Theme().Danger).Disabled(a.busy || a.removalDirty || a.removalPath != p.Path).OnClick(func() {
						request := map[string]any{"action": "uninstall", "agent": p.Agent, "path": p.Path, "revision": p.Revision}
						if !a.removalAll {
							request["events"] = p.SelectedEvents
						}
						a.dispatch(request, "")
					})
				}
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
	heading(c, a.t("DISCORD PREVIEW"), "")
	ui.Row(c).Gap(5).Justify(ui.End).Margin(-34, 0, 12, 0).Children(func() {
		for _, theme := range []string{"Light", "Dark"} {
			ui.Button(c.Key("preview-"+theme), a.t(theme)).Label(a.t("%s profile card", a.t(theme))).FontSize(10).Padding(4, 7).OnClick(func() { a.prefs.PreviewTheme = theme; a.savePreferences() })
		}
	})
	act, s, draft := a.preview()
	var user *profile
	if a.running() {
		user = a.data.Status.Profile
	}
	name, username := a.t("Your Discord profile"), a.t("Connect Discord to show your profile")
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
				ui.Box(c).Absolute().Right(0).Bottom(0).Size(22, 22).Radius(11).Background(ui.Hex("#43a25a")).Border(5, dc.Background).Tooltip(a.t("Example status indicator"))
			})
			ui.Text(c, "···").Absolute().Right(16).Top(7).FontSize(22).TextColor(dc.TextMuted)
		})
		ui.Column(c).Padding(0, 12, 12, 12).Children(func() {
			ui.Column(c).Background(dc.Surface).Radius(8).Padding(13, 12).Gap(12).Children(func() {
				if act == nil {
					ui.Column(c).Padding(12, 0).Gap(10).Center().Children(func() {
						ui.Icon(c, icons["game"]).Size(26, 26).TextColor(dc.TextMuted)
						ui.Text(c, a.t("No activity to display")).FontSize(12).FontWeight(500)
						ui.Text(c, a.t("Your activity appears here when an agent starts working.")).FontSize(11).TextColor(dc.TextMuted).TextAlign(ui.Center)
					})
				} else {
					category := map[int]string{0: "Playing", 2: "Listening", 3: "Watching", 5: "Competing"}[act.Type]
					if category == "" {
						category = "Playing"
					}
					ui.Row(c).Children(func() {
						ui.Text(c, a.t(category)).FontSize(10).TextColor(dc.TextMuted).Grow(1)
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
								ui.Text(c, a.t("%d / %d members", act.Party.Size[0], act.Party.Size[1])).FontSize(11)
							}
							if act.Timestamps != nil {
								if act.Timestamps.End > 0 {
									remaining := max(int64(0), act.Timestamps.End-time.Now().Unix())
									ui.Text(c, a.t("%02d:%02d remaining", remaining/60, remaining%60)).FontSize(11).TextColor(dc.TextMuted)
								} else if act.Timestamps.Start > 0 {
									ui.Text(c, a.t("%s elapsed", elapsed(act.Timestamps.Start*1000))).FontSize(11).TextColor(dc.TextMuted)
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
	ui.Row(c).Gap(6).Justify(ui.Center).Margin(16, 0, 5, 0).Children(func() { dot(c, color); muted(c, a.t(label)) })
	muted(c, a.t("Final appearance depends on your Discord client.")).FontSize(10).TextAlign(ui.Center)
}
func (a *nativeApp) activityImage(c *ui.Context, act *activity, s *session, dc *ui.Theme) {
	ui.Box(c).Size(58, 58).Shrink(0).Background(dc.Border).Radius(9).Center().Tooltip(act.Assets.LargeText).Children(func() {
		if bitmap := a.images[act.Assets.LargeImage]; bitmap != nil {
			ui.Image(c, bitmap).Size(58, 58).Radius(9).Fit(ui.Cover)
		} else if s != nil {
			a.agentIcon(c, s.agent(), 42)
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
			a.agentIcon(c, id, 48)
			ui.Column(c).Grow(1).MinWidth(0).Gap(4).Children(func() {
				label := "Agent Discord Presence"
				if s != nil {
					label = a.agentLabel(s.agent())
				}
				muted(c, a.t(label))
				title := a.t("Waiting for an agent")
				if !a.running() {
					title = a.t("Service stopped")
				}
				if act != nil {
					title = act.Name
				}
				ui.Text(c, title).FontSize(14).FontWeight(500)
				if s != nil {
					muted(c, a.t(stateLabels[s.State])+" · "+elapsed(s.StartedAt))
				}
			})
		})
		ui.Divider(c)
		ui.Row(c).Margin(14, 0, 12, 0).Children(func() {
			ui.Text(c, a.t("Activity source")).FontSize(11).Grow(1)
			ui.Button(c, a.t("Use automatic")).FontSize(10).Disabled(!a.pinned() || a.busy).OnClick(func() { a.dispatch(map[string]any{"action": "pin", "key": nil}, "") })
		})
		ui.Scroll(c).Scrollbars(false).Grow(1).Children(func() {
			ui.Column(c).Children(func() {
				sessions := a.sessions()
				for _, s := range sessions {
					a.sessionRow(c, s, true)
				}
				if len(sessions) == 0 {
					muted(c, a.t("No active sessions")).Padding(25, 5)
				}
			})
		})
		if a.err != "" {
			ui.Text(c, a.t(a.err)).FontSize(11).TextColor(t.Danger).Margin(10, 0).Role(ui.RoleAlert)
		}
		ui.Divider(c)
		ui.Row(c).Gap(12).Padding(15, 0, 0, 0).Children(func() {
			ui.Button(c, a.t("Open main window")).FontSize(11).OnClick(a.bridge.OpenMain)
			ui.Spacer(c)
			label := "Start service"
			if a.running() {
				label = "Stop service"
			}
			ui.Button(c, a.t(label)).FontSize(11).Disabled(a.busy || a.data == nil).OnClick(a.power)
		})
	})
	if c.Shortcut(0, ui.KeyEscape) || c.Shortcut(ui.Cmd, ui.KeyW) {
		if a.bridge.panel != nil {
			a.bridge.panel.Hide()
		}
	}
}
