package main

import (
	"embed"
	"fmt"

	"github.com/egoist/mygo/ui"
)

//go:embed assets/agents/*
var agentAssets embed.FS

type agentArtwork struct{ Light, Dark ui.ImageSource }

func mustBitmap(path string) *ui.Bitmap {
	data, err := agentAssets.ReadFile("assets/agents/" + path)
	if err != nil {
		panic(err)
	}
	bitmap, err := ui.DecodeBitmap(data)
	if err != nil {
		panic(fmt.Sprintf("agent icon %s: %v", path, err))
	}
	return bitmap
}
func mustVector(path string) *ui.SVG {
	data, err := agentAssets.ReadFile("assets/agents/" + path)
	if err != nil {
		panic(err)
	}
	return ui.MustParseSVG(data)
}

var brandArt = map[string]agentArtwork{
	"codex":            {mustBitmap("codex-color.png"), mustBitmap("codex-color.png")},
	"claude-code":      {mustBitmap("claude-code.png"), mustBitmap("claude-code.png")},
	"opencode":         {mustVector("opencode-light.svg"), mustVector("opencode-dark.svg")},
	"pi":               {mustVector("pi.svg"), mustVector("pi.svg")},
	"deepseek-harness": {mustBitmap("deepseek-color.png"), mustBitmap("deepseek-color.png")},
}
