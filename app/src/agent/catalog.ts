// Human (Chinese) names for avatar traits, emotes, screens and tools.
// Colours read from shared/render/avatar.js + palette.js (avatarPalette) — keep in sync.
import { AVATAR_COUNTS, Avatar, EMOTES } from '../shared';
import { EMOTE_EMOJI, EMOTE_NAME } from '../format';

export type TraitKey = keyof Avatar;
export type TraitOption = { index: number; name: string; hex?: string; aliases: string[] };

const opt = (index: number, name: string, hex: string | undefined, aliases: string[]): TraitOption => ({ index, name, hex, aliases });

export const TRAIT_LABEL: Record<TraitKey, string> = {
  skin: '肤色',
  hair: '发色',
  hairStyle: '发型',
  shirt: '衣服',
  accessory: '配件',
};

export const AVATAR_CATALOG: Record<TraitKey, TraitOption[]> = {
  // skin 0..5 light -> dark
  skin: [
    opt(0, '白皙', '#ffdcbe', ['白', '白皙', '很白', '最白', 'fair', 'pale', 'light']),
    opt(1, '浅肤', '#efbd92', ['浅', '浅肤', '自然', '浅色']),
    opt(2, '小麦', '#d89a6d', ['小麦', '小麦色', '健康', 'tan']),
    opt(3, '蜜糖棕', '#b6744e', ['蜜糖', '蜜色', '焦糖', '棕', '中等']),
    opt(4, '深棕', '#874f33', ['深棕', '巧克力', '深', 'brown']),
    opt(5, '黝黑', '#55301f', ['黝黑', '黑', '最深', '很黑', 'dark']),
  ],
  hair: [
    opt(0, '墨黑', '#1a1a3b', ['黑', '黑色', '墨黑', '乌黑', 'black']),
    opt(1, '黑棕', '#382126', ['黑棕', '深棕', '深咖', 'dark brown']),
    opt(2, '栗棕', '#744737', ['栗', '栗色', '棕', '棕色', '咖啡', 'brown']),
    opt(3, '焦糖橘', '#d4844a', ['橘', '橙', '橘色', '橙色', '焦糖', '姜黄', 'orange', 'ginger']),
    opt(4, '金黄', '#e9c84f', ['金', '金色', '金黄', '黄', '黄色', 'blonde', 'gold', 'yellow']),
    opt(5, '银灰', '#978f9f', ['灰', '银', '银灰', '奶奶灰', '白发', 'grey', 'gray', 'silver']),
    opt(6, '玫粉', '#bf5490', ['粉', '粉色', '玫红', '玫粉', '红', 'pink']),
    opt(7, '宝蓝', '#3e6ec5', ['蓝', '蓝色', '宝蓝', 'blue']),
    opt(8, '墨绿', '#25766a', ['绿', '绿色', '墨绿', '青', 'green', 'teal']),
    opt(9, '葡萄紫', '#684cac', ['紫', '紫色', '葡萄紫', 'purple', 'violet']),
  ],
  hairStyle: [
    opt(0, '乱毛', undefined, ['乱', '乱毛', '凌乱', '鸡窝', '睡醒', 'messy']),
    opt(1, '长发', undefined, ['长', '长发', '披肩', 'long']),
    opt(2, '刺猬头', undefined, ['刺', '刺猬', '刺猬头', '炸毛', '朋克', 'spiky']),
    opt(3, '波波头', undefined, ['波波', '波波头', '短发', '齐肩', 'bob']),
    opt(4, '丸子头', undefined, ['丸子', '丸子头', '包子头', '发髻', 'bun']),
    opt(5, '寸头', undefined, ['寸', '寸头', '平头', '光头', 'buzz']),
  ],
  shirt: [
    opt(0, '珊瑚红T恤', '#d8675a', ['红', '红色', '珊瑚', '珊瑚红', 'red', 'coral']),
    opt(1, '橙色卫衣', '#f07c3c', ['橙', '橘', '橙色', '橘色', 'orange']),
    opt(2, '柠檬黄T恤', '#e9c84f', ['黄', '黄色', '柠檬', 'yellow']),
    opt(3, '森林绿T恤', '#467e3d', ['深绿', '森林绿', '军绿', '绿', 'green']),
    opt(4, '薄荷绿卫衣', '#3eae8e', ['薄荷', '薄荷绿', '青', 'mint', 'teal']),
    opt(5, '天蓝T恤', '#6f9fef', ['蓝', '蓝色', '天蓝', 'blue']),
    opt(6, '葡萄紫T恤', '#684cac', ['紫', '紫色', 'purple']),
    opt(7, '玫粉卫衣', '#bf5490', ['粉', '粉色', '玫粉', 'pink']),
    opt(8, '灰色T恤', '#978f9f', ['灰', '灰色', 'grey', 'gray']),
    opt(9, '藏青T恤', '#313567', ['藏青', '深蓝', '海军蓝', '黑', '黑色', 'navy']),
    opt(10, '白色卫衣', '#f6f2ea', ['白', '白色', 'white']),
    opt(11, '咖啡棕T恤', '#986344', ['棕', '棕色', '咖啡', '咖啡色', 'brown']),
  ],
  accessory: [
    opt(0, '无', undefined, ['无', '没有', '不戴', '去掉', '摘掉', '取消', 'none', 'no']),
    opt(1, '眼镜', undefined, ['眼镜', '镜', 'glasses']),
    opt(2, '耳机', undefined, ['耳机', '头戴耳机', 'headphones', 'headphone']),
    opt(3, '帽子', undefined, ['帽', '帽子', '鸭舌帽', 'cap', 'hat']),
    opt(4, '猫耳', undefined, ['猫', '猫耳', '猫耳朵', '猫猫', 'catears', 'cat ears', 'cat']),
  ],
};

