// Config + state files in ~/.config/whonotsleep (override dir with WNS_CONFIG_DIR).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const configDir = () => process.env.WNS_CONFIG_DIR || path.join(os.homedir(), '.config', 'whonotsleep');
export const configPath = () => path.join(configDir(), 'config.json');
export const statePath = () => path.join(configDir(), 'state.json');
export const pidPath = () => path.join(configDir(), 'daemon.pid');

function ensureDir() {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeJson(p, obj, mode = 0o600) {
  ensureDir();
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { mode });
  fs.renameSync(tmp, p);
  try { fs.chmodSync(p, mode); } catch { /* ignore */ }
}

/** @returns {null | {serverUrl, token, memberId, roomCode, name, shareDetail?, extraTools?, countApps?, awayAfterMinutes?}} */
export function loadConfig() {
  const cfg = readJson(configPath());
  return cfg && cfg.token && cfg.serverUrl ? cfg : null;
}

export function saveConfig(cfg) { writeJson(configPath(), cfg, 0o600); }

export function deleteConfig() {
  let removed = false;
  for (const p of [configPath(), statePath()]) {
    try { fs.unlinkSync(p); removed = true; } catch { /* missing */ }
  }
  return removed;
}

export function loadState() { return readJson(statePath()) || {}; }
export function saveState(s) { try { writeJson(statePath(), s, 0o600); } catch { /* ignore */ } }
