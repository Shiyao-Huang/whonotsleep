// launchd LaunchAgent management + "stable install location" for npx runs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const LABEL = 'com.whonotsleep.agent';
export const plistPath = () => path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
export const logPath = () => path.join(os.homedir(), 'Library', 'Logs', 'whonotsleep.log');
export const stableRoot = () => path.join(os.homedir(), '.local', 'share', 'whonotsleep');

const here = path.dirname(fileURLToPath(import.meta.url));
export const pkgRoot = () => path.resolve(here, '..', '..');
export const thisScript = () => path.join(pkgRoot(), 'cli', 'bin', 'wns.js');

/** npx puts packages in a cache dir that may be wiped; don't point launchd/hooks at it. */
export function isEphemeral(p) {
  return /\/_npx\/|\/\.npm\/|\/npm-cache\/|^\/(private\/)?(var\/folders|tmp)\//.test(p);
}

/**
 * Absolute path of a wns.js that will still exist tomorrow. When running from
 * the npx cache, copy cli/ + shared/protocol.js into ~/.local/share/whonotsleep.
 */
export function stableScript() {
  const script = thisScript();
  if (!isEphemeral(script)) return script;
  const src = pkgRoot();
  const dst = stableRoot();
  fs.rmSync(path.join(dst, 'cli'), { recursive: true, force: true });
  fs.mkdirSync(path.join(dst, 'shared'), { recursive: true });
  fs.cpSync(path.join(src, 'cli'), path.join(dst, 'cli'), { recursive: true });
  for (const f of ['shared/protocol.js', 'shared/package.json', 'package.json']) {
    const s = path.join(src, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(dst, f));
  }
  return path.join(dst, 'cli', 'bin', 'wns.js');
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildPlist({ node, script, log, pathEnv }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(script)}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xml(pathEnv)}</string>
    <key>WNS_DAEMON</key><string>1</string>
  </dict>
</dict>
</plist>
`;
}

export function launchctl(args) {
  return new Promise((resolve) => {
    execFile('/bin/launchctl', args, { timeout: 10000 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout || ''), err: String(stderr || '') }));
  });
}

const domain = () => `gui/${process.getuid()}`;

export async function install() {
  const script = stableScript();
  const node = process.execPath;
  const log = logPath();
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.mkdirSync(path.dirname(plistPath()), { recursive: true });
  const pathEnv = [path.dirname(node), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  fs.writeFileSync(plistPath(), buildPlist({ node, script, log, pathEnv }), { mode: 0o644 });
  await launchctl(['bootout', `${domain()}/${LABEL}`]); // ignore "not loaded"
  let r = await launchctl(['bootstrap', domain(), plistPath()]);
  if (r.code !== 0) { // retry once: bootout is asynchronous
    await new Promise((res) => setTimeout(res, 1200));
    r = await launchctl(['bootstrap', domain(), plistPath()]);
  }
  return { ...r, node, script, log, plist: plistPath() };
}

export async function uninstall() {
  const r = await launchctl(['bootout', `${domain()}/${LABEL}`]);
  let removed = false;
  try { fs.unlinkSync(plistPath()); removed = true; } catch { /* missing */ }
  return { ...r, removed };
}

/** Parse `launchctl print` output -> {state, pid}. */
export function parseLaunchctlPrint(text) {
  const state = /^\s*state = (\S+)/m.exec(text)?.[1] || null;
  const pid = /^\s*pid = (\d+)/m.exec(text)?.[1];
  return { state, pid: pid ? +pid : null };
}

export async function agentStatus() {
  const installed = fs.existsSync(plistPath());
  const r = await launchctl(['print', `${domain()}/${LABEL}`]);
  if (r.code !== 0) return { installed, loaded: false, running: false, pid: null };
  const { state, pid } = parseLaunchctlPrint(r.out);
  return { installed, loaded: true, running: state === 'running' && !!pid, pid, state };
}
