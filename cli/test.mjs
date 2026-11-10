// node --test cli/test.mjs   (or: node cli/test.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEtime, parsePsComm, parsePsArgs, mergePs, pickTool, classifyProcess,
  parseHidIdle, parseLsofCwd, detailFromCwd, computeStatus,
} from './lib/detect.js';
import { mergeHooks, removeHooks, hasOurHooks, isOurHook } from './lib/hooks.js';
import { buildPlist, parseLaunchctlPrint, isEphemeral } from './lib/launchd.js';
import { backoffMs, reportKey } from './lib/daemon.js';
import { cuteLine, renderRoom, renderEvents } from './lib/room.js';
import { clean } from './lib/ui.js';
import { deriveScene } from '../shared/protocol.js';

// Build realistic `ps -axww -o pid=,ppid=,etime=,comm=` + `ps -axww -o pid=,args=` texts.
function psTexts(rows) {
  const comm = rows.map(([pid, ppid, et, exe]) => `${String(pid).padStart(5)} ${String(ppid).padStart(5)} ${et.padStart(11)} ${exe}`).join('\n');
  const args = rows.map(([pid, , , exe, a]) => `${String(pid).padStart(5)} ${a ?? exe}`).join('\n');
  return [comm + '\n', args + '\n'];
}
const procsOf = (rows) => mergePs(...psTexts(rows));
const toolOf = (row, opts) => pickTool(procsOf([row]), opts).best?.tool ?? null;

const NODE = '/opt/homebrew/Cellar/node/24.1.0/bin/node';

test('parseEtime', () => {
  assert.equal(parseEtime('00:05'), 5);
  assert.equal(parseEtime('59:08'), 3548);
  assert.equal(parseEtime('01:00:00'), 3600);
  assert.equal(parseEtime('02-02:39:37'), 2 * 86400 + 2 * 3600 + 39 * 60 + 37);
  assert.ok(Number.isNaN(parseEtime('bogus')));
});

test('parsePsComm keeps paths with spaces, parsePsArgs', () => {
  const m = parsePsComm('  319   318       59:08 /Users/me/Library/Application Support/Claude-3p/claude-code/2.1.317/x/claude.app/Contents/MacOS/claude\n');
  const p = m.get(319);
  assert.equal(p.ppid, 318);
  assert.equal(p.etimeSec, 3548);
  assert.match(p.exe, /Application Support\/.*\/MacOS\/claude$/);
  const a = parsePsArgs('  319 /x/claude --output-format stream-json\n   1 /sbin/launchd\n');
  assert.equal(a.get(319), '/x/claude --output-format stream-json');
  assert.equal(a.get(1), '/sbin/launchd');
});