export const TRAIT_KEYS: TraitKey[] = ['skin', 'hair', 'hairStyle', 'shirt', 'accessory'];

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-·的色]/g, '');

/**
 * Resolve a trait value given as an index (number or numeric string), a Chinese/English
 * name, "随机"/"random", or "下一个"/"next". Returns null when nothing matches.
 */
export function resolveTrait(key: TraitKey, value: unknown, current = 0): number | null {
  const n = AVATAR_COUNTS[key] || 1;
  const wrap = (i: number) => ((Math.round(i) % n) + n) % n;
  if (typeof value === 'number' && Number.isFinite(value)) return value >= 0 && value < n ? Math.round(value) : null;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const i = parseInt(raw, 10);
    return i >= 0 && i < n ? i : null;
  }
  const v = norm(raw);
  if (/^(随机|random|随便|rand)$/.test(v)) return Math.floor(Math.random() * n);
  if (/^(下一个|下个|next|换一个)$/.test(v)) return wrap(current + 1);
  if (/^(上一个|上个|prev|previous)$/.test(v)) return wrap(current - 1);
  const opts = AVATAR_CATALOG[key];
  // 1) exact name / alias
  for (const o of opts) if (norm(o.name) === v || o.aliases.some((a) => norm(a) === v)) return o.index;
  // 2) input contains a name/alias (longest alias wins: "深绿" beats "绿")
  let best: { i: number; len: number } | null = null;
  for (const o of opts)
    for (const a of [o.name, ...o.aliases]) {
      const na = norm(a);
      if (na && v.includes(na) && (!best || na.length > best.len)) best = { i: o.index, len: na.length };
    }
  if (best) return best.i;
  // 3) a name contains the input
  for (const o of opts) if (norm(o.name).includes(v)) return o.index;
  return null;
}

export function traitName(key: TraitKey, index: number): string {
  return AVATAR_CATALOG[key][index]?.name ?? String(index);
}

export function describeAvatar(a: Avatar | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!a) return out;
  for (const k of TRAIT_KEYS) out[TRAIT_LABEL[k]] = `${traitName(k, a[k] || 0)}(${a[k] || 0})`;
  return out;
}

export function describeAvatarLine(a: Avatar | null | undefined): string {
  if (!a) return '未知';
  return TRAIT_KEYS.map((k) => `${TRAIT_LABEL[k]}=${traitName(k, a[k] || 0)}`).join('，');
}

// ------------------------------------------------------------------ emotes

const EMOTE_ALIASES: Record<string, string[]> = {
  question: ['问号', '疑问', '?', '？', '❓'],
  exclaim: ['感叹号', '惊讶', '!', '！', '❗'],
  zzz: ['呼噜', '睡觉', '困', 'zzz', '💤'],
  heart: ['爱心', '心', '喜欢', '比心', '❤️', '❤'],
  note: ['哼歌', '音符', '唱歌', '🎵'],
  sweat: ['流汗', '汗', '尴尬', '💦'],
  star: ['星星', '星', '厉害', '⭐'],
  wave: ['挥手', '招手', '嗨', '你好', '拜拜', '👋'],
  angry: ['生气', '怒', '愤怒', '💢'],
  moon: ['月亮', '晚安', '🌙'],
};

export function resolveEmote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (EMOTES.includes(v)) return v;
  for (const k of EMOTES) if ((EMOTE_ALIASES[k] || []).some((a) => a.toLowerCase() === v) || EMOTE_NAME[k] === v || EMOTE_EMOJI[k] === v) return k;
  for (const k of EMOTES) if ((EMOTE_ALIASES[k] || []).some((a) => a.length > 1 && v.includes(a.toLowerCase()))) return k;
  return null;
}

export function emoteCatalog(): { kind: string; name: string; emoji: string }[] {
  return EMOTES.map((k) => ({ kind: k, name: EMOTE_NAME[k] || k, emoji: EMOTE_EMOJI[k] || '' }));
}
