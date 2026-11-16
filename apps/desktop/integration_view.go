package main

import (
	"strings"
	"time"

	"github.com/egoist/mygo/ui"
)

func selectionMap(events []string) map[string]bool {
	result := map[string]bool{}
	for _, event := range events {
		result[event] = true
	}
	return result
}
func selectedIDs(catalog []integrationEvent, selected map[string]bool) []string {
	result := []string{}
	for _, event := range catalog {
		if selected[event.ID] {
			result = append(result, event.ID)
		}
	}
	return result
}
func toggleEvent(catalog []integrationEvent, selected map[string]bool, id string, enabled, removing bool) {
	selected[id] = enabled
	// Enabling a plugin capability includes its prerequisites. Disabling a
	// prerequisite also disables dependents, so paired events stay consistent.
	for range len(catalog) {
		for _, event := range catalog {
			for _, dependency := range event.Requires {
				if removing {
					if enabled && selected[dependency] {
						selected[event.ID] = true
					}
					if !enabled && !selected[event.ID] {
						selected[dependency] = false
					}
				} else {
					if enabled && selected[event.ID] {
						selected[dependency] = true
					}
					if !enabled && !selected[dependency] {
						selected[event.ID] = false
					}
				}
			}
		}
	}
}
func (a *nativeApp) eventChoices(c *ui.Context, catalog []integrationEvent, selected map[string]bool, removing bool, changed func()) {
	groups := []struct{ id, label string }{
		{"presence", "Work status"}, {"tools", "Tool activity"}, {"waiting", "Waiting status"},
		{"errors", "Error status"}, {"summary", "Reply collection"}, {"cleanup", "Session cleanup"}, {"", "Other events"},
	}
	ui.Column(c).Gap(20).Children(func() {
		for _, group := range groups {
			var events []integrationEvent
			for _, event := range catalog {
				if event.Capability == group.id {
					events = append(events, event)
				}
			}
			if len(events) == 0 {
				continue
			}
			ui.Column(c.Key(group.id)).Gap(8).Children(func() {
				var optional []integrationEvent
				checked := true
				for _, event := range events {
					if !event.Required {
						optional = append(optional, event)
						checked = checked && selected[event.ID]
					}
				}
				if !removing && len(optional) > 0 {
					if ui.Checkbox(c.Key("group-toggle"), &checked, a.t(group.label)).FontSize(11).FontWeight(600).TextColor(c.Theme().TextMuted).Disabled(a.busy).Changed() {
						for _, event := range optional {
							toggleEvent(catalog, selected, event.ID, checked, false)
						}
						changed()
					}
				} else {
					ui.Text(c, a.t(group.label)).FontSize(11).FontWeight(600).TextColor(c.Theme().TextMuted)
				}
				ui.Column(c).Border(1, c.Theme().Border).Radius(8).Children(func() {
					for index, event := range events {
						value := selected[event.ID]
						row := ui.Column(c.Key(event.ID)).Gap(5).Padding(12, 14)
						if index > 0 {
							row.BorderWidth(1, 0, 0, 0).BorderColor(c.Theme().Border)
						}
						if value {
							row.Background(c.Theme().Accent.Alpha(.045))
						}
						row.Children(func() {
							ui.Row(c).Gap(10).Children(func() {
								if ui.Checkbox(c, &value, event.ID).FontSize(12).FontWeight(500).Grow(1).Disabled(a.busy || event.Required).Tooltip(a.t(event.Description)).Changed() {
									toggleEvent(catalog, selected, event.ID, value, removing)
									changed()
								}
								if event.Required {
									muted(c, a.t("Required")).FontSize(10).Padding(3, 6).Background(c.Theme().Surface).Radius(4)
								}
							})
							ui.Column(c).Padding(0, 0, 0, 24).Gap(3).Children(func() {
								muted(c, a.t(event.Description))
								if event.Source != "" {
									muted(c, a.t("Via %s", event.Source)).FontSize(10)
								}
							})
						})
					}
				})
			})
		}
	})
}
func (a *nativeApp) setupChanged() {
	a.setupDirty = true
	a.setupResult = nil
	a.setupProfile = "Custom"
	a.setupCopiedUntil = time.Time{}
}
func integrationScrollHeight(c *ui.Context) float32 {
	_, height := c.Size()
	return max(240, min(600, height-180))
}
func (a *nativeApp) integrationFileField(c *ui.Context, key string, path *string, disabled bool, changed func()) {
	ui.Column(c).Gap(7).Padding(12, 14).Background(c.Theme().Surface).Radius(8).Children(func() {
		ui.Text(c, a.t("Integration file")).FontSize(11).FontWeight(500).TextColor(c.Theme().TextMuted)
		if ui.TextInput(c.Key(key), path).Label(a.t("Integration file")).FillWidth().Disabled(disabled).Changed() {
			changed()
		}
		if !disabled {
			muted(c, a.t("For project or custom configuration, enter its exact file path and preview again."))
		}
	})
}
func (a *nativeApp) managedSetupDialog(c *ui.Context) {
	p := a.setupPlan
	ui.Modal(c, &a.setupOpen, func() {
		ui.Column(c).Width(640).MaxWidthPercent(100).Gap(18).Children(func() {
			ui.Text(c, a.t("Set up %s", agentLabels[p.Agent])).FontSize(19).FontWeight(600)
			ui.Segmented(c, &a.setupMode, a.t("Agent prompt"), a.t("Manual configuration"), a.t("Direct configuration")).FillEqually().Label(a.t("Setup method"))
			ui.Scroll(c).Scrollbars(false).Height(integrationScrollHeight(c) - 42).Children(func() {
				ui.Column(c).Gap(20).Children(func() {
					if a.setupMode == 2 {
						a.integrationFileField(c, "setup-path", &a.setupPath, a.busy || p.Kind == "policy", a.setupChanged)
						ui.Column(c).Gap(7).Children(func() {
							ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
								ui.Text(c, a.t("Events to register")).FontSize(13).FontWeight(600).Grow(1)
								if a.selectValue(c, &a.setupProfile, []string{"Recommended", "Lightweight", "Custom"}).Label(a.t("Configuration profile")).Tooltip(a.t("Configuration profile")).Width(140).FontSize(11).Disabled(a.busy).Changed() {
									if a.setupProfile != "Custom" {
										a.setupSelected = map[string]bool{}
										for _, event := range p.Catalog {
											a.setupSelected[event.ID] = a.setupProfile == "Recommended" || event.Required || (event.Capability != "waiting" && event.Capability != "tools" && event.Capability != "summary")
										}
										a.setupDirty = true
										a.setupResult = nil
									}
								}
								ui.Button(c, a.t("Select all")).FontSize(11).Disabled(a.busy).OnClick(func() {
									a.setupSelected = map[string]bool{}
									for _, event := range p.Catalog {
										a.setupSelected[event.ID] = true
									}
									a.setupChanged()
								})
								ui.Button(c, a.t("Clear selection")).FontSize(11).Disabled(a.busy).OnClick(func() {
									a.setupSelected = map[string]bool{}
									for _, event := range p.Catalog {
										if event.Required {
											toggleEvent(p.Catalog, a.setupSelected, event.ID, true, false)
										}
									}
									a.setupChanged()
								})
							})
							ui.Row(c).Gap(12).AlignItems(ui.Start).Children(func() {
								muted(c, a.t("Select the events you want to register.")).Grow(1)
								label := "Detected %d registered event(s)."
								if p.Kind == "policy" {
									label = "Saved %d policy event(s)."
								}
								muted(c, a.t(label, len(p.InstalledEvents))).Shrink(0)
							})
						})
						a.eventChoices(c, p.Catalog, a.setupSelected, false, a.setupChanged)
						if a.setupDirty {
							muted(c, a.t("Preview the updated selection before applying or copying it."))
						} else {
							ui.Column(c).Gap(8).Padding(12, 14).Background(c.Theme().Surface).Radius(8).Children(func() {
								ui.Text(c, a.t("Configuration preview")).FontSize(12).FontWeight(500)
								ui.Text(c, a.t("Add: %s", strings.Join(p.Added, ", "))).FontSize(11)
								ui.Text(c, a.t("Keep: %s", strings.Join(p.Kept, ", "))).FontSize(11)
								ui.Text(c, a.t("Remove: %s", strings.Join(p.Removed, ", "))).FontSize(11)
							})
							for _, warning := range p.Warnings {
								ui.Text(c, a.t(warning)).FontSize(11).TextColor(c.Theme().Warning)
							}
							ui.Text(c, a.t(p.Note)).FontSize(11)
							if p.Status == "unchanged" {
								ui.Text(c, a.t("Already configured.")).FontSize(11)
							}
						}
					} else {
						content, label := &a.setup.Prompt, "Setup prompt"
						if a.setupMode == 1 {
							content, label = &a.setup.Content, "Integration configuration"
						}
						ui.TextArea(c.Key(a.setupMode), content).Label(a.t(label)).ReadOnly(true).Height(240).Font("monospace").FontSize(11)
					}
					if a.setupResult != nil {
						ui.Text(c, a.t("Configuration applied. Reload the agent or start a new session.")).TextColor(c.Theme().Success).Role(ui.RoleStatus)
						if a.setupResult.Backup != "" {
							ui.Text(c, a.t("Backup: %s", a.setupResult.Backup)).FontSize(11).Selectable()
						}
					}
					if a.setupError != "" {
						ui.Text(c, a.t(a.setupError)).TextColor(c.Theme().Danger).Role(ui.RoleAlert)
					}
					if a.setupCopyError != "" {
						ui.Text(c, a.t(a.setupCopyError)).TextColor(c.Theme().Danger).Role(ui.RoleAlert)
					}
				})
			})
			ui.Row(c).Gap(10).AlignItems(ui.Center).Justify(ui.End).Padding(14, 0, 0, 0).BorderWidth(1, 0, 0, 0).BorderColor(c.Theme().Border).Children(func() {
				if a.setupMode == 2 {
					muted(c, a.t("Selected %d event(s).", len(selectedIDs(p.Catalog, a.setupSelected)))).Grow(1)
				}
				ui.Button(c, a.t("Close")).Disabled(a.busy).OnClick(func() { a.setupOpen = false })
				if a.setupMode == 2 {
					ui.Button(c, a.t("Preview configuration")).Disabled(a.busy || len(selectedIDs(p.Catalog, a.setupSelected)) == 0).OnClick(func() {
						request := map[string]any{"action": "integration", "agent": p.Agent, "language": a.prefs.Language, "events": selectedIDs(p.Catalog, a.setupSelected)}
						if p.Kind != "policy" {
							request["path"] = a.setupPath
						}
						a.dispatch(request, "")
					})
					ui.PrimaryButton(c, a.t("Apply configuration")).Disabled(a.busy || a.setupDirty || p.Status != "ready" || a.setupResult != nil).OnClick(func() {
						a.dispatch(map[string]any{"action": "setup", "agent": p.Agent, "events": p.SelectedEvents, "path": p.Path, "revision": p.Revision}, "")
					})
				} else {
					label := "Copy prompt"
					if a.setupMode == 1 {
						label = "Copy configuration"
					}
					copied := c.Now().Before(a.setupCopiedUntil)
					if copied {
						label = "Copied"
						c.After(a.setupCopiedUntil.Sub(c.Now()))
						muted(c, a.t("Copied to clipboard."))
					}
					ui.PrimaryButton(c, a.t(label)).Disabled(a.busy || a.setupDirty).OnClick(func() {
						content := a.setup.Prompt
						if a.setupMode == 1 {
							content = a.setup.Content
						}
						at, services, mode, setup := c.Now(), c.Services(), a.setupMode, a.setup
						a.setupCopyError = ""
						c.WriteClipboardThen(content, func(err error) {
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
				}
			})
		})
	})
}