const POSITIVE = [
  ['claude native (homebrew/installer)', [4242, 4100, '12:01', '/Users/me/.local/share/claude/versions/2.1.300/claude', 'claude --continue'], 'claude'],
  ['claude via node (npm global)', [4243, 4100, '12:01', 'node', `${NODE} /opt/homebrew/bin/claude`], 'claude'],
  ['claude via node cli.js', [4244, 4100, '12:01', NODE, `${NODE} /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js -p hi`], 'claude'],
  ['claude spawned by Claude desktop', [319, 318, '59:08', '/Users/me/Library/Application Support/Claude-3p/claude-code/2.1.317/91184d3d9ba3/claude.app/Contents/MacOS/claude', '/Users/me/Library/Application Support/Claude-3p/claude-code/2.1.317/91184d3d9ba3/claude.app/Contents/MacOS/claude --output-format stream-json --verbose'], 'claude'],
  ['claude vscode extension binary', [5000, 1739, '03:00', '/Users/me/.vscode/extensions/anthropic.claude-code-2.1.3-darwin-arm64/resources/native-binary/claude', '/Users/me/.vscode/extensions/anthropic.claude-code-2.1.3-darwin-arm64/resources/native-binary/claude --output-format stream-json'], 'claude'],
  ['codex native', [6000, 4100, '01:02', '/opt/homebrew/bin/codex', 'codex'], 'codex'],
  ['codex via node', [6001, 4100, '01:02', 'node', 'node /opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js'], 'codex'],
  ['gemini cli', [6100, 4100, '01:02', NODE, `${NODE} /opt/homebrew/bin/gemini`], 'gemini'],
  ['gemini cli package', [6101, 4100, '01:02', 'node', 'node --no-warnings=DEP0040 /usr/local/lib/node_modules/@google/gemini-cli/dist/index.js'], 'gemini'],
  ['cursor-agent', [6200, 4100, '01:02', '/Users/me/.local/bin/cursor-agent', 'cursor-agent'], 'cursor'],
  ['cursor-agent node', [6201, 4100, '01:02', '/Users/me/.local/share/cursor-agent/versions/2025.09/node', '/Users/me/.local/share/cursor-agent/versions/2025.09/node --use-system-ca /Users/me/.local/share/cursor-agent/versions/2025.09/index.js'], 'cursor'],
  ['copilot cli', [6300, 4100, '01:02', 'node', 'node /opt/homebrew/lib/node_modules/@github/copilot/index.js'], 'copilot'],
  ['copilot bin', [6301, 4100, '01:02', '/opt/homebrew/bin/copilot', 'copilot'], 'copilot'],
  ['aider python', [6400, 4100, '01:02', '/Users/me/.local/share/uv/tools/aider-chat/bin/python', '/Users/me/.local/share/uv/tools/aider-chat/bin/python /Users/me/.local/bin/aider --model sonnet'], 'aider'],
  ['aider python -m', [6401, 4100, '01:02', '/Library/Frameworks/Python.framework/Versions/3.12/Resources/Python.app/Contents/MacOS/Python', 'Python -m aider'], 'aider'],
  ['aider bin', [6402, 4100, '01:02', '/Users/me/.local/bin/aider', 'aider'], 'aider'],
  ['opencode', [6500, 4100, '01:02', '/Users/me/.opencode/bin/opencode', 'opencode'], 'opencode'],
  ['goose', [6600, 4100, '01:02', '/usr/local/bin/goose', 'goose session'], 'goose'],
  ['amp', [6700, 4100, '01:02', 'node', 'node /opt/homebrew/lib/node_modules/@sourcegraph/amp/dist/main.js'], 'amp'],
  ['ChatGPT app', [82457, 1, '02:49:25', '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT', '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT'], 'chatgpt'],
  ['Claude desktop app', [50589, 1, '04:51:52', '/Applications/Claude.app/Contents/MacOS/Claude', '/Applications/Claude.app/Contents/MacOS/Claude'], 'claude'],
  ['Cursor app', [7000, 1, '04:51:52', '/Applications/Cursor.app/Contents/MacOS/Cursor', '/Applications/Cursor.app/Contents/MacOS/Cursor'], 'cursor'],
];
for (const [name, row, tool] of POSITIVE) test(`detects ${name}`, () => assert.equal(toolOf(row), tool));

