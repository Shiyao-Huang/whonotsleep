// Tools the AI agent can call to operate the whole app. Each tool = Anthropic tool
// definition (JSON schema) + an executor bound to the AgentContext. Executors never
// throw: they return a compact JSON-able result or { error }.
import { ApiError, Session, api, errText, normalizeServer } from '../api';
import { fetchAiStatus, generateLine, loadAiKey } from '../ai';
import { AVATAR_COUNTS, Avatar, DEFAULT_SERVER, DerivedMember, EMOTES, MAX_MEMBERS, deriveScene } from '../shared';
import { eventText, statusChip } from '../format';
import { toolLabel } from '../theme';
import type { AiTool } from '../ai';
import {
  AVATAR_CATALOG,
  TRAIT_KEYS,
  TRAIT_LABEL,
  TraitKey,
  describeAvatar,
  emoteCatalog,
  resolveEmote,
  resolveTrait,
  traitName,
} from './catalog';
import { AGENT_SCREENS, AgentContext, AgentScreen, RunState } from './types';

export type ToolResult = Record<string, unknown>;
type Executor = (input: Record<string, any>, ctx: AgentContext, run: RunState) => Promise<ToolResult>;
type ToolSpec = AiTool & { label: string; run: Executor };

const SCREEN_NAME: Record<string, string> = {
  room: '房间',
  link: '连接电脑',
  settings: '设置',
  onboarding: '捏小人/改名',
  gate: '房间入口',
  assistant: 'AI 小管家',
};

const POSE_NAME: Record<string, string> = {
  typing: '在桌前用 AI 敲代码',
  sitting: '坐在电脑前发呆',
  empty: '离开座位（空椅子）',
  sleeping: '在床上睡觉',
  gone: '不在（桌子黑着）',
};

// ------------------------------------------------------------------ helpers

function needSession(ctx: AgentContext): Session {
  const s = ctx.getSession();
  if (!s) throw new ToolError('还没加入房间，先去房间入口新建或加入一个房间');
  return s;
}

class ToolError extends Error {}

