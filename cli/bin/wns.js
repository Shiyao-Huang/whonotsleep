#!/usr/bin/env node
// wns — WhoNotSleep (谁还没睡) Mac CLI. Zero dependencies.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { DEFAULT_SERVER, EMOTES, TOOLS } from '../../shared/protocol.js';
import { c, banner, ok, info, warn, fail, ago, coral, clean } from '../lib/ui.js';
import { loadConfig, saveConfig, deleteConfig, configPath, loadState, pidPath } from '../lib/config.js';
import { api, authed, normalizeServer } from '../lib/api.js';
import { detect } from '../lib/detect.js';
import { runDaemon, sendReport } from '../lib/daemon.js';
import * as launchd from '../lib/launchd.js';
import * as hooks from '../lib/hooks.js';
import { renderRoom, renderEvents } from '../lib/room.js';

const argv = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--') { pos.push(...argv.slice(i + 1)); break; }
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=', 2);
    if (v !== undefined) flags[k] = v;
    else if (['server'].includes(k) && argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
    else flags[k] = true;
  } else if (a === '-h') flags.help = true;
  else if (a === '-q') flags.quiet = true;
  else pos.push(a);
}
const cmd = (pos.shift() || (flags.help ? 'help' : flags.version ? 'version' : 'help')).toLowerCase();

function version() {
  try { return JSON.parse(fs.readFileSync(path.join(launchd.pkgRoot(), 'package.json'), 'utf8')).version; } catch { return '?'; }
}

function requireConfig() {
  const cfg = loadConfig();
  if (!cfg) {
    fail(`还没连接房间 · not linked yet.`);
    console.log(`  在 App 里点「连接电脑」拿到 6 位码，然后: ${c.bold('wns link ABC123')}`);
    process.exit(1);
  }
  return cfg;
}

function die(e) {
  const msg = e?.message || String(e);
  if (e?.status === 401 || e?.status === 403) fail(`token 被拒绝 (${msg}) — 请重新 wns link <CODE>`);
  else fail(msg);
  process.exit(1);
}

async function fetchRoom(cfg) {
  const r = await api(cfg.serverUrl, 'GET', `/api/rooms/${encodeURIComponent(cfg.roomCode)}`, { token: cfg.token, timeoutMs: 6000 });
  return r?.room || r;
}

function describeDetection(d) {
  const lines = [];
  const tl = d.seenTool ? (TOOLS[d.seenTool] || TOOLS.other) : null;
  const statusColored = { working: coral, idle: c.green, away: c.yellow }[d.status] || c.gray;
  lines.push(`  status  ${statusColored(c.bold(d.status))}${d.tool ? `  ${c.rgb(...(TOOLS[d.tool] || TOOLS.other).color)(TOOLS[d.tool]?.label || d.tool)}` : ''}${d.detail ? c.gray(` · ${d.detail}`) : ''}`);
  lines.push(`  idle    ${d.idleMs == null ? c.gray('unknown') : ago(d.idleMs)}`);
  if (d.best) {
    lines.push(`  tool    ${tl.label} ${c.gray(`(pid ${d.best.pid}, ${d.best.kind}, started ${ago(d.best.etimeSec * 1000)} ago)`)}`);
    lines.push(`          ${c.gray(d.best.exe.length > 90 ? '…' + d.best.exe.slice(-89) : d.best.exe)}`);
  } else lines.push(`  tool    ${c.gray('none')}`);
  const others = [...new Set(d.hits.map((h) => `${h.tool}${h.kind === 'app' ? '(app)' : ''}`))];
  if (others.length > 1) lines.push(`  seen    ${c.gray(others.join(', '))}`);
  return lines.join('\n');
}

// ------------------------------------------------------------------ commands

