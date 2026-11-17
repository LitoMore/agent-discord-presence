package main

import (
	"encoding/base64"
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
	if a.busy || a.bridge.main == nil {
		return
	}
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: a.bridge.main, Title: a.t("Install an Agent plugin"), Directory: true})
	if err != nil {
		a.err = err.Error()
		return
	}
	if len(paths) == 1 {
		a.dispatch(map[string]any{"action": "plugin-install", "path": paths[0]}, "Agent plugin installed.")
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
func (a *nativeApp) pluginRemoval(c *ui.Context, agent agentDescriptor) {
	if a.pluginConfirm != agent.ID {
		return
	}
	ui.Column(c).Padding(14).Gap(10).Background(c.Theme().Surface).Radius(7).Children(func() {
		ui.Text(c, a.t("Remove %s plugin?", agent.Name)).FontSize(12).FontWeight(500)
		muted(c, a.t("Your settings and Agent-side files will be kept."))
		ui.Row(c).Gap(8).Justify(ui.End).Children(func() {
			ui.Button(c, a.t("Cancel")).OnClick(func() { a.pluginConfirm = "" })
			ui.PrimaryButton(c, a.t("Confirm removal")).Disabled(a.busy).OnClick(func() {
				a.pluginConfirm = ""
				a.dispatch(map[string]any{"action": "plugin-remove", "agent": agent.ID}, "Agent plugin removed.")
			})
		})
	})
}