const NEGATIVE = [
  ['Claude Helper (Renderer)', [26738, 50589, '10:00', '/Applications/Claude.app/Contents/Frameworks/Claude Helper (Renderer).app/Contents/MacOS/Claude Helper (Renderer)', '/Applications/Claude.app/Contents/Frameworks/Claude Helper (Renderer).app/Contents/MacOS/Claude Helper (Renderer) --type=renderer --user-data-dir=/Users/me/Library/Application Support/Claude'], ],
  ['Claude Helper utility', [5746, 50589, '10:00', '/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper', '/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper --type=utility --utility-sub-type=node.mojom.NodeService'], ],
  ['ChatGPT crashpad', [8000, 82457, '10:00', '/Applications/ChatGPT.app/Contents/Frameworks/Sparkle.framework/chrome_crashpad_handler', '/Applications/ChatGPT.app/Contents/Frameworks/chrome_crashpad_handler --database=x'], ],
  ['grep claude', [9000, 8999, '00:00', '/usr/bin/grep', 'grep --color=auto claude'], ],
  ['rg codex', [9001, 8999, '00:00', '/opt/homebrew/bin/rg', 'rg codex src/'], ],
  ['vscode extension host', [1739, 1012, '03-14:00:00', '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)', '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin) --type=utility --utility-sub-type=node.mojom.NodeService --dns-result-order=ipv4first --inspect-port=0 /Users/me/.vscode/extensions/github.copilot-chat-0.30/dist/extension.js'], ],
  ['vscode copilot-runtime', [1995, 1736, '03-14:00:00', '/Applications/Visual Studio Code.app/Contents/Resources/app/node_modules.asar.unpacked/@github/copilot-sdk-darwin-arm64/prebuilds/darwin-arm64/copilot-runtime', '/Applications/Visual Studio Code.app/Contents/Resources/app/node_modules.asar.unpacked/@github/copilot-sdk-darwin-arm64/prebuilds/darwin-arm64/copilot-runtime --headless --stdio'], ],
  ['vscode main', [1012, 1, '03-14:42:15', '/Applications/Visual Studio Code.app/Contents/MacOS/Code', '/Applications/Visual Studio Code.app/Contents/MacOS/Code'], ],
  ['claude disclaimer wrapper', [318, 50589, '59:08', '/Applications/Claude.app/Contents/Helpers/disclaimer', '/Applications/Claude.app/Contents/Helpers/disclaimer --pgroup -- /Users/me/Library/Application Support/Claude-3p/claude-code/2.1.317/x/claude.app/Contents/MacOS/claude --output-format stream-json'], ],
  ['ChatGPT bundled node with .codex path', [6771, 91795, '02-02:39:37', '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node', '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --import file:///Users/me/.codex/plugins/cache/x/require-browser-access.mjs /Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/cua/index.js'], ],
  ['tutti-amp service', [2024, 1, '03-00:00:00', '/Users/me/.tutti-amp/computer/bin/tutti-computer', '/Users/me/.tutti-amp/computer/bin/tutti-computer service'], ],
  ['vite dev server', [2010, 1, '01:00:00', NODE, `${NODE} /Users/me/claude-stuff/node_modules/vite/bin/vite.js --port 5174`], ],
  ['less of claude log', [9100, 9000, '00:10', '/usr/bin/less', 'less /Users/me/.claude/debug/claude.log'], ],
  ['CursorUIViewService', [1677, 1, '03-00:00:00', '/System/Library/PrivateFrameworks/TextInputUIMacHelper.framework/Versions/A/XPCServices/CursorUIViewService.xpc/Contents/MacOS/CursorUIViewService', '/System/Library/PrivateFrameworks/TextInputUIMacHelper.framework/Versions/A/XPCServices/CursorUIViewService.xpc/Contents/MacOS/CursorUIViewService'], ],
  ['AMPDeviceDiscoveryAgent', [1035, 1, '03-00:00:00', '/System/Library/PrivateFrameworks/AMPDevices.framework/Versions/A/Support/AMPDeviceDiscoveryAgent', '/System/Library/PrivateFrameworks/AMPDevices.framework/Versions/A/Support/AMPDeviceDiscoveryAgent --launchd'], ],
];
for (const [name, row] of NEGATIVE) test(`ignores ${name}`, () => assert.equal(toolOf(row), null));

test('codex app-server bundled in ChatGPT.app counts as app, not CLI', () => {
  const p = procsOf([[91795, 82457, '02-03:00:00', '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex app-server --stdio']])[0];
  assert.deepEqual(classifyProcess(p), { tool: 'codex', kind: 'app' });
});

test('excludes own pid', () => {
  const procs = procsOf([[777, 1, '00:01', '/opt/homebrew/bin/codex', 'codex']]);
  assert.equal(pickTool(procs, { selfPid: 777 }).best, null);
});

