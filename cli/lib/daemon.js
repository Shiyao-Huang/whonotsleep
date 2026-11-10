// Foreground daemon loop: detect every 15s, report on change, heartbeat every 20s.
import fs from 'node:fs';
import { detect, DETECT_INTERVAL_MS } from './detect.js';
import { loadConfig, saveState, loadState, pidPath, configDir } from './config.js';
import { api, tzOffset } from './api.js';
import { logPath } from './launchd.js';

export const HEARTBEAT_MS = 20_000;
const TICK_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/** Backoff after n consecutive failures (n>=1): 2s,4s,8s... capped at 5 min, with ±20% jitter. */
export function backoffMs(n, rand = Math.random) {
  const base = Math.min(MAX_BACKOFF_MS, 2000 * 2 ** Math.max(0, n - 1));
  return Math.round(base * (0.8 + 0.4 * rand()));
}

export const reportKey = (r) => `${r.status}|${r.tool || ''}|${r.detail || ''}`;

export async function sendReport(cfg, r, timeoutMs = 8000) {
  return api(cfg.serverUrl, 'POST', '/api/me/report', {
    token: cfg.token, timeoutMs,
    body: { status: r.status, tool: r.tool, detail: r.detail, tzOffset: tzOffset() },
  });
}

const ts = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().replace('T', ' ').slice(0, 19); };
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function trimLog() {
  try {
    const p = logPath();
    if (fs.statSync(p).size > 5 * 1024 * 1024) fs.truncateSync(p, 0);
  } catch { /* none */ }
}

export async function runDaemon({ verbose = false } = {}) {
  const log = (...a) => console.log(`[${ts()}]`, ...a);
  process.on('uncaughtException', (e) => log('uncaught:', e?.stack || e));
  process.on('unhandledRejection', (e) => log('unhandled:', e?.stack || e));
  if (process.env.WNS_DAEMON) trimLog();
  try {
    fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(pidPath(), String(process.pid));
  } catch { /* ignore */ }
  const cleanup = () => { try { if (fs.readFileSync(pidPath(), 'utf8').trim() === String(process.pid)) fs.unlinkSync(pidPath()); } catch { /* */ } };
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { log(`${sig}, bye`); process.exit(0); });

  log(`wns daemon started (pid ${process.pid}, node ${process.version})`);
  let cur = null, lastDetectAt = 0, lastKey = null, lastSentAt = 0;
  let failures = 0, nextAllowedAt = 0, warnedNoConfig = false, lastToken = null;

  for (;;) {
    try {
      const cfg = loadConfig();
      if (!cfg) {
        if (!warnedNoConfig) log('not linked yet — run `wns link <CODE>`; waiting...');
        warnedNoConfig = true;
        await sleep(30_000);
        continue;
      }
      if (warnedNoConfig || cfg.token !== lastToken) { lastKey = null; failures = 0; nextAllowedAt = 0; }
      warnedNoConfig = false; lastToken = cfg.token;

      const now = Date.now();
      if (!cur || now - lastDetectAt >= DETECT_INTERVAL_MS) {
        try {
          cur = await detect(cfg);
          lastDetectAt = Date.now();
        } catch (e) { log('detect failed:', e?.message || e); }
      }
      if (cur) {
        const key = reportKey(cur);
        const changed = key !== lastKey;
        if ((changed || Date.now() - lastSentAt >= HEARTBEAT_MS) && Date.now() >= nextAllowedAt) {
          try {
            await sendReport(cfg, cur);
            if (changed || verbose) log(`report ${cur.status}${cur.tool ? ` · ${cur.tool}` : ''}${cur.detail ? ` · ${cur.detail}` : ''}${failures ? ` (recovered after ${failures} failures)` : ''}`);
            lastKey = key; lastSentAt = Date.now(); failures = 0;
            saveState({ ...loadState(), lastReportAt: lastSentAt, lastOk: true, lastError: null, status: cur.status, tool: cur.tool, detail: cur.detail, daemonPid: process.pid });
          } catch (e) {
            failures++;
            const wait = e?.status === 401 || e?.status === 403 ? MAX_BACKOFF_MS : backoffMs(failures);
            nextAllowedAt = Date.now() + wait;
            log(`report failed (${e?.status || 'net'}): ${e?.message || e}; retry in ${Math.round(wait / 1000)}s`);
            if (e?.status === 401 || e?.status === 403) log('token rejected — re-link with `wns link <CODE>`');
            saveState({ ...loadState(), lastOk: false, lastError: String(e?.message || e), lastErrorAt: Date.now(), daemonPid: process.pid });
          }
        }
      }
    } catch (e) {
      log('loop error:', e?.stack || e);
    }
    await sleep(TICK_MS);
  }
}
