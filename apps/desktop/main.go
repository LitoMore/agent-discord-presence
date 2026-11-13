package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"log"
	"runtime"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

func trayIcon() []byte {
	img := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	ink := color.NRGBA{R: 98, G: 97, B: 215, A: 255}
	if runtime.GOOS == "darwin" {
		ink = color.NRGBA{A: 255}
	}
	for y := range 32 {
		for x := range 32 {
			dx, dy := x-16, y-16
			radius := dx*dx + dy*dy
			if radius < 10 || (radius >= 64 && radius <= 100 && (dx < -3 || dx > 3)) || (radius >= 169 && radius <= 210 && (dx < -6 || dx > 6)) {
				img.SetNRGBA(x, y, ink)
			}
		}
	}
	var data bytes.Buffer
	_ = png.Encode(&data, img)
	return data.Bytes()
}

func main() {
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	d := &Desktop{}
	a := newNativeApp(d)
	quitting := false
	mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) { quitting = true })
	mygo.App.OnWillQuit(func(*mygo.QuitEvent) {
		a.closed.Store(true)
		if a.cancel != nil {
			a.cancel()
		}
		d.close()
	})
	mygo.App.OnActivate(func(bool) {
		if d.main != nil {
			d.OpenMain()
		}
	})
	mygo.App.OnSecondInstance(func([]string, string) {
		if d.main != nil {
			d.OpenMain()
		}
	})
	mygo.App.WhenReady(func() {
		d.main = mygo.NewWindow(mygo.WindowOptions{
			Title: "Agent Discord Presence", Content: ui.View(a.view),
			Width: 1120, Height: 820, MinWidth: 760, MinHeight: 620,
			TitleBarStyle: mygo.TitleBarHiddenInset, TitleBarHeight: 52,
			Vibrancy: mygo.VibrancySidebar,
		})
		d.panel = mygo.NewWindow(mygo.WindowOptions{Title: "Presence", Content: ui.View(a.trayView), Width: 400, Height: 550,
			Hidden: true, Frameless: true, DisableResize: true, DisableMaximize: true, DisableMinimize: true, DisableFullScreen: true, AlwaysOnTop: true, SkipTaskbar: true})
		d.panel.OnBlur(d.panel.Hide)
		for _, win := range []*mygo.Window{d.main, d.panel} {
			win.OnClose(func(e *mygo.CloseEvent) {
				if !quitting {
					e.PreventDefault()
					win.Hide()
				}
			})
		}
		a.start()
		tray, err := mygo.NewTray(mygo.TrayOptions{Icon: trayIcon(), IconIsTemplate: true, ToolTip: "Agent Discord Presence"})
		if err != nil {
			log.Println("tray:", err)
			return
		}
		showPanel := func() {
			if d.panel.IsVisible() {
				d.panel.Hide()
				return
			}
			anchor := tray.Bounds()
			if anchor.Width == 0 {
				d.panel.Center()
			} else {
				area := mygo.Screen.DisplayNearestPoint(mygo.Point{X: anchor.X, Y: anchor.Y}).WorkArea
				bounds := d.panel.Bounds()
				x := max(area.X, min(anchor.X+(anchor.Width-bounds.Width)/2, area.X+area.Width-bounds.Width))
				y := anchor.Y + anchor.Height + 6
				if y+bounds.Height > area.Y+area.Height {
					y = anchor.Y - bounds.Height - 6
				}
				d.panel.SetPosition(x, max(area.Y, y))
			}
			d.panel.Show()
			d.panel.Focus()
		}
		menu := mygo.NewMenu([]*mygo.MenuItem{
			{Label: "Open main window", Click: func(*mygo.MenuItem, *mygo.Window) { d.OpenMain() }},
			{Label: "Quick panel", Click: func(*mygo.MenuItem, *mygo.Window) { showPanel() }},
			mygo.Separator(), {Role: mygo.RoleQuit, Label: "Quit Presence"},
		})
		if runtime.GOOS == "linux" {
			tray.SetMenu(menu)
		} else {
			tray.OnClick(showPanel)
			tray.OnRightClick(func() { tray.SetMenu(menu); defer tray.SetMenu(nil); tray.PopUpMenu() })
		}
		mygo.App.OnWillQuit(func(*mygo.QuitEvent) { tray.Destroy() })
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
