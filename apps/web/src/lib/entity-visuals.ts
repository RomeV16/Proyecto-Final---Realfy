/**
 * Deterministic visual identity for records.
 *
 * Only properties (and ticket attachments) carry real photos. Every other
 * entity — contracts, liquidaciones, payments, providers, tickets — has no
 * image field at all, which is what made those lists read as plain text.
 *
 * Instead of random colour, each record derives a stable palette from a seed
 * (its id), so the same contract always looks the same across sessions and
 * across screens, and a list reads as a set of distinct objects. The ramps are
 * a curated warm set rather than a full hue rotation, so a grid stays inside
 * the editorial palette instead of looking like confetti.
 *
 * Status is deliberately NOT encoded in the cover — it is carried by the badge
 * and the accent bar, so colour stays informative and identity stays varied.
 */

/** FNV-1a. Stable across runtimes; we only need spread, not crypto strength. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface CoverPalette {
  /** CSS `background-image` value for the cover surface. */
  gradient: string;
  /** Texture utility class layered over the gradient (defined in globals.css). */
  texture: 'cover-grid' | 'cover-dots' | 'cover-rays' | 'cover-arcs';
  /** Solid tint for chips/rings that need to sit next to the cover. */
  tint: string;
  /** Soft translucent tint for backgrounds. */
  soft: string;
}

/* Curated ramps. Terracotta, clay, ochre and forest green with two cooler
   outliers, so a mixed grid still reads as the same warm product. */
const RAMPS: ReadonlyArray<{ a: string; b: string; c: string; tint: string }> = [
  { a: '18 58% 32%', b: '16 55% 45%', c: '30 58% 56%', tint: '16 55% 43%' }, // terracota
  { a: '146 26% 24%', b: '148 24% 33%', c: '120 24% 44%', tint: '148 24% 32%' }, // verde bosque
  { a: '32 52% 30%', b: '34 54% 42%', c: '44 60% 54%', tint: '34 52% 40%' }, // ocre
  { a: '8 42% 30%', b: '6 44% 42%', c: '22 50% 52%', tint: '6 44% 40%' }, // arcilla
  { a: '168 30% 24%', b: '172 28% 34%', c: '154 30% 44%', tint: '172 28% 32%' }, // verde agua
  { a: '348 34% 30%', b: '350 36% 42%', c: '10 44% 52%', tint: '350 36% 40%' }, // borgoña
  { a: '204 32% 28%', b: '200 32% 38%', c: '186 34% 48%', tint: '200 32% 36%' }, // azul pizarra
  { a: '42 38% 28%', b: '40 40% 38%', c: '52 44% 50%', tint: '40 40% 37%' }, // mostaza tostada
];

const TEXTURES = ['cover-grid', 'cover-dots', 'cover-rays', 'cover-arcs'] as const;

/**
 * Stable cover palette for a record.
 *
 * @param seed  Anything stable per record — normally its id.
 */
export function coverPalette(seed: string): CoverPalette {
  const h = hash(seed || 'realfy');
  const ramp = RAMPS[h % RAMPS.length];
  const texture = TEXTURES[(h >>> 8) % TEXTURES.length];
  // Vary the light source per record so two records on the same ramp still differ.
  const angle = 110 + ((h >>> 16) % 5) * 20;

  return {
    gradient: `linear-gradient(${angle}deg, hsl(${ramp.a}) 0%, hsl(${ramp.b}) 52%, hsl(${ramp.c}) 100%)`,
    texture,
    tint: `hsl(${ramp.tint})`,
    soft: `hsl(${ramp.tint} / 0.12)`,
  };
}

/* ──────────── Avatars ──────────── */

/**
 * Up to two initials from a person/company name.
 * Handles single-word company names ("Edenor" → "ED") and multi-word ones.
 */
export function initialsOf(name: string | null | undefined): string {
  const clean = (name || '').trim();
  if (!clean) return '?';

  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Same ramp system as covers, but tuned for small circular surfaces. */
export function avatarPalette(seed: string): { gradient: string; tint: string } {
  const h = hash(seed || 'realfy');
  const ramp = RAMPS[h % RAMPS.length];
  return {
    gradient: `linear-gradient(135deg, hsl(${ramp.b}) 0%, hsl(${ramp.a}) 100%)`,
    tint: `hsl(${ramp.tint})`,
  };
}
