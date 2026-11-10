# 电脑端后台服务 · Mac background agent (`wns`)

`wns` 是一个**零依赖**的 Node 小命令。它在你的 Mac 后台每 15 秒看一眼"有没有 AI 工具在跑、你人在不在电脑前"，然后把状态上报给服务器，朋友手机上的像素小人就会跟着动。

`wns` is a zero-dependency Node CLI. Every 15 s it checks whether an AI tool is running and whether you're at the keyboard, and reports that to the server so your pixel buddy moves on your friends' phones.

---

## 1. 需要什么权限？· Which macOS permissions does it need?

**都不需要。** 不需要「辅助功能 Accessibility」，不需要「输入监控 Input Monitoring」，不需要「完全磁盘访问 Full Disk Access」，也不需要「屏幕录制」或「自动化 Automation」。

**None.** No Accessibility, Input Monitoring, Full Disk Access, Screen Recording, or Automation permission.

| 它做的事 · What it does | 用的系统命令 · How | 需要授权？· Permission prompt? |
|---|---|---|
| 看有没有 AI 工具在运行 · detect AI tools | `/bin/ps -axww -o pid,ppid,etime,comm` / `-o pid,args` | 否 · no |
| AI 工具在哪个项目文件夹 · project folder name | `/usr/sbin/lsof -a -p <pid> -d cwd`（只看你自己的进程 · own processes only） | 否 · no |
| 你多久没碰键盘鼠标 · keyboard/mouse idle time | `/usr/sbin/ioreg -c IOHIDSystem` 读 `HIDIdleTime`（只是一个"空闲了多少纳秒"的数字，**读不到你按了什么键**） | 否 · no |
| 开机自启 · start at login | `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.whonotsleep.agent.plist` | 否 · no |

唯一可能看到的系统提示：macOS 13+ 安装后台项目时会弹一条通知「已添加后台项目」，在 **系统设置 → 通用 → 登录项与扩展 → 允许在后台** 里能看到 `node`，保持开启即可。

The only thing you may see is macOS 13+'s "Background item added" notification; keep `node` enabled under **System Settings → General → Login Items & Extensions → Allow in the Background**.

`wns` **不会**读取屏幕、键盘输入、文件内容、剪贴板、浏览器或聊天内容。

`wns` never reads your screen, keystrokes, file contents, clipboard, browser, or conversations.

---

## 2. 安装 · Install

需要 Node ≥ 18（`node -v` 查看；没有的话 `brew install node`）。

Requires Node ≥ 18 (`brew install node` if missing).

```bash
npm i -g github:Shiyao-Huang/whonotsleep
```

装好后就有 `wns` 命令。· This gives you the `wns` command.

> 用 `npx -y github:Shiyao-Huang/whonotsleep link ABC123` 可以免安装试一次，但**后台服务请用全局安装**：npx 的缓存目录会被清理，开机自启会找不到脚本。
>
> `npx` works for a one-off try, but use the global install for the background agent — the npx cache can be wiped, which breaks the login item.

## 3. 连接你的房间 · Link to your room

在手机 App 里：**房间 → 连接电脑**，拿到 6 位配对码（10 分钟有效、只能用一次）。

In the phone app: **Room → Link computer** gives a 6-character code (valid 10 min, single use).

```bash
wns link ABC123
```

这一步会把你的成员身份存到 `~/.config/whonotsleep/config.json`（权限 600，只有你能读）。电脑和手机是**同一个小人**。

This saves your member credentials to `~/.config/whonotsleep/config.json` (mode 600). Your Mac and phone are the same buddy.

## 4. 启动后台服务 · Start the background service

```bash
wns install
```

- 写入 `~/Library/LaunchAgents/com.whonotsleep.agent.plist`（`RunAtLoad` + `KeepAlive`：开机/登录自动运行，崩溃自动拉起）
- 日志：`~/Library/Logs/whonotsleep.log`
- 立即生效，不需要重启

