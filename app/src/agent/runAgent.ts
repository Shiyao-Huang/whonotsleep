// Agent loop: model -> tool_use -> execute -> tool_result -> model ... until end_turn.
// Robust to GLM quirks: string-JSON tool input, missing ids, unknown tool names,
// tool_use blocks with stop_reason 'end_turn', empty text.
import { AiContentBlock, AiError, AiMessage, callMessages } from '../ai';
import { Session } from '../api';
import { AGENT_TOOLS, executeTool, findTool, toolLabelZh } from './tools';
import { AgentContext, RunState } from './types';

export const MAX_MODEL_CALLS = 8;
const MAX_TOOLS_PER_STEP = 6;

export type AgentEvent =
  | { type: 'text'; text: string; truncated?: boolean }
  | { type: 'tool_start'; id: string; name: string; label: string; input: Record<string, unknown> }
  | { type: 'tool_end'; id: string; name: string; label: string; ok: boolean; result: Record<string, unknown> }
  | { type: 'error'; text: string };

export function parseToolInput(raw: unknown): Record<string, any> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, any>;
  if (typeof raw === 'string') {
    let s = raw.trim();
    // strip ```json fences GLM sometimes adds
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    for (let i = 0; i < 2 && typeof s === 'string'; i++) {
      try {
        const v: any = JSON.parse(s);
        if (v && typeof v === 'object' && !Array.isArray(v)) return v;
        if (typeof v === 'string') {
          s = v; // double-encoded
          continue;
        }
        return {};
      } catch {
        const m = s.match(/\{[\s\S]*\}/);
        if (m && m[0] !== s) {
          s = m[0];
          continue;
        }
        return {};
      }
    }
  }
  return {};
}

/** Remove leaked tool-call markup / thinking tags from model text. */
export function cleanText(t: string): string {
  return (t || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?(tool_call|function_call|tool_use)[^>]*>[\s\S]*?(<\/(tool_call|function_call|tool_use)>|$)/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type NormBlock = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, any> };

export function normalizeContent(content: any[], step: number): NormBlock[] {
  const out: NormBlock[] = [];
  const seen = new Set<string>();
  let n = 0;
  for (const b of Array.isArray(content) ? content : []) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'text' && typeof b.text === 'string') {
      if (b.text.trim()) out.push({ type: 'text', text: b.text });
    } else if (b.type === 'tool_use' || b.type === 'function_call' || b.type === 'tool_call') {
      const name = String(b.name || b.function?.name || '');
      if (!name) continue;
      // Anthropic requires ids matching ^[a-zA-Z0-9_-]+$ and unique per message; GLM may
      // omit them, reuse them, or use other characters. Every tool_use must pair 1:1 with a tool_result.
      let id = typeof b.id === 'string' ? b.id.replace(/[^a-zA-Z0-9_-]/g, '_') : '';
      if (!id || seen.has(id)) id = `toolu_wns_${step}_${n}`;
      seen.add(id);
      n++;
      out.push({ type: 'tool_use', id, name, input: parseToolInput(b.input ?? b.arguments ?? b.function?.arguments) });
    }
  }
  return out;
}

export function friendlyError(e: unknown): string {
  if (e instanceof AiError) {
    if (e.status === 429) return '我被问得太快啦 😵 歇一分钟再找我吧～';
    if (e.status === 503) return 'AI 小管家暂时下班了（服务器 AI 不可用），晚点再来哦 🌙';
    return e.message;
  }
  return (e as any)?.message || String(e);
}

/**
 * Run one user turn. `history` = earlier user/assistant text turns (alternating,
 * starting with user). Returns the final assistant text.
 */
export async function runAgent(opts: {
  session: Session;
  ctx: AgentContext;
  history: AiMessage[];
  userText: string;
  run: RunState;
  /** Rebuilt before every model call so the live context is fresh. */
  system: () => Promise<string>;
  onEvent: (e: AgentEvent) => void;
  signal?: AbortSignal;
}): Promise<{ text: string; aborted: boolean }> {
  const { ctx, run, onEvent, signal } = opts;
  const messages: AiMessage[] = [...opts.history];
  // keep strict alternation: merge into a trailing user message if present
  const last = messages[messages.length - 1];
  if (last && last.role === 'user' && typeof last.content === 'string') {
    messages[messages.length - 1] = { role: 'user', content: last.content + '\n' + opts.userText };
  } else messages.push({ role: 'user', content: opts.userText });

  let finalText = '';
  for (let step = 0; step < MAX_MODEL_CALLS; step++) {
    if (signal?.aborted) return { text: finalText, aborted: true };
    let resp;
    try {
      resp = await callMessages({ session: opts.session, system: await opts.system(), messages, tools: AGENT_TOOLS, maxTokens: 1024, signal });
    } catch (e) {
      if (e instanceof AiError && e.status === -1) return { text: finalText, aborted: true };
      onEvent({ type: 'error', text: friendlyError(e) });
      return { text: finalText, aborted: false };
    }
    if (signal?.aborted) return { text: finalText, aborted: true };
    const blocks = normalizeContent(resp.content, step);
    const text = cleanText(blocks.filter((b) => b.type === 'text').map((b) => (b as any).text).join('\n'));
    const uses = blocks.filter((b) => b.type === 'tool_use') as Extract<NormBlock, { type: 'tool_use' }>[];
    if (text) {
      onEvent({ type: 'text', text, truncated: resp.stop_reason === 'max_tokens' && !uses.length });
      finalText = text;
    }
    // execute tools whenever tool_use blocks exist (GLM may report end_turn anyway)
    if (!uses.length) {
      if (!text) onEvent({ type: 'text', text: step === 0 ? '嗯…我好像走神了，再说一次？🤔' : '搞定啦 ✓' });
      return { text: finalText, aborted: false };
    }
    const runNow = uses.slice(0, MAX_TOOLS_PER_STEP);
    const assistantBlocks: AiContentBlock[] = [];
    if (text) assistantBlocks.push({ type: 'text', text });
    // echo canonical tool names back (the upstream may reject names that are not in `tools`
    // or that break ^[a-zA-Z0-9_-]{1,64}$); unknown names are sanitized and get an error result.
    for (const u of runNow)
      assistantBlocks.push({
        type: 'tool_use',
        id: u.id,
        name: findTool(u.name) || u.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'unknown_tool',
        input: u.input,
      });
    messages.push({ role: 'assistant', content: assistantBlocks });

    const results: AiContentBlock[] = [];
    for (const u of runNow) {
      if (signal?.aborted) return { text: finalText, aborted: true };
      const real = findTool(u.name) || u.name;
      const label = toolLabelZh(real);
      onEvent({ type: 'tool_start', id: u.id, name: real, label, input: u.input });
      const { ok, result } = await executeTool(u.name, u.input, ctx, run);
      onEvent({ type: 'tool_end', id: u.id, name: real, label, ok, result });
      let content = JSON.stringify(result);
      if (content.length > 6000) content = content.slice(0, 6000) + '…(截断)';
      results.push({ type: 'tool_result', tool_use_id: u.id, content, ...('error' in result ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
    // session ended by a tool (leave_room): our token is gone, stop here
    if (!ctx.getSession()) {
      onEvent({ type: 'text', text: '已经帮你搬出房间啦，有缘再见 👋' });
      return { text: finalText, aborted: false };
    }
  }
  onEvent({ type: 'text', text: '步骤有点多，我先停一下～还需要什么再告诉我 🙏' });
  return { text: finalText, aborted: false };
}