test('picks most recently started CLI tool over older CLIs and over apps', () => {
  const procs = procsOf([
    [50589, 1, '04:51:52', '/Applications/Claude.app/Contents/MacOS/Claude'],                 // app, older
    [82457, 1, '00:00:05', '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT'],               // app, newest overall
    [4242, 4100, '01:00:00', '/Users/me/.local/share/claude/versions/2.1.300/claude', 'claude'],
    [6000, 4100, '00:02:00', '/opt/homebrew/bin/codex', 'codex'],                            // newest CLI
    [6100, 4100, '00:30:00', NODE, `${NODE} /opt/homebrew/bin/gemini`],
  ]);
  const r = pickTool(procs);
  assert.equal(r.best.tool, 'codex');
  assert.equal(r.best.pid, 6000);
  assert.deepEqual(r.hits.map((h) => h.tool), ['codex', 'gemini', 'claude', 'chatgpt', 'claude']);
});

test('apps used only when no CLI; countApps=false disables them', () => {
  const procs = procsOf([[82457, 1, '00:10', '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT']]);
  assert.equal(pickTool(procs).best.tool, 'chatgpt');
  assert.equal(pickTool(procs, { countApps: false }).best, null);
});

test('extraTools from config (regex strings)', () => {
  const procs = procsOf([
    [7100, 1, '00:10', NODE, `${NODE} /Users/me/bin/kimi-cli.js`],
    [7101, 1, '00:20', '/usr/local/bin/crush', 'crush'],
  ]);
  const r = pickTool(procs, { extraTools: { kimi: 'kimi-cli', crush: '(^|/)crush$', broken: '(' } });
  assert.equal(r.best.tool, 'other');
  assert.equal(r.best.label, 'kimi');
  assert.equal(pickTool(procs, { extraTools: { amp: 'kimi-cli' } }).best.tool, 'amp'); // known key keeps its name
});

test('real-world mixed snapshot', () => {
  const procs = procsOf([
    [1, 0, '05-00:00:00', '/sbin/launchd'],
    ...NEGATIVE.map(([, row]) => row),
    [8217, 8216, '49:40', '/Users/me/Library/Application Support/Claude-3p/claude-code/2.1.317/91184d3d9ba3/claude.app/Contents/MacOS/claude', '/Users/me/Library/Application Support/Claude-3p/claude-code/2.1.317/91184d3d9ba3/claude.app/Contents/MacOS/claude --output-format stream-json'],
    [50589, 1, '04:51:52', '/Applications/Claude.app/Contents/MacOS/Claude'],
  ]);
  const r = pickTool(procs);
  assert.equal(r.best.tool, 'claude');
  assert.equal(r.best.pid, 8217);
  assert.equal(r.best.kind, 'cli');
});

test('parseHidIdle', () => {
  const txt = `+-o IOHIDSystem  <class IOHIDSystem, id 0x100000a3c, registered, matched, active, busy 0 (0 ms), retain 22>
    | {
    |   "HIDIdleTime" = 446585833
    |   "HIDParameters" = {"HIDClickTime"=500000000}
    | }`;
  assert.equal(parseHidIdle(txt), 446);
  assert.equal(parseHidIdle('"HIDIdleTime" = 600000000000'), 600000);
  assert.equal(parseHidIdle('nothing'), null);
});

test('parseLsofCwd + detailFromCwd', () => {
  assert.equal(parseLsofCwd('p28745\nfcwd\nn/Users/me/code/whonotsleep\n'), '/Users/me/code/whonotsleep');
  assert.equal(parseLsofCwd(''), null);
  assert.equal(detailFromCwd('/Users/me/code/whonotsleep', '/Users/me'), 'whonotsleep');
  assert.equal(detailFromCwd('/Users/me/code/whonotsleep/', '/Users/me'), 'whonotsleep');
  assert.equal(detailFromCwd('/', '/Users/me'), null);
  assert.equal(detailFromCwd('/Users/me', '/Users/me'), null);
  assert.equal(detailFromCwd(null), null);
});

