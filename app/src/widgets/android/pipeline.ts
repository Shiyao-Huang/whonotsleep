// Pure render pipeline for the Android widgets: room JSON -> deriveScene ->
// renderScene -> (crop) -> encodePNG(pako) -> data URI.
// No React Native imports here so it can be exercised from Node
// (`node src/widgets/android/__smoke__.mjs`, Node >= 23 strips the types).
// Only erasable TypeScript syntax is allowed in this file.
import { deflate } from 'pako';
import * as protocolMod from '../../../../shared/protocol.js';
import * as sceneMod from '../../../../shared/scene.js';
import * as pngMod from '../../../../shared/png.js';

export type Layout = 'room' | 'wide' | 'small';

export interface Session {
  serverUrl: string;
  roomCode: string;
  token: string;
  memberId: string;
}

export interface Frame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface DerivedMember {
  id: string;
  name: string;
  status: string;
  tool: string | null;
  online: boolean;
  pose: 'typing' | 'sitting' | 'empty' | 'sleeping' | 'gone';
  nightOwl: boolean;
  saidGoodnight: boolean;
  badge: 'caught' | 'question' | null;
}

export interface Derived {
  code?: string;
  name?: string;
  members: DerivedMember[];
  owls: string[];
  roomHour: number;
  lightsOn: boolean;
}

interface SceneAPI {
  renderScene(derived: unknown, opts: { layout?: Layout; t?: number; focusId?: string | null }): Frame;
}
interface PngAPI {
  encodePNG(
    width: number,
    height: number,
    rgba: Uint8ClampedArray | Uint8Array,
    opts: { scale?: number; deflate: (d: Uint8Array) => Uint8Array },
  ): Uint8Array;
  bytesToBase64(bytes: Uint8Array): string;
}
interface ProtocolAPI {
  deriveScene(room: unknown, now: number): unknown;
  TOOLS: Record<string, { label: string; color: number[] }>;
}

const scene = sceneMod as unknown as SceneAPI;
const png = pngMod as unknown as PngAPI;
const protocol = protocolMod as unknown as ProtocolAPI;

/** Data URI length budget (RemoteViews/bitmap budget, see DESIGN.md). */
export const MAX_URI_LENGTH = 400_000;
/** Never produce a bitmap larger than this many device pixels. */
const MAX_PIXELS = 2_400_000;
const MAX_SCALE = 10;
/** When upscaling to cover the area we may crop at most 20% of the scene per axis. */
const MIN_KEEP = 0.8;

// ------------------------------------------------------------ widget geometry
// Shared by the JSX trees (RoomWidget/MeWidget) and the image sizing so the
// PNG lands on an exact device-pixel grid.
export const FRAME_PADDING_DP = 4;
export const STRIP_HEIGHT_DP = { RoomWidget: 26, MeWidget: 24 } as const;
export type WidgetName = keyof typeof STRIP_HEIGHT_DP;
export const WIDGET_NAMES: WidgetName[] = ['RoomWidget', 'MeWidget'];

/** dp area available to the pixel image inside the widget frame. */
export function imageAreaDp(widget: WidgetName, widthDp: number, heightDp: number) {
  return {
    width: Math.max(32, widthDp - FRAME_PADDING_DP * 2),
    height: Math.max(32, heightDp - FRAME_PADDING_DP * 2 - STRIP_HEIGHT_DP[widget]),
  };
}

// ------------------------------------------------------------ scale + crop

export interface Fit {
  scale: number;
  cropW: number; // base pixels kept
  cropH: number;
}

/**
 * Pick an integer scale so every base pixel is exactly `scale` device pixels.
 * Prefers covering the area (cropping up to 20% of the scene per axis) over
 * leaving big margins; never crops more than that.
 */
export function chooseFit(baseW: number, baseH: number, areaPxW: number, areaPxH: number): Fit {
  const fit = Math.max(1, Math.floor(Math.min(areaPxW / baseW, areaPxH / baseH)));
  let scale = Math.min(MAX_SCALE, Math.max(fit, Math.floor(Math.max(areaPxW / baseW, areaPxH / baseH))));
  const dims = (s: number) => ({
    cropW: Math.max(1, Math.min(baseW, Math.floor(areaPxW / s))),
    cropH: Math.max(1, Math.min(baseH, Math.floor(areaPxH / s))),
  });
  let d = dims(scale);
  while (scale > 1) {
    const okCrop = scale <= fit || (d.cropW >= baseW * MIN_KEEP && d.cropH >= baseH * MIN_KEEP);
    const okPixels = d.cropW * scale * d.cropH * scale <= MAX_PIXELS;
    if (okCrop && okPixels) break;
    scale -= 1;
    d = dims(scale);
  }
  return { scale, ...d };
}

