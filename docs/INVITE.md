# 邀请朋友 · How friends join

## 1. 手机装 App

- **Android**：找房主要 `WhoNotSleep.apk` 安装包（微信/AirDrop 发过来即可），点开安装（第一次会提示「允许安装未知来源应用」，允许即可）。也可以自己编译：`cd app && npx expo run:android --variant release`。
- **iPhone**：暂时还没有上架 / TestFlight。会开发的朋友可以克隆仓库后 `cd app && npx expo run:ios --device` 自己装。

## 2. 进房间

打开 App → 起名字、捏小人 → **加入房间**，输入房主发来的 **5 位房间号**（例如 `ABCDE`）。
房主在房间页点房间号旁边的「点我分享」就能把房间号发出去。

## 3. 连上自己的电脑（Mac）

在 App 房间页点右上角 **💻** → 拿到 **6 位配对码**（10 分钟有效）→ 在 Mac 终端运行：

```bash
npm i -g github:Shiyao-Huang/whonotsleep
wns link 配对码
wns install
```

完成！以后只要你电脑上开着 Claude Code / Codex / Gemini / Cursor 等 AI，你的像素小人就会坐到桌前敲键盘。
不需要任何系统权限（辅助功能、输入监控都不用）。详细说明见 [MAC_AGENT.md](MAC_AGENT.md)。

## 4. 加桌面组件

- **Android**：长按桌面空白处 → 小组件 / 插件 → 找到 **WhoNotSleep**，有「房间」(4×2) 和「小人」(2×2) 两种。
- **iPhone**：长按桌面 → 左上角 **+** → 搜 WhoNotSleep。

## 5. 玩法

- 🌙 睡前点「晚安」。说了晚安又偷偷开 AI → 你头上冒大红 **!**，睡着的朋友头上全是 **?**
- 点别人的小人发表情；💬 冒个泡；🤖 AI 小管家可以帮你换造型、说晚安、生成配对码……直接用中文跟它说。

---

## 给朋友的 AI 一键安装 Prompt

朋友可以把下面这段直接粘贴给自己电脑上的 Claude Code / Codex / 任何能执行命令的 AI，让它代劳第 3 步（把 `配对码` 换成 App 里看到的 6 位码）：

```text
帮我在这台 Mac 上安装并启用「谁还没睡 WhoNotSleep」的电脑端后台服务，配对码是：配对码

步骤：
1. 检查 node -v 是否 ≥ 18；没有就用 brew install node 安装。
2. 运行 npm i -g github:Shiyao-Huang/whonotsleep （安装后应有 wns 命令；如果找不到 wns，用 "$(npm prefix -g)/bin/wns" 代替）。
3. 运行 wns link 配对码 ，确认输出「首次上报」成功。
4. 运行 wns install 安装开机自启的后台服务。
5. 可选：运行 wns hook install 让 Claude Code 状态秒同步。
6. 最后运行 wns status，把结果告诉我：守护进程是否在运行、检测到了哪个 AI 工具、房间里有谁。

说明：这个工具不需要辅助功能/输入监控等任何系统权限，只用 ps / lsof / ioreg / launchctl，只上报「在用哪个 AI 工具、项目文件夹名、是否在电脑前、时区」。文档：https://github.com/Shiyao-Huang/whonotsleep/blob/main/docs/MAC_AGENT.md
```
