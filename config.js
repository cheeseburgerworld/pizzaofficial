// PIZZA⚡OFFICIAL — Config
// pizzaofficial.biz
// Cheeseburger World LLC

// ── Supabase ──────────────────────────────────────────────────
export const SUPABASE_URL  = 'https://imhgcbirrtewxuusqcat.supabase.co';
export const SUPABASE_ANON = 'sb_publishable_oxuCF_UbJXDgem1cyUNGWQ_46LnIBhT';

// ── ATProto OAuth ─────────────────────────────────────────────
export const OAUTH_CLIENT_ID   = 'https://pizzaofficial.biz/oauth/client-metadata.json';
export const OAUTH_REDIRECT    = 'https://pizzaofficial.biz/oauth/callback';
export const ATPROTO_HANDLE_RESOLVER = 'https://bsky.social';

// ── Brand ─────────────────────────────────────────────────────
export const SITE_NAME    = 'PIZZA⚡OFFICIAL';
export const SITE_DOMAIN  = 'pizzaofficial.biz';
export const HASHTAG      = '#PizzaOfficial';

// ── Rating system ─────────────────────────────────────────────
export const RATINGS = {
  0: { symbol: 'ㄨ', label: 'Skip It',       desc: "Don't bother." },
  1: { symbol: '⭐',  label: 'Solid',         desc: 'Worth knowing about.' },
  2: { symbol: '⭐⭐', label: 'Worth a Trip',  desc: "You'd drive across town." },
  3: { symbol: '⭐⭐⭐',label: 'Legendary',    desc: 'Ruins other pizza.' },
};

// ── Style categories ──────────────────────────────────────────
export const STYLES = [
  { value: 'NY Style',          label: 'NY Style',          hint: 'Wide, foldable. If you folded the slice to eat it, it\'s probably this.' },
  { value: 'Neapolitan',        label: 'Neapolitan',        hint: 'Wood-fired, blistered, soft center. Born in Naples.' },
  { value: 'Roman',             label: 'Roman',             hint: 'Tonda (cracker-thin) or al Taglio.' },
  { value: 'Detroit / Sicilian',label: 'Detroit / Sicilian',hint: 'Thick, rectangular, pan-baked. Crispy-bottomed.' },
  { value: 'Deep Dish',         label: 'Deep Dish',         hint: 'Chicago. Deep pan. Cheese first, sauce on top.' },
  { value: 'Tavern',            label: 'Tavern',            hint: 'Midwest thin-crust, maybe crackery, always square-cut.' },
  { value: 'Fast / Counter',    label: 'Fast / Counter',    hint: 'Chains, heat-lamp slices, counter pizza. Honest and useful.' },
];

// ── Review form dropdowns ─────────────────────────────────────
export const CRUST_OPTIONS = [
  { value: 'thin',   label: 'Thin' },
  { value: 'medium', label: 'Medium' },
  { value: 'thick',  label: 'Thick' },
  { value: 'deep',   label: 'Deep' },
];

export const CHAR_OPTIONS = [
  { value: 'none',   label: 'No char' },
  { value: 'light',  label: 'Light char' },
  { value: 'medium', label: 'Medium char' },
  { value: 'heavy',  label: 'Heavy / leopard' },
];

export const SAUCE_OPTIONS = [
  { value: 'red',   label: 'Red (tomato)' },
  { value: 'white', label: 'White' },
  { value: 'pesto', label: 'Pesto' },
  { value: 'none',  label: 'No sauce' },
  { value: 'other', label: 'Other' },
];

export const CHEESE_OPTIONS = [
  { value: 'low-moisture mozz', label: 'Low-moisture mozzarella' },
  { value: 'fresh mozz',        label: 'Fresh mozzarella' },
  { value: 'blend',             label: 'Cheese blend' },
  { value: 'vegan',             label: 'Vegan cheese' },
  { value: 'none',              label: 'No cheese' },
  { value: 'other',             label: 'Other' },
];

// ── Bluesky post template ─────────────────────────────────────
export function formatBlueskyPost(review) {
  const rating = RATINGS[review.rating];
  return [
    `${rating.symbol} ${review.name} — ${review.location}`,
    `${review.style} · ${review.notes.slice(0, 180)}${review.notes.length > 180 ? '…' : ''}`,
    ``,
    HASHTAG,
  ].join('\n');
}