/** Center-crop an RGBA frame to w x h base pixels (no-op when same size). */
export function cropFrame(frame: Frame, w: number, h: number): Frame {
  if (w >= frame.width && h >= frame.height) return frame;
  w = Math.min(w, frame.width);
  h = Math.min(h, frame.height);
  const x0 = Math.floor((frame.width - w) / 2);
  const y0 = Math.floor((frame.height - h) / 2);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * frame.width + x0) * 4;
    out.set(frame.data.subarray(src, src + w * 4), y * w * 4);
  }
  return { width: w, height: h, data: out };
}

export interface RenderedImage {
  uri: string; // data:image/png;base64,...
  widthDp: number; // pass as ImageWidget imageWidth (=> exact px after dpToPx rounding)
  heightDp: number;
  widthPx: number;
  heightPx: number;
  scale: number;
  uriLength: number;
}

export interface RenderOptions {
  layout: Layout;
  focusId?: string | null;
  widthDp: number; // area available for the image
  heightDp: number;
  density: number;
  now?: number;
  maxUriLength?: number;
}

export function derive(room: unknown, now: number = Date.now()): Derived {
  return protocol.deriveScene(room ?? { members: [] }, now) as Derived;
}

/** Render a derived scene into a crisp, size-capped PNG data URI. */
export function renderDerivedImage(derived: Derived, opts: RenderOptions): RenderedImage {
  const now = opts.now ?? Date.now();
  const density = opts.density > 0 ? opts.density : 2;
  const maxLen = opts.maxUriLength ?? MAX_URI_LENGTH;
  const frame = scene.renderScene(derived, { layout: opts.layout, t: now, focusId: opts.focusId ?? null });
  const areaW = Math.round(opts.widthDp * density);
  const areaH = Math.round(opts.heightDp * density);
  let { scale } = chooseFit(frame.width, frame.height, areaW, areaH);

  for (;;) {
    const cropW = Math.max(1, Math.min(frame.width, Math.floor(areaW / scale)));
    const cropH = Math.max(1, Math.min(frame.height, Math.floor(areaH / scale)));
    const f = cropFrame(frame, cropW, cropH);
    const bytes = png.encodePNG(f.width, f.height, f.data, {
      scale,
      deflate: (d: Uint8Array) => deflate(d, { level: 6 }),
    });
    const uri = 'data:image/png;base64,' + png.bytesToBase64(bytes);
    if (uri.length <= maxLen || scale <= 1) {
      const widthPx = f.width * scale;
      const heightPx = f.height * scale;
      return {
        uri,
        widthDp: widthPx / density,
        heightDp: heightPx / density,
        widthPx,
        heightPx,
        scale,
        uriLength: uri.length,
      };
    }
    scale -= 1;
  }
}

export function renderRoomImage(room: unknown, opts: RenderOptions): RenderedImage {
  return renderDerivedImage(derive(room, opts.now), opts);
}

// ------------------------------------------------------------ status strings

export function roomStatusText(d: Derived): string {
  const online = d.members.filter((m) => m.online).length;
  const owls = d.owls.length;
  const typing = d.members.filter((m) => m.pose === 'typing').length;
  const sleeping = d.members.filter((m) => m.pose === 'sleeping').length;
  const head = `${online}人在线`;
  if (owls) return `${head} · ${owls}个夜猫子🦉`;
  if (typing) return `${head} · ${typing}人在肝AI⌨️`;
  if (sleeping) return `${head} · ${sleeping}人睡了💤`;
  if (!d.members.length) return '房间空空的';
  return `${head} · 大家都很乖`;
}

export function meStatusText(d: Derived, memberId: string | null | undefined): string {
  const me = d.members.find((m) => m.id === memberId);
  if (!me) return roomStatusText(d);
  if (me.nightOwl) return '被抓包了！😱';
  switch (me.pose) {
    case 'typing': {
      const label = (me.tool && protocol.TOOLS[me.tool]?.label) || 'AI';
      return `${label}中⌨️`;
    }
    case 'sitting':
      return '发呆中☕';
    case 'empty':
      return '离开座位';
    case 'sleeping':
      return d.owls.length ? '睡着了…❓' : '睡觉中💤';
    default:
      return '离线';
  }
}

export function meSaidGoodnight(d: Derived, memberId: string | null | undefined): boolean {
  return !!d.members.find((m) => m.id === memberId)?.saidGoodnight;
}