function hhmm(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function nowServer(ctx: AgentContext): number {
  return Date.now() + (ctx.getClockSkew() || 0);
}

function memberSummary(m: DerivedMember, meId: string | undefined, now: number) {
  const out: Record<string, unknown> = {
    name: m.name,
    me: m.id === meId || undefined,
    pose: m.pose,
    doing: POSE_NAME[m.pose] || m.pose,
    status: statusChip(m, now).text,
    localTime: hhmm(m.localHour),
  };
  if (m.pose === 'typing') {
    out.tool = toolLabel(m.tool);
    if (m.detail) out.project = m.detail;
  }
  if (m.saidGoodnight) out.saidGoodnight = true;
  if (m.badge === 'caught') out.badge = '被抓包！(说了晚安还在用AI，头顶红色!)';
  if (m.badge === 'question') out.badge = '头顶大问号?(睡着的人看着夜猫子)';
  if (!m.online) out.online = false;
  if (m.hasComputer) out.computerLinked = true;
  if (m.activeSay) out.justSaid = m.activeSay.text;
  if (m.activeEmote) out.emote = m.activeEmote.kind;
  return out;
}

export function linkCommand(session: Session, code: string): string {
  const custom = normalizeServer(session.serverUrl) !== DEFAULT_SERVER;
  return `npx -y github:Shiyao-Huang/whonotsleep link ${code}${custom ? ` --server ${normalizeServer(session.serverUrl)}` : ''}`;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

function bool(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  if (typeof v === 'string') {
    if (/^(true|1|yes|on|开|打开|开启)$/i.test(v.trim())) return true;
    if (/^(false|0|no|off|关|关闭)$/i.test(v.trim())) return false;
  }
  return null;
}

function findMember(ctx: AgentContext, name: string) {
  const room = ctx.getRoom();
  if (!room) return { error: '房间数据还没加载好' } as const;
  const q = name.replace(/^@/, '').trim().toLowerCase();
  const ms = room.members;
  const m =
    ms.find((x) => x.name.toLowerCase() === q) ||
    ms.find((x) => x.id === name) ||
    ms.find((x) => x.name.toLowerCase().includes(q)) ||
    ms.find((x) => q.includes(x.name.toLowerCase()));
  if (!m) return { error: `房间里没有叫「${name}」的人`, members: ms.map((x) => x.name) } as const;
  return { member: m } as const;
}

/** Did the user explicitly confirm leaving in chat? */
function userConfirmedLeave(run: RunState): boolean {
  const u = run.userText.trim();
  if (/不要|不用|别|算了|取消|不搬|不走|再想想|no\b|cancel/i.test(u)) return false;
  const affirm = /^(确定|确认|是的?|对|对的|好的?|嗯+|可以|搬吧|走吧|搬|同意|没错|yes|y|ok|okay|sure|confirm)[!！。.~\s]*$/i.test(u);
  const askedBefore = /搬出|离开|退出|leave/.test(run.prevAssistantText);
  // only an explicit "确定/确认要搬出" counts on its own; a plain request ("我要搬出房间") must be asked back first
  const explicit = /(确定|确认)(要)?.{0,4}(搬出|离开|退出)(房间)?/.test(u);
  return (affirm && askedBefore) || explicit;
}

// -------------------------------------------------------------------- tools

const TOOLS: ToolSpec[] = [
  {
    name: 'get_app_state',
    label: '看看 App 状态',
    description: '读取 App 当前状态：用户从哪个页面打开的你、我的名字和造型、房间码、连接状态、AI 碎碎念开关、当前 AI 模型、电脑是否已连接。',
    input_schema: { type: 'object', properties: {} },
    run: async (_i, ctx) => {
      const s = ctx.getSession();
      const p = ctx.getProfile();
      const room = ctx.getRoom();
      const me = room?.members.find((m) => m.id === s?.memberId);
      const [chatter, key] = await Promise.all([ctx.getAiChatterEnabled(), loadAiKey()]);
      const st = s ? await fetchAiStatus(s.serverUrl) : null;
      return {
        fromScreen: SCREEN_NAME[ctx.getFromScreen()] || ctx.getFromScreen(),
        me: p ? { name: p.name, avatar: describeAvatar(p.avatar) } : null,
        inRoom: !!s,
        roomCode: s?.roomCode,
        roomName: room?.name,
        members: room ? `${room.members.length}/${MAX_MEMBERS}` : undefined,
        connection: { open: '在线', connecting: '连接中', closed: '断线重连中', paused: '后台暂停' }[ctx.getConn()],
        computerLinked: !!me?.hasComputer,
        aiChatter: chatter ? '开' : '关',
        aiModel: key ? '用户自己的 Anthropic Key' : st?.model || '服务器模型',
        server: s ? normalizeServer(s.serverUrl) : undefined,
      };
    },
  },
  {
    name: 'get_room',
    label: '看看房间',
    description: '读取房间详情：每个成员在干嘛（姿势/状态/当地时间/用什么AI工具/是否说了晚安/被抓包/问号）、夜猫子名单、最近动态。回答“谁还没睡”之类问题前先调用。',
    input_schema: {
      type: 'object',
      properties: { events: { type: 'integer', description: '返回最近几条动态，默认 10，最多 30' } },
    },
    run: async (i, ctx) => {
      const s = needSession(ctx);
      const room = ctx.getRoom();
      if (!room) return { error: '房间数据还没加载好，稍等一下' };
      const now = nowServer(ctx);
      const d = deriveScene(room, now);
      const n = Math.max(0, Math.min(30, Number(i.events) || 10));
      return {
        room: { name: d.name, code: d.code, roomTime: hhmm(d.roomHour), lightsOn: d.lightsOn },
        awake: d.members.filter((m) => m.pose === 'typing' || m.pose === 'sitting').map((m) => m.name),
        nightOwls: d.members.filter((m) => m.nightOwl).map((m) => m.name),
        members: d.members.map((m) => memberSummary(m, s.memberId, now)),
        recentEvents: (room.events || []).slice(-n).map((e) => {
          const t = new Date(e.at);
          return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} ${eventText(e, room)}`;
        }),
      };
    },
  },
  {
    name: 'list_avatar_options',
    label: '翻翻衣柜',
    description: '列出所有可选的造型选项（肤色/发色/发型/衣服/配件 的编号和中文名）以及我当前的造型。',
    input_schema: { type: 'object', properties: {} },
    run: async (_i, ctx) => {
      const out: Record<string, unknown> = {};
      for (const k of TRAIT_KEYS) out[k] = AVATAR_CATALOG[k].map((o) => `${o.index}:${o.name}`).join(' ');
      return { options: out, current: describeAvatar(ctx.getProfile()?.avatar) };
    },
  },
  {
    name: 'update_avatar',
    label: '换造型',
    description:
      '修改我的像素小人造型（部分修改，没给的保持不变）。每个字段可以填编号(整数)或中文/英文名，也可以填 "随机" 或 "下一个"。' +
      '例：{"accessory":"猫耳"}、{"hair":"粉色","hairStyle":"丸子头"}、{"shirt":3}。会保存到本机并同步到服务器。',
    input_schema: {
      type: 'object',
      properties: {
        skin: { type: 'string', description: '编号或名字。肤色 0-5 由浅到深：白皙/浅肤/小麦/蜜糖棕/深棕/黝黑' },
        hair: { type: 'string', description: '编号或名字。发色 0-9：墨黑/黑棕/栗棕/焦糖橘/金黄/银灰/玫粉/宝蓝/墨绿/葡萄紫' },
        hairStyle: { type: 'string', description: '编号或名字。发型 0-5：乱毛/长发/刺猬头/波波头/丸子头/寸头' },
        shirt: {
          type: 'string',
          description: '衣服 0-11：珊瑚红T恤/橙色卫衣/柠檬黄T恤/森林绿T恤/薄荷绿卫衣/天蓝T恤/葡萄紫T恤/玫粉卫衣/灰色T恤/藏青T恤/白色卫衣/咖啡棕T恤',
        },
        accessory: { type: 'string', description: '编号或名字。配件 0-4：无/眼镜/耳机/帽子/猫耳' },
      },
    },
    run: async (i, ctx, run) => {
      const p = ctx.getProfile();
      if (!p) return { error: '还没有小人，先去捏一个（navigate onboarding）' };
      const next: Avatar = { ...p.avatar };
      const changed: string[] = [];
      const bad: string[] = [];
      for (const k of TRAIT_KEYS) {
        if (i[k] === undefined || i[k] === null || i[k] === '') continue;
        const idx = resolveTrait(k as TraitKey, i[k], p.avatar[k] || 0);
        if (idx === null) bad.push(`${TRAIT_LABEL[k]}「${String(i[k])}」不认识，可选：${AVATAR_CATALOG[k].map((o) => `${o.index}:${o.name}`).join(' ')}`);
        else {
          next[k] = idx;
          changed.push(`${TRAIT_LABEL[k]}→${traitName(k, idx)}`);
        }
      }
      if (bad.length && !changed.length) return { error: bad.join('；') };
      if (!changed.length) return { error: '没有要改的字段，至少给一个 skin/hair/hairStyle/shirt/accessory' };
      for (const k of TRAIT_KEYS) next[k] = Math.max(0, Math.min((AVATAR_COUNTS[k] || 1) - 1, next[k] | 0));
      const s = ctx.getSession();
      if (s) await api.patchMe(s, { avatar: next });
      await ctx.setProfile({ ...p, avatar: next });
      run.avatar = next;
      return { ok: true, changed, now: describeAvatar(next), ...(bad.length ? { ignored: bad } : {}), synced: !!s };
    },
  },
  {
    name: 'rename_me',
    label: '改名字',
    description: '修改我的名字（1-24 个字符），保存到本机并同步到房间。',
    input_schema: { type: 'object', properties: { name: { type: 'string', description: '新名字' } }, required: ['name'] },
    run: async (i, ctx) => {
      const name = Array.from(str(i.name)).slice(0, 24).join('').trim();
      if (!name) return { error: '名字不能为空' };
      const p = ctx.getProfile();
      if (!p) return { error: '还没有小人，先去捏一个' };
      const s = ctx.getSession();
      if (s) await api.patchMe(s, { name });
      await ctx.setProfile({ ...p, name });
      return { ok: true, name, synced: !!s };
    },
  },
  {
    name: 'goodnight',
    label: '说晚安',
    description: '帮我说晚安：小人上床睡觉（14 小时内有效）。之后如果半夜又用 AI 就会被抓包。',
    input_schema: { type: 'object', properties: {} },
    run: async (_i, ctx) => {
      await api.goodnight(needSession(ctx));
      return { ok: true, note: '已说晚安 🌙，14 小时内再偷偷用 AI 会被抓包' };
    },
  },
  {
    name: 'morning',
    label: '说早安',
    description: '帮我说早安：清除晚安状态，小人起床。',
    input_schema: { type: 'object', properties: {} },
    run: async (_i, ctx) => {
      await api.morning(needSession(ctx));
      return { ok: true, note: '早安 ☀️，晚安状态已清除' };
    },
  },
  {
    name: 'send_emote',
    label: '发表情',
    description: `在房间里发一个表情气泡（6 秒），可以对某个人发。kind 可选：${emoteCatalog()
      .map((e) => `${e.kind}(${e.name}${e.emoji})`)
      .join(' ')}`,
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: EMOTES, description: '表情种类' },
        target: { type: 'string', description: '可选：对谁发（成员名字）' },
      },
      required: ['kind'],
    },
    run: async (i, ctx) => {
      const s = needSession(ctx);
      const kind = resolveEmote(i.kind);
      if (!kind) return { error: `不认识的表情「${String(i.kind)}」，可选：${EMOTES.join(' ')}` };
      let to: string | null = null;
      let toName: string | null = null;
      const target = str(i.target);
      if (target) {
        const r = findMember(ctx, target);
        if ('error' in r) return r as ToolResult;
        if (r.member.id !== s.memberId) {
          to = r.member.id;
          toName = r.member.name;
        }
      }
      await api.emote(s, kind, to);
      return { ok: true, kind, to: toName };
    },
  },
  {
    name: 'say',
    label: '冒个泡',
    description: '让我的小人在房间里说一句话（头顶对话气泡，最多 80 个字），朋友们都能看到。',
    input_schema: { type: 'object', properties: { text: { type: 'string', description: '要说的话，≤80 字' } }, required: ['text'] },
    run: async (i, ctx) => {
      const s = needSession(ctx);
      const raw = str(i.text);
      if (!raw) return { error: 'text 不能为空' };
      const chars = Array.from(raw.replace(/\s+/g, ' '));
      const text = chars.slice(0, 80).join('');
      await api.say(s, text);
      return { ok: true, said: text, ...(chars.length > 80 ? { truncated: true } : {}) };
    },
  },
  {
    name: 'create_link_code',
    label: '生成配对码',
    description: '生成连接电脑用的 6 位配对码（10 分钟有效），返回在 Mac 终端运行的命令。',
    input_schema: { type: 'object', properties: {} },
    run: async (_i, ctx) => {
      const s = needSession(ctx);
      const r = await api.linkCode(s);
      return { ok: true, code: r.linkCode, expiresInMin: 10, command: linkCommand(s, r.linkCode), tip: '在 Mac 终端运行（需要 Node 18+）' };
    },
  },
  {
    name: 'navigate',
    label: '跳转页面',
    description: '带用户去某个页面（在你回复完后跳转）：room=房间，link=连接电脑(会自动生成配对码)，settings=设置，onboarding=捏小人/改名页。',
    input_schema: {
      type: 'object',
      properties: { screen: { type: 'string', enum: AGENT_SCREENS } },
      required: ['screen'],
    },
    run: async (i, ctx, run) => {
      const sc = str(i.screen).toLowerCase() as AgentScreen;
      if (!AGENT_SCREENS.includes(sc)) return { error: `screen 只能是 ${AGENT_SCREENS.join('/')}` };
      if ((sc === 'room' || sc === 'link') && !ctx.getSession()) return { error: '还没加入房间' };
      run.pendingNav = sc;
      return { ok: true, willOpen: SCREEN_NAME[sc], note: '回复结束后自动跳转' };
    },
  },
  {
    name: 'set_ai_chatter',
    label: '设置碎碎念',
    description: '打开/关闭「AI 叽里呱啦」：App 打开时每 3-6 分钟让小人根据房间状况自动说一句俏皮话。',
    input_schema: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'] },
    run: async (i, ctx) => {
      const v = bool(i.enabled);
      if (v === null) return { error: 'enabled 需要是 true 或 false' };
      await ctx.setAiChatterEnabled(v);
      return { ok: true, aiChatter: v ? '开' : '关' };
    },
  },
  {
    name: 'generate_chatter_now',
    label: '碎碎念一句',
    description: '立刻让 AI 根据房间状况为我的小人生成一句可爱的碎碎念并说出来（和你自己用 say 不同，这是独立生成的）。',
    input_schema: { type: 'object', properties: {} },
    run: async (_i, ctx) => {
      const s = needSession(ctx);
      const room = ctx.getRoom();
      if (!room) return { error: '房间数据还没加载好' };
      const line = await generateLine({ session: s, room, meId: s.memberId, now: nowServer(ctx) });
      await api.say(s, line);
      return { ok: true, said: line };
    },
  },
  {
    name: 'open_share_room',
    label: '分享房间',
    description: '打开系统分享面板，把房间码发给朋友邀请他们加入（在你回复完后弹出）。',
    input_schema: { type: 'object', properties: {} },
    run: async (_i, ctx, run) => {
      const s = needSession(ctx);
      const room = ctx.getRoom();
      const name = room?.name || '谁还没睡';
      if (room && room.members.length >= MAX_MEMBERS) return { error: `房间已满（最多 ${MAX_MEMBERS} 人）` };
      run.share = `来「${name}」一起熬夜吧 🌙\n打开 WhoNotSleep（谁还没睡）输入房间码：${s.roomCode}`;
      return { ok: true, roomCode: s.roomCode, note: '回复结束后弹出分享面板' };
    },
  },
  {
    name: 'leave_room',
    label: '搬出房间',
    description:
      '【危险】让我搬出当前房间（小人消失，连接的电脑也断开，不可撤销）。' +
      '必须先用文字问用户“确定要搬出房间吗？”，只有用户在聊天里明确回答确定之后，才可以带 confirm=true 调用。不带 confirm 调用只会返回确认要求。',
    input_schema: {
      type: 'object',
      properties: { confirm: { type: 'boolean', description: '用户已在聊天中明确确认时才填 true' } },
    },
    run: async (i, ctx, run) => {
      const s = needSession(ctx);
      if (bool(i.confirm) !== true) {
        return {
          needsConfirmation: true,
          message: '这是危险操作。请先问用户“确定要搬出房间 #' + s.roomCode + ' 吗？小人会消失，电脑也会断开”，等用户明确回答确定后再用 confirm=true 调用。',
        };
      }
      if (!userConfirmedLeave(run)) {
        return {
          needsConfirmation: true,
          error: '用户还没有在聊天里明确确认。先用文字问清楚，等用户回答“确定”后再调用。',
        };
      }
      const yes = await ctx.confirm('搬出房间？', `AI 小管家想帮你搬出房间 #${s.roomCode}。小人会消失，连接的电脑也会断开。`, '搬走');
      if (!yes) return { cancelled: true, note: '用户在确认弹窗里取消了' };
      await ctx.leaveRoom();
      return { ok: true, note: '已搬出房间，回到房间入口' };
    },
  },
];

export const AGENT_TOOLS: AiTool[] = TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function toolLabelZh(name: string): string {
  return BY_NAME.get(name)?.label || name;
}

export function toolList(): { name: string; label: string }[] {
  return TOOLS.map((t) => ({ name: t.name, label: t.label }));
}

/** Tolerant name lookup (GLM sometimes adds prefixes / changes case). */
export function findTool(name: string): string | null {
  if (!name) return null;
  if (BY_NAME.has(name)) return name;
  const n = name.toLowerCase().replace(/^(functions?|tools?)[.:]/, '').replace(/[-\s]/g, '_').trim();
  if (BY_NAME.has(n)) return n;
  return null;
}

export async function executeTool(
  name: string,
  input: Record<string, any>,
  ctx: AgentContext,
  run: RunState,
): Promise<{ ok: boolean; result: ToolResult }> {
  const real = findTool(name);
  if (!real) return { ok: false, result: { error: `没有工具「${name}」。可用：${TOOLS.map((t) => t.name).join(', ')}` } };
  const spec = BY_NAME.get(real)!;
  try {
    const result = await spec.run(input && typeof input === 'object' && !Array.isArray(input) ? input : {}, ctx, run);
    return { ok: !('error' in result) && !result.needsConfirmation, result };
  } catch (e) {
    if (e instanceof ToolError) return { ok: false, result: { error: e.message } };
    if (e instanceof ApiError) return { ok: false, result: { error: errText(e), status: e.status } };
    return { ok: false, result: { error: errText(e) } };
  }
}
