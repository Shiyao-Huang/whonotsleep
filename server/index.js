#!/usr/bin/env node
// WhoNotSleep server entry. Env: PORT (3420), HOST (127.0.0.1), DATA_FILE (./data/rooms.json),
// TRUST_PROXY (1 = honour X-Forwarded-For from loopback, default 1).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3420);
const host = process.env.HOST || '127.0.0.1';
const dataFile = process.env.DATA_FILE || path.join(here, 'data', 'rooms.json');

const app = createApp({ dataFile, trustProxy: process.env.TRUST_PROXY !== '0' });
const addr = await app.listen(port, host);
console.log(`[wns] listening on http://${addr.address}:${addr.port} data=${dataFile}`);

let closing = false;
async function shutdown(sig) {
  if (closing) return;
  closing = true;
  console.log(`[wns] ${sig}, saving and exiting`);
  const force = setTimeout(() => process.exit(0), 3000);
  force.unref();
  await app.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
