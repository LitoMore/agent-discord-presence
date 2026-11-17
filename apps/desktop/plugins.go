package main

import (
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

type agentDescriptor struct {
	ID, Name, Version, Description, Icon, Error string
	Enabled, Installed, Plugin                  bool
	ManagedIntegration                          bool
	Locales                                     map[string]map[string]string
}
type pluginInstallState struct {
	ID, Spec, Phase, Agent, Error string
	Bytes, Total                  int64
}

func (s *pluginInstallState) finished() bool {
	return s.Phase == "installed" || s.Phase == "failed" || s.Phase == "cancelled"
}
func (a *nativeApp) installingPlugin() bool {
	return a.data != nil && a.data.PluginInstall != nil && !a.data.PluginInstall.finished()
}
func (a *nativeApp) openPluginInstaller() {
	a.pluginSourceOpen, a.pluginSourceError, a.pluginSourcePreviousJob = true, "", ""
	a.pluginSourceLocal = false
	if a.data != nil && a.data.PluginInstall != nil {
		if a.data.PluginInstall.finished() {
			a.pluginSourcePreviousJob = a.data.PluginInstall.ID
		} else {
			a.pluginSource = a.data.PluginInstall.Spec
			a.pluginSourceLocal = !strings.HasPrefix(a.pluginSource, "github:")
		}
	}
}
func (a *nativeApp) pluginInstallDialog(c *ui.Context) {
	ui.Modal(c, &a.pluginSourceOpen, func() {
		ui.Column(c.Key("github-plugin-source")).Width(520).MaxWidthPercent(100).Gap(14).Children(func() {
			title := "Install from GitHub…"
			if a.pluginSourceLocal {
				title = "Install an Agent plugin"
			}
			ui.Text(c, a.t(title)).FontSize(19).FontWeight(600)
			if !a.pluginSourceLocal {
				caption := ui.Text(c, a.t("GitHub source")).FontSize(12)
				ui.TextInput(c, &a.pluginSource).LabelledBy(caption).Placeholder("github:OWNER/REPO#REF").MaxLength(4096).FillWidth().Disabled(a.busy || a.installingPlugin())
				muted(c, a.t("Public repositories only. Branch, tag, or commit is optional.")).FontSize(10)
			}
			if a.data != nil && a.data.PluginInstall != nil && a.data.PluginInstall.ID != a.pluginSourcePreviousJob {
				a.pluginInstallProgress(c)
			}
			if a.pluginSourceError != "" {
				ui.Text(c, a.t(a.pluginSourceError)).FontSize(11).TextColor(c.Theme().Danger).Role(ui.RoleAlert)
			}
			ui.Row(c).Gap(8).Justify(ui.End).Children(func() {
				ui.Button(c, a.t("Close")).Disabled(a.busy).OnClick(func() { a.pluginSourceOpen = false })
				if !a.pluginSourceLocal {
					ui.PrimaryButton(c, a.t("Install plugin")).Disabled(a.busy || a.installingPlugin() || strings.TrimSpace(a.pluginSource) == "").OnClick(func() {
						a.pluginSourceError = ""
						source := strings.TrimSpace(a.pluginSource)
						if !strings.HasPrefix(source, "github:") {
							a.pluginSourceError = "Use github:OWNER/REPO or github:OWNER/REPO#REF"
							return
						}
						a.dispatch(map[string]any{"action": "plugin-install-start", "source": source}, "")
					})
				}
			})
		})
	})
}
func (a *nativeApp) pluginInstallProgress(c *ui.Context) {
	if a.data == nil || a.data.PluginInstall == nil {
		return
	}
	s := a.data.PluginInstall
	labels := map[string]string{"resolving": "Resolving repository…", "downloading": "Downloading plugin…", "validating": "Checking plugin…", "installing": "Installing plugin…", "registering": "Registering plugin…", "cancelling": "Cancelling installation…", "installed": "Installed · waiting for Agent integration", "failed": "Plugin installation failed", "cancelled": "Plugin installation cancelled"}
	ui.Column(c.Key("plugin-install-progress")).Gap(8).Padding(12).Background(c.Theme().Surface).Radius(7).Margin(0, 0, 16, 0).Children(func() {
		ui.Row(c).Gap(10).AlignItems(ui.Center).Children(func() {
			ui.Text(c, a.t(labels[s.Phase])).FontSize(12).Grow(1)
			if !s.finished() {
				ui.Button(c, a.t("Cancel installation")).Disabled(a.busy || s.Phase == "registering" || s.Phase == "cancelling").OnClick(func() {
					a.dispatch(map[string]any{"action": "plugin-install-cancel", "id": s.ID}, "")
				})
			} else if s.Phase == "installed" && s.Agent != "" {
				ui.Button(c.Key("installed-plugin-setup"), a.t("Setup")).Disabled(a.busy).OnClick(func() {
					a.dispatch(map[string]any{"action": "integration", "agent": s.Agent, "language": a.prefs.Language}, "")
				})
			}
		})
		muted(c, s.Spec).FillWidth().SingleLine().Tooltip(s.Spec)
		if s.Phase == "downloading" && s.Bytes > 0 {
			text := fmt.Sprintf("%d KB", s.Bytes/1024)
			if s.Total > 0 {
				text = fmt.Sprintf("%d / %d KB (%d%%)", s.Bytes/1024, s.Total/1024, min(int64(100), s.Bytes*100/s.Total))
			}
			muted(c, text)
		}
		if s.Error != "" {
			ui.Text(c, a.t(s.Error)).FontSize(11).TextColor(c.Theme().Danger).Role(ui.RoleAlert)
		}
	})
}

// Plugin messages are scoped by Agent; they cannot override application labels.
func (a *nativeApp) agentText(id, message string) string {
	for _, agent := range a.agents() {
		if agent.ID == id && agent.Plugin {
			if translated := agent.Locales[a.prefs.Language][message]; translated != "" {
				return translated
			}
			return message
		}
	}
	return a.t(message)
}

func (a *nativeApp) agents() []agentDescriptor {
	if a.data != nil && a.data.Agents != nil {
		return a.data.Agents
	}
	result := []agentDescriptor{}
	for _, id := range agentIDs {
		result = append(result, agentDescriptor{ID: id, Name: agentLabels[id], Enabled: true, Installed: true})
	}
	return result
}
func (a *nativeApp) agentLabel(id string) string {
	for _, agent := range a.agents() {
		if agent.ID == id {
			return agent.Name
		}
	}
	if label := agentLabels[id]; label != "" {
		return label
	}
	return id
}
func (a *nativeApp) selectPlugin() {
	if a.busy || a.installingPlugin() || a.bridge.main == nil {
		return
	}
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: a.bridge.main, Title: a.t("Install an Agent plugin"), Directory: true})
	if err != nil {
		a.err = err.Error()
		return
	}
	if len(paths) == 1 {
		a.openPluginInstaller()
		a.pluginSourceLocal = true
		a.dispatch(map[string]any{"action": "plugin-install-start", "source": paths[0]}, "")
	}
}
func (a *nativeApp) refreshPluginIcons() {
	if a.pluginIcons == nil {
		a.pluginIcons = map[string]ui.ImageSource{}
		a.pluginIconData = map[string]string{}
	}
	seen := map[string]bool{}
	for _, agent := range a.agents() {
		seen[agent.ID] = true
		if a.pluginIconData[agent.ID] == agent.Icon {
			continue
		}
		delete(a.pluginIcons, agent.ID)
		a.pluginIconData[agent.ID] = agent.Icon
		parts := strings.SplitN(agent.Icon, ",", 2)
		if len(parts) != 2 {
			continue
		}
		raw, err := base64.StdEncoding.DecodeString(parts[1])
		if err != nil {
			continue
		}
		if strings.HasPrefix(parts[0], "data:image/svg+xml;") {
			if svg, err := ui.ParseSVG(raw); err == nil {
				a.pluginIcons[agent.ID] = svg
			}
		} else if bitmap, err := ui.DecodeBitmap(raw); err == nil {
			a.pluginIcons[agent.ID] = bitmap
		}
	}
	for id := range a.pluginIcons {
		if !seen[id] {
			delete(a.pluginIcons, id)
			delete(a.pluginIconData, id)
		}
	}
}
func (a *nativeApp) agentIcon(c *ui.Context, id string, size float32) {
	if image := a.pluginIcons[id]; image != nil {
		ui.Box(c).Size(size, size).Shrink(0).Radius(8).Border(1, c.Theme().Border).Background(c.Theme().Background).Center().Children(func() { ui.Image(c, image).Size(size*.68, size*.68).Fit(ui.Contain).TextColor(c.Theme().Text) })
		return
	}
	agentIcon(c, id, size)
}
func (a *nativeApp) pluginRemovalDialog(c *ui.Context) {
	id := a.pluginConfirm
	if id == "" {
		return
	}
	open := true
	if ui.Modal(c, &open, func() {
		ui.Column(c).Width(440).MaxWidthPercent(100).Gap(14).Children(func() {
			ui.Text(c, a.t("Remove %s plugin?", a.agentLabel(id))).FontSize(19).FontWeight(600)
			muted(c, a.t("Your settings and Agent-side files will be kept."))
			ui.Row(c).Gap(8).Justify(ui.End).Children(func() {
				ui.Button(c, a.t("Cancel")).OnClick(func() { a.pluginConfirm = "" })
				ui.PrimaryButton(c, a.t("Confirm removal")).Disabled(a.busy).OnClick(func() {
					a.pluginConfirm = ""
					a.dispatch(map[string]any{"action": "plugin-remove", "agent": id}, "Agent plugin removed.")
				})
			})
		})
	}).Dismissed() {
		a.pluginConfirm = ""
	}
}
