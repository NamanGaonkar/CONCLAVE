// Design tokens — single source of truth. Mirrors tokens.css for non-styled consumers (Pixi).
// Any change here must also update tokens.css.

export const colors = {
  cream: {
    50: 0xe5be53,
    100: 0xf2d376,
    200: 0xddb344,
    300: 0xc49a2b
  },
  paper: {
    100: 0xfaf0c8,
    200: 0xf0dd8e
  },
  ink: {
    900: 0x1c1405,
    700: 0x3d2e0b,
    500: 0x6e561c,
    300: 0xa88732,
    100: 0xd4ba6e
  },
  // Amber Gold accent
  accent: {
    coral: 0xbf433b,
    coralLight: 0xf5cfca,
    mint: 0x358a54,
    mintLight: 0xc6e6d1,
    sky: 0x2a7f96,
    skyLight: 0xc0e2ea,
    lemon: 0xb87503,       // Deep golden amber
    lemonLight: 0xfceabb,  // Luminous golden yellow
    lilac: 0x7d5ab8,
    lilacLight: 0xdfd4f5,
    peach: 0xba6b28,
    peachLight: 0xf7ddc6
  },
  status: {
    idle: 0x6e561c,
    thinking: 0x2a7f96,
    working: 0xb87503,     // Deep golden amber
    blocked: 0xbf433b,
    success: 0x358a54,
    ghost: 0x8c7748
  },
  world: {
    grassLight: 0xd4eab0,
    grassDark: 0xb5d589,
    woodLight: 0xe5c896,
    woodDark: 0xc9a66b,
    path: 0xe8d8b0,
    wall: 0x8b6f47
  }
} as const;

export const space = {
  0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64
} as const;

export const type = {
  display: '"Lato", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  ui: '"Lato", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace'
} as const;

export const tileSize = 32; // px — the world is built from 32×32 tiles

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