test('computeStatus', () => {
  assert.equal(computeStatus({ tool: 'claude', idleMs: 1000 }), 'working');
  assert.equal(computeStatus({ tool: null, idleMs: 1000 }), 'idle');
  assert.equal(computeStatus({ tool: 'claude', idleMs: 6 * 60_000 }), 'away');
  assert.equal(computeStatus({ tool: null, idleMs: 6 * 60_000 }), 'away');
  assert.equal(computeStatus({ tool: 'codex', idleMs: 6 * 60_000, awayAfterMs: 10 * 60_000 }), 'working');
  assert.equal(computeStatus({ tool: 'codex', idleMs: null }), 'working'); // unknown idle -> present
});

// ------------------------------------------------------------------ hooks
const CMD = '"/opt/homebrew/bin/node" "/Users/me/.local/share/whonotsleep/cli/bin/wns.js" ping --quiet';

test('isOurHook', () => {
  assert.ok(isOurHook({ command: 'wns ping --quiet' }));
  assert.ok(isOurHook({ command: CMD }));
  assert.ok(!isOurHook({ command: 'say ping' }));
  assert.ok(!isOurHook({ command: 'afplay /System/Library/Sounds/Ping.aiff' }));
});

test('mergeHooks into empty settings', () => {
  const { settings, changed } = mergeHooks({}, CMD);
  assert.ok(changed);
  assert.deepEqual(settings.hooks.UserPromptSubmit, [{ hooks: [{ type: 'command', command: CMD, timeout: 10 }] }]);
  assert.deepEqual(settings.hooks.Stop, [{ hooks: [{ type: 'command', command: CMD, timeout: 10 }] }]);
  assert.ok(hasOurHooks(settings));
});

test('mergeHooks preserves existing settings and hooks, is idempotent', () => {
  const orig = {
    model: 'opus', permissions: { allow: ['Bash(ls:*)'] },
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'afplay /System/Library/Sounds/Glass.aiff' }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }],
    },
  };
  const frozen = JSON.stringify(orig);
  const a = mergeHooks(orig, CMD);
  assert.equal(JSON.stringify(orig), frozen, 'input not mutated');
  assert.equal(a.settings.model, 'opus');
  assert.deepEqual(a.settings.permissions, orig.permissions);
  assert.deepEqual(a.settings.hooks.PreToolUse, orig.hooks.PreToolUse);
  assert.equal(a.settings.hooks.Stop.length, 2);
  assert.equal(a.settings.hooks.Stop[0].hooks[0].command, 'afplay /System/Library/Sounds/Glass.aiff');
  const b = mergeHooks(a.settings, CMD);
  assert.equal(b.changed, false);
  assert.deepEqual(b.settings, a.settings);
  // path change updates in place instead of duplicating
  const c = mergeHooks(a.settings, 'wns ping --quiet');
  assert.ok(c.changed);
  assert.equal(c.settings.hooks.Stop.length, 2);
  assert.equal(c.settings.hooks.Stop[1].hooks[0].command, 'wns ping --quiet');
});

test('mergeHooks dedupes multiple copies of our hook', () => {
  const s = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'wns ping --quiet' }] }, { hooks: [{ type: 'command', command: CMD }] }] } };
  const r = mergeHooks(s, CMD);
  assert.equal(r.settings.hooks.Stop.length, 1);
  assert.equal(r.settings.hooks.Stop[0].hooks[0].command, CMD);
});

test('removeHooks removes only ours and prunes empties', () => {
  const merged = mergeHooks({ theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }, { type: 'command', command: 'wns ping --quiet' }] }] } }, CMD).settings;
  const r = removeHooks(merged);
  assert.ok(r.changed);
  assert.equal(r.settings.theme, 'dark');
  assert.deepEqual(r.settings.hooks, { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] });
  const empty = removeHooks(mergeHooks({ a: 1 }, CMD).settings);
  assert.deepEqual(empty.settings, { a: 1 });
  assert.equal(removeHooks({ a: 1 }).changed, false);
});

