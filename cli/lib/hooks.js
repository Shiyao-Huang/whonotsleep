// Claude Code hooks in ~/.claude/settings.json: UserPromptSubmit + Stop run
// `wns ping --quiet` so presence flips instantly. Merge is non-destructive.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const HOOK_EVENTS = ['UserPromptSubmit', 'Stop'];

export const claudeSettingsPath = () =>
  process.env.WNS_CLAUDE_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');

/** Is this hook command one of ours? (`wns ping` or `.../wns.js" ping`) */
export function isOurHook(h) {
  return !!h && typeof h.command === 'string' && /\bwns(\.js)?["']?\s+ping\b/.test(h.command);
}

const clone = (o) => JSON.parse(JSON.stringify(o ?? {}));

/**
 * Pure: add/update our hook for each event, leaving everything else intact.
 * @returns {{settings:object, changed:boolean}}
 */
export function mergeHooks(settings, command) {
  const s = clone(settings);
  let changed = false;
  if (!s.hooks || typeof s.hooks !== 'object' || Array.isArray(s.hooks)) { s.hooks = {}; changed = true; }
  for (const ev of HOOK_EVENTS) {
    if (!Array.isArray(s.hooks[ev])) { s.hooks[ev] = []; changed = true; }
    let found = false;
    for (const group of s.hooks[ev]) {
      if (!group || !Array.isArray(group.hooks)) continue;
      for (const h of group.hooks) {
        if (!isOurHook(h)) continue;
        if (found) continue; // duplicates removed below
        found = true;
        if (h.command !== command || h.type !== 'command') { h.type = 'command'; h.command = command; changed = true; }
        if (h.timeout == null) { h.timeout = 10; changed = true; }
      }
    }
    if (!found) {
      s.hooks[ev].push({ hooks: [{ type: 'command', command, timeout: 10 }] });
      changed = true;
    } else {
      // drop any extra copies of our hook
      let seen = false;
      for (const group of s.hooks[ev]) {
        if (!group || !Array.isArray(group.hooks)) continue;
        const before = group.hooks.length;
        group.hooks = group.hooks.filter((h) => !isOurHook(h) || (!seen && (seen = true)));
        if (group.hooks.length !== before) changed = true;
      }
      const n = s.hooks[ev].length;
      s.hooks[ev] = s.hooks[ev].filter((g) => !g || !Array.isArray(g.hooks) || g.hooks.length);
      if (s.hooks[ev].length !== n) changed = true;
    }
  }
  return { settings: s, changed };
}

/** Pure: remove our hooks only; prune groups/events/hooks object we emptied. */
export function removeHooks(settings) {
  const s = clone(settings);
  let changed = false;
  if (!s.hooks || typeof s.hooks !== 'object') return { settings: s, changed };
  for (const ev of Object.keys(s.hooks)) {
    if (!Array.isArray(s.hooks[ev])) continue;
    const groups = [];
    for (const g of s.hooks[ev]) {
      if (!g || !Array.isArray(g.hooks)) { groups.push(g); continue; }
      const kept = g.hooks.filter((h) => !isOurHook(h));
      if (kept.length === g.hooks.length) { groups.push(g); continue; }
      changed = true;
      if (kept.length) groups.push({ ...g, hooks: kept });
    }
    if (groups.length) s.hooks[ev] = groups;
    else if (changed) delete s.hooks[ev];
  }
  if (changed && Object.keys(s.hooks).length === 0) delete s.hooks;
  return { settings: s, changed };
}

export function hasOurHooks(settings) {
  return HOOK_EVENTS.every((ev) => (settings?.hooks?.[ev] || []).some((g) => (g?.hooks || []).some(isOurHook)));
}

export function readSettings(file = claudeSettingsPath()) {
  if (!fs.existsSync(file)) return { exists: false, settings: {} };
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return { exists: true, settings: {} };
  return { exists: true, settings: JSON.parse(raw) }; // throws on invalid JSON: never clobber it
}

/** Backup then write. Returns backup path (or null if file was new). */
export function writeSettings(settings, file = claudeSettingsPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let backup = null;
  if (fs.existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backup = `${file}.wns-backup-${stamp}`;
    fs.copyFileSync(file, backup);
  }
  const tmp = `${file}.wns.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return backup;
}