Writes a LaunchAgent (`RunAtLoad` + `KeepAlive`), logs to `~/Library/Logs/whonotsleep.log`, takes effect immediately.

检查是否在跑 · Check it's running:

```bash
wns status
```

### 可选：Claude Code 秒同步 · Optional: instant Claude Code sync

```bash
wns hook install
```

在 `~/.claude/settings.json` 的 `UserPromptSubmit` / `Stop` 钩子里加一条 `wns ping --quiet --detach`（后台执行，不拖慢提问；改之前会自动备份，非破坏性合并）。不装也行，只是最多慢 20 秒左右。

Adds `wns ping --quiet --detach` to Claude Code's `UserPromptSubmit`/`Stop` hooks (backed up, merged non-destructively). Without it presence still updates within ~15 s.

---

## 5. 日常命令 · Everyday commands

```bash
wns gn            # 说晚安 🌙（14 小时内又开 AI，或 0–6 点还在用 AI，就会被抓包）
wns morning       # 说早安 ☀️
wns say 冲冲冲     # 头上冒个对话泡
wns emote heart @小明
wns room          # 看房间里谁在干嘛
wns status        # 一览：配置、守护进程、当前检测结果、房间
wns detect        # 调试：只看本机检测结果
```

## 6. 识别哪些 AI · What counts as "using AI"

CLI：`claude`（Claude Code，含桌面版和 VS Code 扩展里的）、`codex`、`gemini`、`cursor-agent`、`copilot`、`aider`、`opencode`、`goose`、`amp`
桌面 App：Claude、ChatGPT、Cursor 等（只有没有 CLI 工具在跑时才算）

自定义更多工具 · Add your own (regex matched against the command line):

```json
// ~/.config/whonotsleep/config.json
{ "extraTools": { "kimi": "kimi-cli", "crush": "(^|/)crush$" } }
```

其它配置 · Other options:

| 键 key | 默认 default | 说明 |
|---|---|---|
| `shareDetail` | `true` | 是否上报项目文件夹名（如 `whonotsleep`）· share the project folder name |
| `countApps` | `true` | 桌面 App 是否算"在用 AI" · count desktop apps |
| `awayAfterMinutes` | `5` | 多久没动键鼠算离开（椅子变空）· idle minutes before "away" |

改完配置无需重启，下一轮检测就生效。· Changes apply on the next cycle.

## 7. 上报了什么 · What is sent

每 20 秒（或状态变化时立刻）发一次：

```json
{ "status": "working", "tool": "claude", "detail": "whonotsleep", "tzOffset": 480 }
```

只有这四个字段。`status` 是 `working | idle | away`。服务器 90 秒收不到心跳就把你显示为离线。

Only these four fields. The server marks you offline after 90 s without a heartbeat.

## 8. 停止 / 卸载 · Stop / uninstall

```bash
wns uninstall     # 移除开机自启并停止 · remove the LaunchAgent
wns hook uninstall
wns logout        # 删除本地配置 · forget credentials
npm rm -g whonotsleep
rm -rf ~/.config/whonotsleep ~/.local/share/whonotsleep ~/Library/Logs/whonotsleep.log   # 清理残留 · leftovers
```

## 9. 常见问题 · Troubleshooting

| 现象 | 处理 |
|---|---|
| `wns status` 显示守护没在跑 | `wns uninstall && wns install`，再看 `~/Library/Logs/whonotsleep.log` |
| 从桌面/文稿/下载里的源码目录运行了 `wns install`，后台跑不起来 | macOS 会限制后台进程读这些目录，请用 `npm i -g` 安装后再 `wns install` |
| 升级/切换了 Node（nvm、brew upgrade） | LaunchAgent 记的是绝对路径，重新 `wns install` 一次 |
| 开着 AI 但小人没坐下 | `wns detect` 看识别结果；不认识的工具加到 `extraTools` |
| 公司网络 | 服务器走标准 HTTPS 443 端口；需要能访问 `wns.168-231-73-244.sslip.io` |
| 想换服务器（自己部署） | `wns link CODE --server https://你的服务器` |
