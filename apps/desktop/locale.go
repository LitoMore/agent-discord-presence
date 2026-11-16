package main

import (
	"fmt"

	"github.com/egoist/mygo/ui"
)

const (
	languageEnglish = "en"
	languageChinese = "zh-CN"
)

// English source messages are the fallback for missing or unsupported translations.
// Keep protocol values, user content, and published Discord activity out of this catalog.
var chineseMessages = map[string]string{
	"Overview":                              "概览",
	"Agents":                                "智能体",
	"Appearance":                            "外观",
	"Summaries":                             "摘要",
	"Preferences":                           "偏好设置",
	"Your agents at work, at a glance.":     "一览智能体的工作状态。",
	"Connect once. Keep your work in sync.": "连接智能体，同步工作状态。",
	"Make every line feel like you.":        "自定义你的活动展示。",
	"Turn your work into a clear, concise activity.":          "将工作内容转化为清晰简洁的活动摘要。",
	"Manage appearance and your local service.":               "管理语言、外观和本地服务。",
	"YOUR WORK, VISIBLE.":                                     "让工作状态可见",
	"STAY IN SYNC":                                            "保持同步",
	"Start service":                                           "启动服务",
	"Stop service":                                            "停止服务",
	"Configuration file error: %s":                            "配置文件错误：%s",
	"The service is using its last valid configuration.":      "服务正在使用上一次有效的配置。",
	"One local service · All your agents":                     "一个本地服务 · 连接所有智能体",
	"Service stopped":                                         "服务已停止",
	"Local service running":                                   "本地服务运行中",
	"Connecting to the local service…":                        "正在连接本地服务…",
	"Active sessions  %d":                                     "活跃会话  %d",
	"Current sessions only":                                   "仅显示当前会话",
	"Automatic selection":                                     "自动选择",
	"Shows the most recently active working session":          "显示最近活跃的工作会话",
	"Pinned session":                                          "已固定会话",
	"Keeps the selected session visible":                      "持续显示所选会话",
	"Use automatic":                                           "自动选择",
	"Enabled":                                                 "已启用",
	"Click a session to pin it to your Discord activity.":     "点击会话，将其固定为 Discord 活动。",
	"The local service is stopped":                            "本地服务已停止",
	"Start the service to receive activity from your agents.": "启动服务以接收智能体的活动。",
	"Waiting for your agent":                                  "等待智能体",
	"Connect an agent and start a task. Your session will appear here.": "连接智能体并开始任务，会话就会显示在这里。",
	"Set up an agent":                   "配置智能体",
	"Recent events":                     "最近事件",
	"Since opening the app":             "自本次打开应用以来",
	"No events yet":                     "暂无事件",
	"Just now":                          "刚刚",
	"%dm ago":                           "%d 分钟前",
	"Pin %s: %s":                        "固定 %s：%s",
	"Coding with %s":                    "正在使用 %s 编程",
	"Showing":                           "显示中",
	"Pinned":                            "已固定",
	"Working":                           "工作中",
	"Waiting for input":                 "等待输入",
	"Idle":                              "空闲",
	"Needs attention":                   "需要处理",
	"Closed":                            "已关闭",
	"Your agents":                       "你的智能体",
	"5 supported agents":                "支持 5 个智能体",
	"No sessions detected":              "未检测到会话",
	"%d active sessions":                "%d 个活跃会话",
	"Setup":                             "配置",
	"Set up %s":                         "配置 %s",
	"One service. Individual settings.": "统一服务，独立设置。",
	"Agents inherit global settings. Override their summary model and appearance individually.": "智能体默认继承全局设置，也可单独设置摘要模型和外观。",
	"Manage agent settings": "管理智能体设置",
	"Global · All agents":   "全局 · 所有智能体",
	"Settings scope":        "设置范围",
	"Global settings":       "全局设置",
	"Agent override":        "智能体独立设置",
	"Display":               "展示",
	"Automatic summaries":   "自动摘要",
	"Restore defaults":      "恢复默认",
	"Inherit global":        "继承全局设置",
	"Save changes":          "保存更改",
	"Activity type":         "活动类型",
	"Playing":               "正在玩",
	"Listening":             "正在听",
	"Watching":              "正在看",
	"Competing":             "正在竞赛",
	"Activity name":         "活动名称",
	"{topic} Work summary · {agent} Agent name": "{topic} 工作摘要 · {agent} 智能体名称",
	"Details": "详情",
	"{phase} Activity state; leave blank to hide this line": "{phase} 活动状态；留空则隐藏此行",
	"Subtitle": "副标题",
	"{subtitle} Summary subtitle; leave blank to hide this line": "{subtitle} 摘要副标题；留空则隐藏此行",
	"Show elapsed time":                                           "显示已用时间",
	"Show activity image":                                         "显示活动图片",
	"Custom large image":                                          "自定义大图",
	"HTTPS image URL or Discord asset key":                        "HTTPS 图片地址或 Discord 资源键",
	"Leave blank to use the default agent icon.":                  "留空则使用默认智能体图标。",
	"Generate summaries automatically":                            "自动生成摘要",
	"Model source":                                                "模型来源",
	"Follow agent session":                                        "跟随智能体会话",
	"Custom compatible service":                                   "自定义兼容服务",
	"Use the model and provider from the current session.":        "使用当前会话的模型和服务提供商。",
	"Service URL":                                                 "服务地址",
	"API key environment variable":                                "API 密钥环境变量",
	"Enter the variable name. The local service reads its value.": "输入变量名，本地服务会读取其值。",
	"Model override":                                              "指定模型",
	"Leave blank to follow the current session":                   "留空则跟随当前会话",
	"Optional":      "可选",
	"Custom prompt": "自定义提示词",
	"Keep summaries concise, specific, and relaxed.": "让摘要简洁、具体、自然。",
	"Summary length": "摘要长度",
	"%d characters":  "%d 个字符",
	"Lifecycle updates continue when automatic summaries are off.": "关闭自动摘要后，仍会继续更新会话状态。",
	"Language":              "语言",
	"Interface language":    "界面语言",
	"Theme":                 "主题",
	"System":                "跟随系统",
	"Light":                 "浅色",
	"Dark":                  "深色",
	"Service & connections": "服务与连接",
	"Stopped":               "已停止",
	"Running":               "运行中",
	"Local service":         "本地服务",
	"Process":               "进程",
	"Configuration file":    "配置文件",
	"Local socket":          "本地套接字",
	"Refresh connection":    "刷新连接",
	"Closing the window keeps Presence in the tray. Quitting the app leaves the background service running.": "关闭窗口后，Presence 会保留在托盘中；退出应用后，后台服务仍会继续运行。",
	"Agent prompt":         "智能体提示词",
	"Manual configuration": "手动配置",
	"Setup method":         "配置方式",
	"Copy prompt":          "复制提示词",
	"Setup prompt":         "配置提示词",
	"Paste this prompt into %s and let it configure the integration for you.": "将此提示词粘贴到 %s，让它为你完成集成配置。",
	"Copy configuration":        "复制配置",
	"Integration configuration": "集成配置",
	"Copied to clipboard.":      "已复制到剪贴板。",
	"Close":                     "关闭",
	"Copied":                    "已复制",
	"Could not copy. Select and copy the text manually.": "复制失败，请选中文本并手动复制。",
	"Merge these hooks into your configuration, preserving existing hooks. Review and trust them in Codex /hooks, then start a new session.": "将这些钩子合并到配置中，保留现有钩子。在 Codex /hooks 中检查并信任它们，然后开始新会话。",
	"Merge these hooks into your configuration, preserving existing settings, then restart Claude Code.":                                     "将这些钩子合并到配置中，保留现有设置，然后重启 Claude Code。",
	"Save this content to the plugin file, then reload extensions or restart your agent.":                                                    "将此内容保存到插件文件，然后重新加载扩展或重启智能体。",
	"Run this command in your terminal, replacing web with your Harness profile, then restart Harness.":                                      "在终端中运行此命令，将 web 替换为你的 Harness 配置名称，然后重启 Harness。",
	"DISCORD PREVIEW":                                          "DISCORD 预览",
	"%s profile card":                                          "%s个人资料卡片",
	"Your Discord profile":                                     "你的 Discord 个人资料",
	"Connect Discord to show your profile":                     "连接 Discord 以显示个人资料",
	"Example status indicator":                                 "状态指示示例",
	"No activity to display":                                   "暂无可展示的活动",
	"Your activity appears here when an agent starts working.": "智能体开始工作后，活动就会显示在这里。",
	"%d / %d members":                                          "%d / %d 位成员",
	"%02d:%02d remaining":                                      "剩余 %02d:%02d",
	"%s elapsed":                                               "已用 %s",
	"Local preview":                                            "本地预览",
	"Dry run · Activity is not published":                      "试运行 · 活动未发布",
	"Synced to Discord":                                        "已同步到 Discord",
	"Unsaved appearance preview":                               "未保存的外观预览",
	"Final appearance depends on your Discord client.":         "最终外观以你的 Discord 客户端为准。",
	"Waiting for an agent":                                     "等待智能体",
	"Activity source":                                          "活动来源",
	"No active sessions":                                       "暂无活跃会话",
	"Open main window":                                         "打开主窗口",
	"Quick panel":                                              "快捷面板",
	"Quit Presence":                                            "退出 Presence",
	"Connected to the local service":                           "已连接本地服务",
	"Local service stopped":                                    "本地服务已停止",
	"Connected to Discord":                                     "已连接 Discord",
	"Discord connected":                                        "Discord 已连接",
	"Dry run":                                                  "试运行",
	"Waiting for Discord":                                      "等待 Discord 连接",
	"Local service started.":                                   "本地服务已启动。",
	"Service stopped and Discord activity cleared.":            "服务已停止，Discord 活动已清除。",
	"Activity name cannot be empty.":                           "活动名称不能为空。",
	"Settings saved. The service will apply them automatically.": "设置已保存，服务将自动应用。",
	"Settings reset.":              "设置已重置。",
	"Resumed automatic selection.": "已恢复自动选择。",
	"Session pinned.":              "会话已固定。",
	"Connection status refreshed.": "连接状态已刷新。",
	"Local service files were not found. Run npm run build from the repository root, or rebuild the desktop app.": "未找到本地服务文件。请在项目根目录运行 npm run build，或重新构建桌面应用。",
	"Node.js 22+ was not found. Install Node.js or set ADP_NODE to its executable path.":                          "未找到 Node.js 22 或更高版本。请安装 Node.js，或将 ADP_NODE 设为其可执行文件路径。",
	"The local service connection was interrupted. Please retry.":                                                 "本地服务连接已中断，请重试。",
	"The local service did not respond in time. Please retry.":                                                    "本地服务响应超时，请重试。",
}

