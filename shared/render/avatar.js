// WhoNotSleep renderer — avatar traits -> palette indices / CSS hex.
// skin 6, hair colour 10, hairStyle 6, shirt 12, accessory 5 (AVATAR_COUNTS).
import { P, hexOf } from './palette.js';

const SKIN = ['s5', 's4', 's3', 's2', 's1', 's0'];
const HAIR = ['ink2', 'w1', 'w3', 'a1', 'y2', 'g4', 'p2', 'b2', 't2', 'v2'];
const SHIRT = ['r3', 'o2', 'y2', 'e3', 't3', 'b3', 'v2', 'p2', 'g4', 'ink4', 'white', 'w4'];
export const ACCESSORIES = ['none', 'glasses', 'headphones', 'cap', 'catears'];
export const HAIR_STYLES = ['messy', 'long', 'spiky', 'bob', 'bun', 'buzz'];

// one-step darker / lighter along hand-built ramps
const RAMPS = [
  ['ink0', 'ink1', 'ink2', 'ink3', 'ink4', 'ink5', 'ink6', 'ink7', 'mist', 'frost', 'white'],
  ['s0', 's1', 's2', 's3', 's4', 's5'], ['w0', 'w1', 'w2', 'w3', 'w4', 'w5'],
  ['r0', 'r1', 'r2', 'r3', 'r4'], ['v0', 'v1', 'v2', 'v3', 'v4'], ['t0', 't1', 't2', 't3', 't4', 't5'],
  ['e1', 'e2', 'e3', 'e4'], ['b1', 'b2', 'b3', 'b4'], ['g1', 'g2', 'g3', 'g4', 'g5'],
  ['w2', 'a1', 'a2', 'a3', 'a4'], ['r1', 'p2', 'p3'], ['a1', 'y2'], ['r2', 'o2'],
];
export const DARK = {}, LIGHT = {};
for (const r of RAMPS) for (let i = 0; i < r.length; i++) {
  if (DARK[r[i]] === undefined) DARK[r[i]] = r[Math.max(0, i - 1)];
  if (LIGHT[r[i]] === undefined) LIGHT[r[i]] = r[Math.min(r.length - 1, i + 1)];
}
DARK.white = 'frost'; DARK.y2 = 'a1'; DARK.o2 = 'r2'; DARK.g4 = 'g3'; DARK.p2 = 'r1';
LIGHT.ink2 = 'ink5'; DARK.ink2 = 'ink1'; LIGHT.y2 = 'a4'; LIGHT.o2 = 'a2'; LIGHT.w1 = 'w3';
// eye colour per skin: dark skins get a deeper ink so the glint still pops
const EYE = ['ink1', 'ink1', 'ink1', 'ink0', 'ink0', 'ink0'];
// blush per skin
const BLUSH = ['r4', 'r4', 'r3', 'r3', 'r2', 'r2'];

const wrap = (i, n) => ((((i | 0) % n) + n) % n);
const pick = (arr, i) => arr[wrap(i, arr.length)];
const CACHE = new Map();

/** palette indices for an avatar (cached per trait combo) */
export function avatarColors(av) {
  if (!av || typeof av !== "object") av = {};
  const key = wrap(av.skin, 6) + wrap(av.hair, 10) * 6 + wrap(av.hairStyle, 6) * 60 + wrap(av.shirt, 12) * 360 + wrap(av.accessory, 5) * 4320;
  let k = CACHE.get(key);
  if (k) return k;
  const si = wrap(av.skin, 6);
  const skin = SKIN[si], hair = pick(HAIR, av.hair), shirt = pick(SHIRT, av.shirt);
  k = {
    skinI: si,
    skin: P[skin], skinD: P[DARK[skin]], skinDD: P[DARK[DARK[skin]]], skinL: P[LIGHT[skin]],
    hair: P[hair], hairD: P[DARK[hair]], hairL: P[LIGHT[hair]],
    shirt: P[shirt], shirtD: P[DARK[shirt]], shirtDD: P[DARK[DARK[shirt]]], shirtL: P[LIGHT[shirt]],
    eye: P[EYE[si]], blush: P[BLUSH[si]],
    style: wrap(av.hairStyle, 6), acc: wrap(av.accessory, 5),
    hoodie: wrap(av.shirt, 12) % 3 === 1,
  };
  CACHE.set(key, k);
  return k;
}

/** CSS hex colours for UI chips */
export function avatarPalette(av) {
  if (!av || typeof av !== "object") av = {};
  const k = avatarColors(av);
  return {
    skin: hexOf(k.skin), skinShadow: hexOf(k.skinD), hair: hexOf(k.hair), hairShadow: hexOf(k.hairD),
    hairHighlight: hexOf(k.hairL), shirt: hexOf(k.shirt), shirtShadow: hexOf(k.shirtD), accent: hexOf(k.shirtL),
    eye: hexOf(k.eye), blush: hexOf(k.blush),
    accessory: ACCESSORIES[k.acc], hairStyle: HAIR_STYLES[k.style],
  };
}
