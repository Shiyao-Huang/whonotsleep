// AI-tool presence detection for macOS.
// Pure parsing/classification functions are exported separately from the
// exec wrappers so they can be unit-tested with fixtures (see cli/test.mjs).

import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { TOOLS } from '../../shared/protocol.js';

export const DETECT_INTERVAL_MS = 15_000;
export const DEFAULT_AWAY_AFTER_MS = 5 * 60_000;

// ------------------------------------------------------------------ parsing

/** "mm:ss" | "hh:mm:ss" | "dd-hh:mm:ss" -> seconds (NaN if unparseable). */
export function parseEtime(s) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(s).trim());
  if (!m) return NaN;
  const [, d = 0, h = 0, mi, se] = m;
  return ((+d * 24 + +h) * 60 + +mi) * 60 + +se;
}

/**
 * Parse `ps -axww -o pid=,ppid=,etime=,comm=` output. comm is the LAST
 * column so macOS prints the full executable path (spaces included) instead
 * of truncating it to 16 chars.
 * @returns {Map<number,{pid:number,ppid:number,etimeSec:number,exe:string}>}
 */
export function parsePsComm(text) {
  const out = new Map();
  for (const line of String(text).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d:-]+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    out.set(+m[1], { pid: +m[1], ppid: +m[2], etimeSec: parseEtime(m[3]), exe: m[4] });
  }
  return out;
}

/** Parse `ps -axww -o pid=,args=` output -> Map pid -> full command line. */
export function parsePsArgs(text) {
  const out = new Map();
  for (const line of String(text).split('\n')) {
    const m = /^\s*(\d+)\s+(.*?)\s*$/.exec(line);
    if (m) out.set(+m[1], m[2]);
  }
  return out;
}

/** Join the two ps outputs into [{pid, ppid, etimeSec, exe, name, args}]. */
export function mergePs(commText, argsText) {
  const comm = parsePsComm(commText);
  const args = parsePsArgs(argsText);
  const procs = [];
  for (const p of comm.values()) {
    const a = args.get(p.pid) ?? p.exe;
    procs.push({ ...p, name: basename(p.exe), args: a });
  }
  return procs;
}

export function basename(p) {
  const s = String(p || '').replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

// ----------------------------------------------------------- classification

const INTERPRETER = /^(node|nodejs|bun|deno|python[\d.]*|Python|ruby|uv|uvx|pipx)$/;

/** CLI tools: matched by executable basename, or by script path when run via an interpreter. */
export const CLI_RULES = [
  { tool: 'claude',   bins: ['claude'],       script: /@anthropic-ai\/claude-code\b|\/claude-code\/cli\.m?js\b|\/bin\/claude(\s|$)/ },
  { tool: 'codex',    bins: ['codex'],        script: /@openai\/codex\b|\/bin\/codex(\.js)?(\s|$)/ },
  { tool: 'gemini',   bins: ['gemini'],       script: /@google\/gemini-cli\b|\/bin\/gemini(\s|$)/ },
  { tool: 'cursor',   bins: ['cursor-agent'], script: /\/cursor-agent(\/|\s|$)/ },
  { tool: 'copilot',  bins: ['copilot'],      script: /@github\/copilot(\/|\s|$)|\/bin\/copilot(\s|$)/ },
  { tool: 'aider',    bins: ['aider'],        script: /\/bin\/aider(\s|$)|\s-m\s+aider\b/ },
  { tool: 'opencode', bins: ['opencode'],     script: /\bopencode-ai\b|\/bin\/opencode(\s|$)/ },
  { tool: 'goose',    bins: ['goose'],        script: /\/bin\/goose(\s|$)/ },
  { tool: 'amp',      bins: ['amp'],          script: /@sourcegraph\/amp\b|\/bin\/amp(\s|$)/ },
];

/** Desktop apps: matched on the main bundle executable only (helpers excluded). */
export const APP_RULES = [
  { tool: 'claude',  exe: /\/Claude\.app\/Contents\/MacOS\/Claude$/ },
  { tool: 'chatgpt', exe: /\/ChatGPT\.app\/Contents\/MacOS\/ChatGPT$/ },
  { tool: 'cursor',  exe: /\/Cursor\.app\/Contents\/MacOS\/Cursor$/ },
  { tool: 'codex',   exe: /\/Codex\.app\/Contents\/MacOS\/Codex$/ },
  { tool: 'goose',   exe: /\/Goose\.app\/Contents\/MacOS\/Goose$/ },
];

/** CLI binaries shipped inside a desktop .app bundle under /Applications (always-on background engines). */
const BUNDLED_ENGINE = /^\/Applications\/[^/]+\.app\//;

const NOISE_BINS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'pgrep', 'pkill', 'ps', 'lsof', 'less', 'more', 'tail', 'head', 'man', 'which', 'kill', 'killall', 'open', 'top', 'htop']);

/** Electron/Chromium helper processes, crash reporters, language servers etc. */
export function isNoise(proc) {
  if (NOISE_BINS.has(proc.name)) return true;
  if (/ Helper( \([^)]*\))?(\.app|$)/.test(proc.exe)) return true;   // "Claude Helper (Renderer)"
  if (/crashpad|crash_?handler|CrashReporter/i.test(proc.exe)) return true;
  if (/\s--type=(renderer|gpu-process|utility|zygote|crashpad-handler)\b/.test(proc.args)) return true;
  return false;
}

