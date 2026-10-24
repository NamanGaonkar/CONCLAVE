// Design tokens — single source of truth. Mirrors tokens.css for non-styled consumers.

export const colors = {
  cream: {
    50: 0x0c0a07,
    100: 0x14110c,
    200: 0x1b1710,
    300: 0x241e15
  },
  paper: {
    100: 0x14110c,
    200: 0x1b1710
  },
  ink: {
    900: 0xf5edd8,
    700: 0xd8ceb8,
    500: 0x9e937d,
    300: 0x2a2417,
    100: 0x1d1810
  },
  accent: {
    coral: 0xe06d53,
    coralLight: 0x321b17,
    mint: 0x48b57d,
    mintLight: 0x162e21,
    sky: 0x55a6bf,
    skyLight: 0x172a32,
    lemon: 0xf5af28,
    lemonLight: 0x2a1f0b,
    lilac: 0x9d85d6,
    lilacLight: 0x251e33,
    peach: 0xe09253,
    peachLight: 0x322116
  },
  status: {
    idle: 0x7a7263,
    thinking: 0x55a6bf,
    working: 0xf5af28,
    blocked: 0xe06d53,
    success: 0x48b57d,
    ghost: 0x5c5547
  },
  world: {
    grassLight: 0x14110c,
    grassDark: 0x0c0a07,
    woodLight: 0x1b1710,
    woodDark: 0x14110c,
    path: 0x241e15,
    wall: 0x2a2417
  }
} as const;

export const space = {
  0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64
} as const;

export const type = {
  display: '"Lato", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  ui: '"Lato", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace'
} as const;

export const tileSize = 32;

export type AccentColorName =
  | 'coral' | 'mint' | 'sky' | 'lemon' | 'lilac' | 'peach';

export const accentByName: Record<AccentColorName, number> = {
  coral: colors.accent.coral,
  mint:  colors.accent.mint,
  sky:   colors.accent.sky,
  lemon: colors.accent.lemon,
  lilac: colors.accent.lilac,
  peach: colors.accent.peach
};

export const accentLightByName: Record<AccentColorName, number> = {
  coral: colors.accent.coralLight,
  mint:  colors.accent.mintLight,
  sky:   colors.accent.skyLight,
  lemon: colors.accent.lemonLight,
  lilac: colors.accent.lilacLight,
  peach: colors.accent.peachLight
};

// Convert 0xRRGGBB to "#RRGGBB"
export function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0').toUpperCase();
}
