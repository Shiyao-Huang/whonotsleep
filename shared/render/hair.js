// WhoNotSleep renderer — hair & head-wear bitmaps for the 12x18 desk chibi.
// Rows are 12 chars wide. H hair, h hair shadow, L highlight. `dy` = row of the first line
// relative to the head top (face row 0). `back` is drawn behind the face, `front` over it,
// `drape` over the shoulders (in front of the body).

export const HAIRS = [
  { // 0 messy short
    dy: -2,
    front: [
      '....HH.H....',
      '..HHHHHHHH..',
      '.HHLLHHHHHH.',
      '.HLLHHHHHHhh',
      'HHLHHHHHHHhh',
      'HHHHHHHHHHhh',
      'HHH.HHH.HHhh',
      'H..........h',
      'h..........h',
    ],
  },
  { // 1 long straight
    dy: -2,
    front: [
      '...HHHHHH...',
      '..HHLHHHHH..',
      '.HHLLHHHHHH.',
      'HHLLHHHHHHHh',
      'HHLHHHHHHHHh',
      'HHHHHHHHHHhh',
      'HHH.HHHH.Hhh',
      'H..........h',
      'H..........h',
    ],
    back: { y: 4, rows: [
      'HH........hh', 'HH........hh', 'HH........hh', 'HH........hh', 'HH........hh',
      'HH........hh', 'HH........hh', 'Hh........hh', 'hh........hh', 'h..........h',
    ] },
    drape: { y: 9, rows: [
      'HH........hh',
      'HH........hh',
      '.Hh......hh.',
      '.hh......hh.',
      '.h........h.',
    ] },
  },
  { // 2 spiky
    dy: -3,
    front: [
      '..H..H..H...',
      '..HH.HH.HH..',
      '.HHHHHHHHHH.',
      'HHHLLHHHHHHh',
      '.HLLHHHHHHh.',
      'HHLHHHHHHHHh',
      'HHHHHHHHHHhh',
      '.H.HH.HH.Hh.',
      'H..........h',
      'h..........h',
    ],
  },
  { // 3 bob with blunt fringe
    dy: -2,
    front: [
      '...HHHHHH...',
      '..HHLLHHHH..',
      '.HHLLHHHHHH.',
      'HHLHHHHHHHHh',
      'HHHHHHHHHHhh',
      'HHhHHhHHhHhh',
      'HH........hh',
      'H..........h',
      'H..........h',
      'H..........h',
      'Hh........hh',
      'hh........hh',
      '.h........h.',
    ],
  },
  { // 4 top bun, side-swept fringe
    dy: -4,
    front: [
      '....hHHh....',
      '....HLLH....',
      '.....hh.....',
      '..HHHHHHHH..',
      '.HHHLLHHHHH.',
      'HHHLHHHHHHHh',
      'HHHHHHHHHHHh',
      'HHH...HHHHhh',
      'HH......HHhh',
      'H..........h',
      'h..........h',
    ],
  },
  { // 5 buzz cut
    dy: -1,
    front: [
      '...hhhhhh...',
      '..hHHLHHHh..',
      '.hHHLHHHHHh.',
      '.HHHHHHHHHh.',
      '.h........h.',
    ],
  },
];

// face: S skin, s shade, d deep shade, n neck. eyes/mouth/blush are drawn procedurally.
export const FACE = [
  '...SSSSSS...',
  '..SSSSSSSS..',
  '.SSSSSSSSSs.',
  '.SSSSSSSSSs.',
  '.SSSSSSSSSs.',
  '.SSSSSSSSSs.',
  '.SSSSSSSSSs.',
  '.SSSSSSSSss.',
  '..SSSSSSSs..',
  '...sSSSss...',
  '....dnnd....',
];

// torso rows 11..17: T shirt, t shade, c collar, D dark hem
export const TORSO = [
  '..TTTccTTT..',
  '.TTTTccTTTt.',
  '.TTTTTTTTTt.',
  '.TTTTTTTTTt.',
  '.TTTTTTTTTt.',
  '.TTTTTTTTTt.',
  '.DDDDDDDDDD.',
];

// cap (accessory 3): C crown, c crown shade, L button/highlight, B brim, b under-brim shadow
export const CAP = { y: -3, rows: [
  '...cCCCCc...',
  '..CCCLCCCc..',
  '.CCCCCCCCCc.',
  '.CCCCCCCCCc.',
  '.CCCCCCCCcc.',
  'BBBBBBBBBBB.',
] };

// small sleeping-head sprite used by beds (7 wide)
export const SLEEP_HEAD = ['.HHHHH.', 'HHLHHHH', 'HHSSSSH', 'HSSSSSS', 'HSeeSee', 'HSbSSbS', '.SSSSS.'];