const commands = {
  async help() {
    console.log(banner());
    const row = (a, b) => console.log(`  ${c.bold(a.padEnd(28))}${c.gray(b)}`);
    console.log(c.gray('  你一打开 AI 工具，朋友手机上的像素小人就坐到电脑前。说了晚安还偷偷肝？会被抓包的。\n'));
    console.log(c.cyan('  setup'));
    row('wns link <CODE> [--server URL]', '用 App 里的 6 位码连接 · link this Mac to your buddy');
    row('wns install', '开机自启后台守护 (launchd) · run in background at login');
    row('wns hook install', 'Claude Code 钩子，状态秒变 · instant presence via hooks');
    row('wns status', '看看现在的状态 · config, daemon, detection, room');
    console.log(c.cyan('\n  social'));
    row('wns gn | goodnight', '说晚安 ☾ (然后别再偷偷开 AI 哦)');
    row('wns morning', '说早安 ☀');
    row('wns say <text>', '冒个泡 (≤80 字)');
    row('wns emote <kind> [@name]', EMOTES.join(' '));
    row('wns room', '房间里都有谁 · pretty print members');
    console.log(c.cyan('\n  more'));
    row('wns start', '前台运行守护循环 · foreground daemon loop');
    row('wns ping [--quiet]', '立刻上报一次 · single immediate report');
    row('wns uninstall', '移除后台守护');
    row('wns hook uninstall', '移除 Claude Code 钩子');
    row('wns logout', '断开连接，删除本地配置');
    row('wns help | version', '');
    console.log(c.gray(`\n  config: ${configPath()}   (shareDetail, extraTools, countApps, awayAfterMinutes)\n`));
  },

  version() { console.log(version()); },

  async link() {
    const code = (pos[0] || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code)) { fail('用法: wns link <CODE>   (App → 连接电脑 里的 6 位码)'); process.exit(1); }
    const prev = loadConfig() || {};
    const serverUrl = normalizeServer(flags.server || process.env.WNS_SERVER || DEFAULT_SERVER);
    info(`连接中 · linking via ${c.gray(serverUrl)} ...`);
    let r;
    try { r = await api(serverUrl, 'POST', '/api/link', { body: { linkCode: code } }); } catch (e) {
      if (e.status === 404 || e.status === 400 || e.status === 410) die(new Error(`码无效或已过期 · invalid/expired code (${e.message})`));
      die(e);
    }
    if (!r?.token) die(new Error('server returned no token'));
    const cfg = {
      ...Object.fromEntries(Object.entries(prev).filter(([k]) => ['shareDetail', 'extraTools', 'countApps', 'awayAfterMinutes'].includes(k))),
      serverUrl, token: r.token, memberId: r.memberId, roomCode: r.roomCode, name: r.name,
    };
    saveConfig(cfg);
    ok(`已连接！你是 ${c.bold(clean(r.name))}，房间 ${c.bold('#' + clean(r.roomCode))}`);
    try { const d = await detect(cfg); await sendReport(cfg, d); ok(`首次上报: ${d.status}${d.tool ? ' · ' + d.tool : ''}`); } catch (e) { warn(`首次上报失败: ${e.message}`); }
    const st = await launchd.agentStatus();
    if (!st.loaded) console.log(`\n  下一步 · next: ${c.bold('wns install')}  ${c.gray('(开机自动在后台运行)')}\n             ${c.bold('wns hook install')}  ${c.gray('(Claude Code 状态秒同步, 可选)')}`);
  },

  async start() {
    // refuse a second foreground loop if a daemon is already reporting (launchd itself always proceeds)
    if (!process.env.WNS_DAEMON && !flags.force) {
      const st = await launchd.agentStatus();
      let other = null;
      try { other = +fs.readFileSync(pidPath(), 'utf8').trim(); if (other === process.pid) other = null; else process.kill(other, 0); } catch { other = null; }
      const pid = st.running ? st.pid : other;
      if (pid) { warn(`守护已在运行 (pid ${pid}) · daemon already running — use --force to run another`); process.exit(1); }
    }
    await runDaemon({ verbose: !!flags.verbose });
  },

  async install() {
    const r = await launchd.install();
    if (r.code !== 0) { fail(`launchctl bootstrap failed: ${(r.err || r.out).trim()}`); console.log(c.gray(`  plist: ${r.plist}`)); process.exit(1); }
    ok('后台守护已安装并启动 · LaunchAgent loaded');
    console.log(c.gray(`  plist  ${r.plist}\n  node   ${r.node}\n  script ${r.script}\n  log    ${r.log}`));
    if (!loadConfig()) warn('还没 link，守护会等你运行 wns link <CODE>');
    if (launchd.isEphemeral(launchd.thisScript())) info(`从 npx 运行，已复制到 ${launchd.stableRoot()} (推荐: npm i -g github:Shiyao-Huang/whonotsleep)`);
  },

  async uninstall() {
    const r = await launchd.uninstall();
    if (r.removed || r.code === 0) ok('后台守护已移除 · LaunchAgent removed');
    else info('没有安装过后台守护 · nothing to remove');
  },

  async status() {
    console.log(banner());
    const cfg = loadConfig();
    console.log(c.cyan('  config'));
    if (cfg) {
      console.log(`  name    ${c.bold(clean(cfg.name) || '?')}  ${c.gray(`room #${clean(cfg.roomCode)}`)}`);
      console.log(`  server  ${c.gray(cfg.serverUrl)}`);
      console.log(`  detail  ${cfg.shareDetail === false ? c.gray('hidden (shareDetail=false)') : c.gray('shared (folder name)')}`);
    } else {
      console.log(`  ${c.yellow('未连接 · not linked')}  ${c.gray('→ wns link <CODE>')}`);
    }

    console.log(c.cyan('\n  daemon'));
    const st = await launchd.agentStatus();
    let fgPid = null;
    try { fgPid = +fs.readFileSync(pidPath(), 'utf8').trim(); process.kill(fgPid, 0); } catch { fgPid = null; }
    if (st.running) console.log(`  ${c.green('● running')} ${c.gray(`launchd pid ${st.pid}`)}`);
    else if (fgPid) console.log(`  ${c.green('● running')} ${c.gray(`foreground pid ${fgPid}`)}`);
    else if (st.loaded) console.log(`  ${c.yellow('● loaded, not running')} ${c.gray(`(${st.state}) see ${launchd.logPath()}`)}`);
    else console.log(`  ${c.gray('○ not running')}  ${c.gray(st.installed ? 'plist exists but not loaded → wns install' : '→ wns install')}`);
    const s = loadState();
    if (s.lastReportAt) console.log(`  last report ${ago(Date.now() - s.lastReportAt)} ago ${c.gray(`(${s.status}${s.tool ? ' · ' + s.tool : ''})`)}`);
    if (s.lastOk === false && s.lastError) console.log(`  ${c.red('last error')} ${s.lastError} ${c.gray(ago(Date.now() - (s.lastErrorAt || 0)) + ' ago')}`);
    try {
      const hs = hooks.readSettings();
      console.log(`  hooks   ${hooks.hasOurHooks(hs.settings) ? c.green('Claude Code hooks installed') : c.gray('not installed (wns hook install)')}`);
    } catch { console.log(`  hooks   ${c.yellow('~/.claude/settings.json unreadable')}`); }

    console.log(c.cyan('\n  detection (now)'));
    try { console.log(describeDetection(await detect(cfg || {}))); } catch (e) { console.log(`  ${c.red('detect failed')} ${e.message}`); }

    if (cfg) {
      console.log(c.cyan('\n  room'));
      try { console.log(renderRoom(await fetchRoom(cfg), { meId: cfg.memberId })); } catch (e) { console.log(`  ${c.red('无法获取房间 · cannot fetch room')} ${c.gray(e.message)}`); }
    }
    console.log('');
  },

  async room() {
    const cfg = requireConfig();
    let room;
    try { room = await fetchRoom(cfg); } catch (e) { die(e); }
    console.log('\n' + renderRoom(room, { meId: cfg.memberId }));
    const ev = renderEvents(room);
    if (ev) console.log(`\n${c.cyan('  recent')}\n${ev}`);
    console.log('');
  },

  async ping() {
    const quiet = !!flags.quiet;
    if (flags.detach) {
      // used by Claude Code hooks: return at once so the prompt is never delayed by ps/network
      try {
        spawn(process.execPath, [launchd.thisScript(), 'ping', '--quiet'], { detached: true, stdio: 'ignore' }).unref();
      } catch { /* ignore */ }
      process.exit(0);
    }
    const cfg = loadConfig();
    if (!cfg) { if (!quiet) fail('not linked'); process.exit(quiet ? 0 : 1); }
    try {
      const d = await detect(cfg);
      await sendReport(cfg, d, quiet ? 4000 : 8000);
      if (!quiet) ok(`reported ${d.status}${d.tool ? ' · ' + d.tool : ''}${d.detail ? ' · ' + d.detail : ''}`);
    } catch (e) {
      if (!quiet) die(e);
    }
    process.exit(0);
  },

  async gn() {
    const cfg = requireConfig();
    try { await authed(cfg)('POST', '/api/me/goodnight'); } catch (e) { die(e); }
    const h = new Date().getHours();
    ok(`晚安 ☾  ${c.gray(h >= 0 && h < 6 ? '都这个点了，快睡！再开 AI 会被抓包的 (¬‿¬)' : '说好了哦，再偷偷开 AI 会被朋友抓包的')}`);
  },

  async morning() {
    const cfg = requireConfig();
    try { await authed(cfg)('POST', '/api/me/morning'); } catch (e) { die(e); }
    ok(`早安 ☀  ${c.gray('新的一天，开肝！')}`);
  },

  async say() {
    const cfg = requireConfig();
    const text = pos.join(' ').trim();
    if (!text) { fail('用法: wns say <text>'); process.exit(1); }
    const t = [...text].slice(0, 80).join('');
    if (t !== text) warn('超过 80 字，已截断');
    try { await authed(cfg)('POST', '/api/me/say', { text: t }); } catch (e) { die(e); }
    ok(`💬 ${t}`);
  },

  async emote() {
    const cfg = requireConfig();
    const kind = (pos[0] || '').toLowerCase();
    if (!EMOTES.includes(kind)) { fail(`用法: wns emote <kind> [@name]   kinds: ${EMOTES.join(' ')}`); process.exit(1); }
    const body = { kind };
    const target = pos[1] ? pos[1].replace(/^@/, '').toLowerCase() : null;
    let targetName = null;
    if (target) {
      let room;
      try { room = await fetchRoom(cfg); } catch (e) { die(e); }
      const ms = room?.members || [];
      const nm = (x) => String(x?.name || '').toLowerCase();
      const m = ms.find((x) => nm(x) === target) || ms.find((x) => nm(x).startsWith(target));
      if (!m) { fail(`房间里没有 @${pos[1].replace(/^@/, '')} · members: ${ms.map((x) => clean(x.name)).join(', ') || '(none)'}`); process.exit(1); }
      body.to = m.id; targetName = m.name;
    }
    try { await authed(cfg)('POST', '/api/me/emote', body); } catch (e) { die(e); }
    ok(`emote ${c.bold(kind)}${targetName ? ` → @${targetName}` : ''}`);
  },

  async hook() {
    const sub = (pos[0] || '').toLowerCase();
    const file = hooks.claudeSettingsPath();
    let cur;
    try { cur = hooks.readSettings(file); } catch (e) { die(new Error(`${file} 不是合法 JSON，未修改 · not valid JSON, left untouched (${e.message})`)); }
    if (sub === 'install') {
      const command = `"${process.execPath}" "${launchd.stableScript()}" ping --quiet --detach`;
      const { settings, changed } = hooks.mergeHooks(cur.settings, command);
      if (!changed) { ok('Claude Code hooks 已经装好了 · already installed'); return; }
      const backup = hooks.writeSettings(settings, file);
      ok(`已添加 Claude Code hooks (UserPromptSubmit, Stop) → ${file}`);
      if (backup) console.log(c.gray(`  backup: ${backup}`));
      console.log(c.gray(`  command: ${command}`));
    } else if (sub === 'uninstall' || sub === 'remove') {
      if (!cur.exists) { info('没有 settings.json · nothing to do'); return; }
      const { settings, changed } = hooks.removeHooks(cur.settings);
      if (!changed) { info('没有找到 wns hooks · nothing to remove'); return; }
      const backup = hooks.writeSettings(settings, file);
      ok('已移除 wns hooks');
      if (backup) console.log(c.gray(`  backup: ${backup}`));
    } else {
      fail('用法: wns hook install | uninstall'); process.exit(1);
    }
  },

  async logout() {
    const cfg = loadConfig();
    const removed = deleteConfig();
    if (removed) ok(`已断开 ${cfg ? `#${cfg.roomCode}` : ''} · local config removed`);
    else info('本来就没连接 · not linked');
    const st = await launchd.agentStatus();
    if (st.loaded) info(`后台守护还在运行(会空等)，要移除: ${c.bold('wns uninstall')}`);
  },

  async detect() { // debug helper
    const d = await detect(loadConfig() || {});
    if (flags.json) console.log(JSON.stringify({ ...d, best: d.best && { ...d.best, args: d.best.args.slice(0, 200) }, hits: d.hits.map((h) => ({ tool: h.tool, kind: h.kind, pid: h.pid, etimeSec: h.etimeSec, exe: h.exe })) }, null, 2));
    else console.log(describeDetection(d));
  },
};
commands.goodnight = commands.gn;
commands.gm = commands.morning;
commands.hooks = commands.hook;
commands['--help'] = commands.help;

const fn = commands[cmd];
if (!fn) {
  fail(`未知命令 · unknown command: ${cmd}`);
  console.log(`  试试 ${c.bold('wns help')}`);
  process.exit(1);
}
Promise.resolve(fn()).catch((e) => die(e));