// ------------------------------------------------------------- misc units
test('buildPlist', () => {
  const x = buildPlist({ node: '/opt/node & co/bin/node', script: '/x/wns.js', log: '/Users/me/Library/Logs/whonotsleep.log', pathEnv: '/usr/bin:/bin' });
  assert.match(x, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(x, /<key>KeepAlive<\/key><true\/>/);
  assert.match(x, /<string>\/opt\/node &amp; co\/bin\/node<\/string>\s*<string>\/x\/wns\.js<\/string>\s*<string>start<\/string>/);
  assert.match(x, /com\.whonotsleep\.agent/);
});

test('parseLaunchctlPrint', () => {
  assert.deepEqual(parseLaunchctlPrint('gui/501/com.whonotsleep.agent = {\n\tactive count = 1\n\tstate = running\n\tpid = 4321\n'), { state: 'running', pid: 4321 });
  assert.deepEqual(parseLaunchctlPrint('\tstate = not running\n'), { state: 'not', pid: null });
});

test('isEphemeral', () => {
  assert.ok(isEphemeral('/Users/me/.npm/_npx/abc123/node_modules/whonotsleep/cli/bin/wns.js'));
  assert.ok(!isEphemeral('/opt/homebrew/lib/node_modules/whonotsleep/cli/bin/wns.js'));
});

test('backoff grows and caps', () => {
  const r = () => 0.5;
  assert.equal(backoffMs(1, r), 2000);
  assert.equal(backoffMs(2, r), 4000);
  assert.equal(backoffMs(5, r), 32000);
  assert.equal(backoffMs(50, r), 300000);
  assert.equal(reportKey({ status: 'working', tool: 'claude', detail: 'x' }), 'working|claude|x');
});

test('cuteLine catches the night owl', () => {
  const now = Date.UTC(2026, 10, 10, 17, 30); // 01:30 in UTC+8
  const base = { avatar: {}, seat: 0, tzOffset: 480, lastSeen: now, emote: null, say: null, hasComputer: true };
  const room = { code: 'ABCDE', name: 'r', members: [
    { ...base, id: 'a', name: 'Ann', status: 'working', tool: 'claude', statusSince: now - 60_000, goodnightAt: now - 3600_000 },
    { ...base, id: 'b', name: 'Bob', status: 'away', tool: null, statusSince: now - 3600_000, goodnightAt: now - 7200_000 },
  ] };
  const d = deriveScene(room, now);
  assert.match(cuteLine(d, 'b'), /Ann/);
  assert.match(cuteLine(d, 'a'), /被抓到/);
});

test('untrusted server strings cannot inject terminal escapes', () => {
  assert.equal(clean('a\x1b]52;c;ZXZpbA==\x07b\u009b31m‮c'), 'a]52;c;ZXZpbA==b31mc');
  assert.equal(clean(null), '');
  const now = Date.UTC(2026, 0, 1, 12);
  const room = {
    code: 'ABCDE', name: '\x1b[2J房间',
    members: [
      { id: 'a', name: '小明\x1b[31m', status: 'working', tool: 'claude', detail: 'x\u009by', tzOffset: 480, lastSeen: now, statusSince: now - 60000, say: { text: '你好\x07', at: now } },
      { id: 'b', name: null, status: 'idle', tzOffset: -300, lastSeen: now - 10 * 60000 },
    ],
    events: [{ at: now, memberId: 'a', kind: 'say', text: 'hi\x1b[0m' }, { at: now, memberId: 'zz', kind: 'left' }],
  };
  const out = renderRoom(room, { now }) + renderEvents(room, { now });
  assert.ok(!/[\x1b\x07\u009b]/.test(out), out);
  assert.match(out, /小明/);
  assert.equal(renderRoom({ code: 'X', members: [] }, { now }).includes('空房间'), true);
});
