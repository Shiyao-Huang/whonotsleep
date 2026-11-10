// Pretty room rendering for the terminal.
import { deriveScene, TOOLS } from '../../shared/protocol.js';
import { c, ago, STATUS_STYLE, POSE_ZH, coral, clean } from './ui.js';

/** Cute one-liner summarizing the room. Pure (given derived scene). */
export function cuteLine(d, meId = null) {
  const ms = d.members || [];
  if (!ms.length) return '(・_・)  空房间… 快拉朋友进来';
  const owls = ms.filter((m) => m.nightOwl);
  if (owls.length) {
    const names = owls.map((m) => clean(m.name)).join('、');
    return owls.some((m) => m.id === meId)
      ? `(°□°;)!  被抓到了！说好的晚安呢？还在跟 AI 聊天`
      : `(¬‿¬)?  抓到 ${names} 了！说了晚安还在偷偷肝`;
  }
  const working = ms.filter((m) => m.pose === 'typing');
  const sleeping = ms.filter((m) => m.pose === 'sleeping');
  if (working.length === ms.length) return `(ง •̀_•́)ง  全员在肝！${ms.length} 台显示器亮着`;
  if (working.length) {
    const night = working.filter((m) => m.night);
    if (night.length) return `(o_O)  凌晨了，${night.map((m) => clean(m.name)).join('、')} 还没睡…`;
    return `(•̀ᴗ•́)و  ${working.length} 个人在跟 AI 一起干活`;
  }
  if (sleeping.length === ms.length) return '(-_-) zzZ  大家都睡了，你也早点睡吧';
  return '(=^･ω･^=)  房间很安静，只有猫在走来走去';
}

export function memberLine(m, now, meId) {
  const st = STATUS_STYLE[m.status] || STATUS_STYLE.offline;
  const me = m.id === meId ? c.cyan(' (你)') : '';
  const name = c.bold(clean(m.name) || '?') + me;
  let chip = st.color(`${st.icon} ${m.status}`);
  if (m.status === 'working' && m.tool) {
    const tl = TOOLS[m.tool] || TOOLS.other;
    const [r, g, b] = tl.color;
    const parts = [tl.label];
    if (m.detail) parts.push(clean(m.detail));
    if (m.statusSince) parts.push(ago(now - m.statusSince));
    chip = c.rgb(r, g, b)(`⌨ ${parts.join(' · ')}`);
  } else if (m.statusSince && m.status !== 'offline') {
    chip += c.gray(` · ${ago(now - m.statusSince)}`);
  } else if (m.status === 'offline' && m.lastSeen) {
    chip += c.gray(` · last seen ${ago(now - m.lastSeen)} ago`);
  }
  const pose = c.gray(POSE_ZH[m.pose] || m.pose);
  const hh = Math.floor(m.localHour), mm = Math.floor((m.localHour % 1) * 60);
  const clock = c.gray(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
  let badge = '';
  if (m.badge === 'caught') badge = ' ' + c.red(c.bold('(!) 被抓包'));
  else if (m.badge === 'question') badge = ' ' + c.yellow(c.bold('(?)'));
  const gn = m.saidGoodnight ? c.magenta(' ☾晚安') : '';
  const comp = m.hasComputer ? '' : c.gray(' [未连接电脑]');
  let extra = '';
  if (m.activeSay) extra += `\n      ${c.italic(`“${clean(m.activeSay.text)}”`)}`;
  return `  ${name}${gn}${badge}${comp}\n      ${chip}  ${pose}  ${clock}${extra}`;
}

export function renderRoom(room, { now = Date.now(), meId = null } = {}) {
  const d = deriveScene(room, now);
  const lines = [];
  lines.push(`${coral('▞')} ${c.bold(clean(room.name) || 'room')} ${c.gray(`#${clean(room.code)}`)} ${c.gray(`· ${d.members.length} 人`)}`);
  for (const m of d.members) lines.push(memberLine(m, now, meId));
  lines.push('');
  lines.push('  ' + cuteLine(d, meId));
  return lines.join('\n');
}

export function renderEvents(room, { now = Date.now(), limit = 6 } = {}) {
  const evs = (room.events || []).slice(-limit);
  if (!evs.length) return '';
  const names = Object.fromEntries((room.members || []).map((m) => [m.id, clean(m.name)]));
  return evs.map((e) => c.gray(`  ${ago(now - e.at).padStart(4)} ago  `) + `${names[e.memberId] || '?'} ${clean(e.text || e.kind)}`).join('\n');
}
