// Typed bridge to the plain-JS shared modules in ../../shared (protocol + renderer).
// Everything in the app imports shared code through this file so the types live in one place.
import * as Protocol from '../../shared/protocol.js';
// scene.js is written by the renderer owner; types are declared below against DESIGN.md.
// @ts-ignore -- plain JS module, typed via the cast below
import * as SceneModule from '../../shared/scene.js';

export type Avatar = { skin: number; hair: number; hairStyle: number; shirt: number; accessory: number };
export type MemberStatus = 'offline' | 'idle' | 'working' | 'away';
export type Member = {
  id: string;
  name: string;
  avatar: Avatar;
  seat: number;
  status: MemberStatus;
  tool: string | null;
  detail: string | null;
  tzOffset: number;
  lastSeen: number;
  statusSince: number;
  goodnightAt: number | null;
  emote: { kind: string; at: number; from: string | null } | null;
  say: { text: string; at: number } | null;
  hasComputer: boolean;
};
export type RoomEvent = { at: number; memberId: string; kind: string; text: string };
export type Room = { code: string; name: string; createdAt: number; members: Member[]; events: RoomEvent[] };

export type Pose = 'typing' | 'sitting' | 'empty' | 'sleeping' | 'gone';
export type DerivedMember = Member & {
  online: boolean;
  localHour: number;
  night: boolean;
  saidGoodnight: boolean;
  pose: Pose;
  nightOwl: boolean;
  badge: 'caught' | 'question' | null;
  activeEmote: Member['emote'];
  activeSay: Member['say'];
};
export type DerivedScene = {
  code: string;
  name: string;
  members: DerivedMember[];
  owls: string[];
  roomHour: number;
  lightsOn: boolean;
};

export type LayoutName = 'room' | 'wide' | 'small';
export type RGBAFrame = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
export type Anchor = { id: string; x: number; y: number };

type SceneApi = {
  LAYOUTS?: Record<LayoutName, { w: number; h: number }>;
  renderScene?: (d: DerivedScene, o: { layout?: LayoutName; t?: number; focusId?: string | null }) => RGBAFrame;
  renderAvatar?: (a: Avatar, o: { t?: number; size?: number }) => RGBAFrame;
  avatarPalette?: (a: Avatar) => Record<string, string>;
  memberAnchors?: (d: DerivedScene, layout: LayoutName) => Anchor[];
};
export const Scene: SceneApi = (SceneModule || {}) as SceneApi;

export const LAYOUTS: Record<LayoutName, { w: number; h: number }> = Scene.LAYOUTS || {
  room: { w: 192, h: 120 },
  wide: { w: 192, h: 88 },
  small: { w: 96, h: 96 },
};

export const DEFAULT_SERVER: string = Protocol.DEFAULT_SERVER;
export const TOOLS: Record<string, { label: string; color: number[] }> = Protocol.TOOLS;
export const EMOTES: string[] = Protocol.EMOTES;
export const AVATAR_COUNTS: Avatar = Protocol.AVATAR_COUNTS as Avatar;
export const MAX_MEMBERS: number = Protocol.MAX_MEMBERS;

export function deriveScene(room: Room, now: number): DerivedScene {
  return Protocol.deriveScene(room as any, now) as unknown as DerivedScene;
}
export function avatarFromSeed(seed: string): Avatar {
  return Protocol.avatarFromSeed(seed) as Avatar;
}
export const localHour: (m: { tzOffset: number }, now: number) => number = Protocol.localHour as any;
export const isNightHour: (h: number) => boolean = Protocol.isNightHour;