function compileExtra(extraTools) {
  const out = [];
  for (const [name, src] of Object.entries(extraTools || {})) {
    try { out.push({ name, re: src instanceof RegExp ? src : new RegExp(src, 'i') }); } catch { /* bad regex: ignore */ }
  }
  return out;
}

/**
 * Classify one process.
 * @returns {{tool:string, kind:'cli'|'app', label?:string}|null}
 */
export function classifyProcess(proc, { extra = [], selfPid = -1 } = {}) {
  if (proc.pid === selfPid) return null;
  if (isNoise(proc)) return null;
  for (const r of APP_RULES) if (r.exe.test(proc.exe)) return { tool: r.tool, kind: 'app' };
  for (const r of CLI_RULES) {
    if (r.bins.includes(proc.name) || (r.script && INTERPRETER.test(proc.name) && r.script.test(proc.args))) {
      // engines bundled inside a desktop app (e.g. ChatGPT.app's codex app-server) count as that app
      const kind = BUNDLED_ENGINE.test(proc.exe) || /\sapp-server(\s|$)/.test(proc.args) ? 'app' : 'cli';
      return { tool: r.tool, kind };
    }
  }
  for (const x of extra) {
    if (x.re.test(proc.args) || x.re.test(proc.exe)) {
      return { tool: TOOLS[x.name] ? x.name : 'other', kind: 'cli', label: x.name };
    }
  }
  return null;
}

/**
 * Find all AI tool processes and pick the "current" one: the most recently
 * started CLI tool; desktop apps only if no CLI tool runs (and countApps!==false).
 */
export function pickTool(procs, { extraTools = {}, countApps = true, selfPid = -1 } = {}) {
  const extra = compileExtra(extraTools);
  const hits = [];
  for (const p of procs) {
    const c = classifyProcess(p, { extra, selfPid });
    if (c && (c.kind === 'cli' || countApps)) hits.push({ ...p, ...c });
  }
  const newest = (a, b) => (a.etimeSec - b.etimeSec) || (b.pid - a.pid);
  const clis = hits.filter((h) => h.kind === 'cli').sort(newest);
  const apps = hits.filter((h) => h.kind === 'app').sort(newest);
  const best = clis[0] || apps[0] || null;
  return { best, hits: [...clis, ...apps] };
}

/** `ioreg -c IOHIDSystem` -> idle milliseconds (or null). */
export function parseHidIdle(text) {
  const m = /"HIDIdleTime"\s*=\s*(\d+)/.exec(String(text));
  return m ? Math.floor(Number(m[1]) / 1e6) : null;
}

/** `lsof -a -p PID -d cwd -Fn` -> cwd path (or null). */
export function parseLsofCwd(text) {
  for (const line of String(text).split('\n')) if (line.startsWith('n') && line.length > 1) return line.slice(1);
  return null;
}

/** Folder name to show as "detail"; nothing for / or $HOME (desktop apps). */
export function detailFromCwd(cwd, home = homedir()) {
  if (!cwd) return null;
  const c = cwd.replace(/\/+$/, '') || '/';
  if (c === '/' || c === home.replace(/\/+$/, '')) return null;
  const b = basename(c);
  return b ? b.slice(0, 40) : null;
}

/** working: tool && present · idle: no tool && present · away: user idle. */
export function computeStatus({ tool, idleMs, awayAfterMs = DEFAULT_AWAY_AFTER_MS }) {
  const away = idleMs != null && idleMs > awayAfterMs;
  if (away) return 'away';
  return tool ? 'working' : 'idle';
}

// --------------------------------------------------------------------- exec

function run(cmd, args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } },
      (err, stdout) => resolve(err && !stdout ? '' : String(stdout || '')));
  });
}

export async function listProcesses() {
  const [comm, args] = await Promise.all([
    run('/bin/ps', ['-axww', '-o', 'pid=,ppid=,etime=,comm=']),
    run('/bin/ps', ['-axww', '-o', 'pid=,args=']),
  ]);
  return mergePs(comm, args);
}

export async function getIdleMs() {
  return parseHidIdle(await run('/usr/sbin/ioreg', ['-c', 'IOHIDSystem', '-d', '4']));
}

export async function getCwd(pid) {
  return parseLsofCwd(await run('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']));
}

/**
 * One full detection pass.
 * @param {object} cfg config ({extraTools, countApps, shareDetail, awayAfterMinutes})
 */
export async function detect(cfg = {}) {
  const [procs, idleMs] = await Promise.all([listProcesses(), getIdleMs()]);
  const { best, hits } = pickTool(procs, {
    extraTools: cfg.extraTools, countApps: cfg.countApps !== false, selfPid: process.pid,
  });
  let detail = null;
  if (best && cfg.shareDetail !== false) detail = detailFromCwd(await getCwd(best.pid));
  const awayAfterMs = (Number(cfg.awayAfterMinutes) > 0 ? Number(cfg.awayAfterMinutes) * 60_000 : DEFAULT_AWAY_AFTER_MS);
  const tool = best ? best.tool : null;
  const status = computeStatus({ tool, idleMs, awayAfterMs });
  return {
    status,
    tool: status === 'working' ? tool : null,
    detail: status === 'working' ? detail : null,
    seenTool: tool, idleMs, best, hits,
  };
}
