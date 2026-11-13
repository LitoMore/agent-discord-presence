# Agent artwork

These assets identify supported third-party agents. Their names and logos belong to their respective owners. They are embedded locally so session lists, setup screens, and the tray do not depend on remote image loading.

| Agent | Source |
| --- | --- |
| Codex | [`@lobehub/icons-static-png` 1.97.0](https://www.npmjs.com/package/@lobehub/icons-static-png/v/1.97.0), `light/codex-color.png`, matching the presence preset |
| Claude Code | The same LobeHub package, `light/claudecode-color.png` |
| OpenCode | [Official OpenCode brand assets](https://opencode.ai/brand), `opencode-logo-light.svg` and `opencode-logo-dark.svg` |
| Pi | [Official Pi site](https://pi.dev), `logo-auto.svg` |
| DeepSeek Harness | The same LobeHub package, `light/deepseek-color.png`, matching the colored presence preset. The [official Harness FishLogo](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-primitives/src/FishLogo.tsx) silhouette is also retained as a reference SVG. |

Codex and DeepSeek retain their brand colors in both themes. OpenCode selects the monochrome variant appropriate to the UI theme. Logos keep their proportions with `ui.Contain`; profile photos use `ui.Cover`.

LobeHub and Harness license texts are included alongside the assets. The app's live Discord activity images continue to follow the user's presence settings.
