// Chinese text formatting for statuses and the activity feed.
import { DerivedMember, Room, RoomEvent } from './shared';
import { toolLabel } from './theme';

export const EMOTE_EMOJI: Record<string, string> = {
  question: '❓',
  exclaim: '❗',
  zzz: '💤',
  heart: '❤️',
  note: '🎵',
  sweat: '💦',
  star: '⭐',
  wave: '👋',
  angry: '💢',
  moon: '🌙',
};
export const EMOTE_NAME: Record<string, string> = {
  question: '问号',
  exclaim: '感叹号',
  zzz: '呼噜',
  heart: '爱心',
  note: '哼歌',
  sweat: '流汗',
  star: '星星',
  wave: '挥手',
  angry: '生气',
  moon: '月亮',
};

export function duration(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时${m % 60 ? (m % 60) + '分' : ''}`;
  return `${Math.floor(h / 24)}天`;
}

export function clock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export type Chip = { text: string; kind: 'work' | 'sit' | 'away' | 'sleep' | 'gone' };

export function statusChip(m: DerivedMember, now: number): Chip {
  const dur = duration(now - (m.statusSince || now));
  switch (m.pose) {
    case 'typing':
      return { text: [toolLabel(m.tool), m.detail, dur].filter(Boolean).join(' · '), kind: 'work' };
    case 'sitting':
      return { text: `在线发呆 · ${dur}`, kind: 'sit' };
    case 'empty':
      return { text: `离开座位 · ${dur}`, kind: 'away' };
    case 'sleeping':
      return {
        text: m.saidGoodnight ? `说了晚安 · ${duration(now - (m.goodnightAt || now))}` : '睡觉中 💤',
        kind: 'sleep',
      };
    default:
      return { text: m.lastSeen ? `不在 · ${duration(now - m.lastSeen)}前` : '还没出现过', kind: 'gone' };
  }
}

const KIND_ICON: Record<string, string> = {
  joined: '🏠',
  left: '👋',
  goodnight: '🌙',
  morning: '☀️',
  started: '⌨️',
  stopped: '☕',
  'caught-night-owl': '❗',
  say: '💬',
  linked: '💻',
};

export function eventIcon(e: RoomEvent): string {
  if (e.kind === 'emote') return EMOTE_EMOJI[(e.text || '').split(/\s/)[0]] || '✨';
  return KIND_ICON[e.kind] || '·';
}

export function eventText(e: RoomEvent, room: Room): string {
  const m = room.members.find((x) => x.id === e.memberId);
  const name = m ? m.name : '有人';
  const text = e.text || '';
  if (e.kind === 'say') return `${name}：「${text}」`;
  if (e.kind === 'caught-night-owl') return `${name} 被抓包！${text.replace(/[,，]?\s*被抓到了[!！]?$/, '')}`;
  if (e.kind === 'emote') {
    const [kind, target] = text.split(/\s*→\s*/);
    const emoji = EMOTE_EMOJI[kind] || kind;
    return target ? `${name} 对 ${target} 发了 ${emoji}` : `${name} ${emoji}`;
  }
  if (!text) return `${name} · ${e.kind}`;
  return text.startsWith(name) ? text : `${name} ${text}`;
}