func (a *nativeApp) t(message string, args ...any) string {
	if a.prefs.Language == languageChinese {
		if translated, ok := chineseMessages[message]; ok {
			message = translated
		}
	}
	if len(args) > 0 {
		return fmt.Sprintf(message, args...)
	}
	return message
}

// Translate option labels while retaining the original values in settings and drafts.
func (a *nativeApp) selectValue(c *ui.Context, value *string, options []string) ui.Element {
	t := c.Theme()
	selectBox := ui.SelectBase(c, value)
	button := selectBox.Trigger
	background := t.Surface
	if button.Pressed() {
		background = t.SurfacePressed
	} else if button.Hovered() {
		background = t.SurfaceHover
	}
	button.Padding(t.Space(1.5), t.Space(3.5)).Gap(t.Space(1.5)).Radius(t.Radius).
		Border(1, t.Border).Background(background).TextColor(t.Text).
		MinWidth(t.Space(35)).Justify(ui.SpaceBetween).Value(a.optionLabel(*value)).Children(func() {
		ui.Text(c, a.optionLabel(*value)).SingleLine()
		ui.Icon(c, icons["chevron"]).Size(t.Space(2.5), t.Space(2.5)).TextColor(t.TextMuted)
	})
	selectBox.Popup(func(panel ui.Element) {
		panel.Margin(t.Space(1), 0, 0, 0).Padding(t.Space(1)).Radius(t.Radius+2).
			Background(t.Background).Border(1, t.Border).Shadow(0, 6, 20, 0, ui.RGBA(0, 0, 0, .18))
		for _, option := range options {
			item := selectBox.Item(option).Label(a.optionLabel(option)).Padding(t.Space(1.5), t.Space(2.5)).Radius(t.Radius)
			if item.Highlighted() {
				item.Background(t.Accent).TextColor(t.AccentText)
			} else if option == *value {
				item.Background(t.Surface)
			}
			item.Children(func() { ui.Text(c, a.optionLabel(option)).SingleLine() })
		}
	})
	return button
}

func (a *nativeApp) optionLabel(value string) string {
	switch value {
	case languageEnglish:
		return "English"
	case languageChinese:
		return "简体中文"
	default:
		return a.t(value)
	}
}

func (a *nativeApp) sessionTitle(s session) string {
	if s.Summary != nil {
		return s.Summary.Topic
	}
	return a.t("Coding with %s", agentLabels[s.agent()])
}
