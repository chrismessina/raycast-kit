/**
 * Count-aware copy.
 *
 * House Style: any user-facing string interpolating a count must agree
 * grammatically across all three cases — zero, one, many. The escape hatches
 * (`"${n} item(s)"`, always-plural `"${n} items"`) are prohibited in copy the
 * user reads, and the rule names real fleet defects: `craft` renders
 * `${n} item(s)`; `fathom` and `at-profile` render `${n} items` that says
 * "1 items" at count 1.
 *
 * Measured 2026-07-25: 34 count-bearing copy sites across 11 extensions, and
 * `pluralize` already hand-rolled twice — so this is the factoring House Style
 * explicitly asks for.
 */

/** Irregular plurals worth knowing; anything else takes the suffix rules below. */
const IRREGULAR: Readonly<Record<string, string>> = {
  child: "children",
  person: "people",
  man: "men",
  woman: "women",
  tooth: "teeth",
  foot: "feet",
  mouse: "mice",
  goose: "geese",
  datum: "data",
  index: "indices",
  matrix: "matrices",
  vertex: "vertices",
  analysis: "analyses",
  basis: "bases",
  crisis: "crises",
  thesis: "theses",
};

/** Nouns whose plural is identical to the singular. */
const UNCHANGING = new Set(["series", "species", "sheep", "fish", "deer", "aircraft", "software", "media"]);

/**
 * Pluralize a noun for a count. Handles regular English suffix rules plus the
 * common irregulars; pass `plural` explicitly for anything it gets wrong.
 *
 * @example
 * plural(1, "device")            // "device"
 * plural(3, "device")            // "devices"
 * plural(2, "match")             // "matches"
 * plural(2, "city")              // "cities"
 * plural(2, "person")            // "people"
 * plural(2, "match", "matches!") // "matches!"  — explicit override wins
 */
export function plural(count: number, singular: string, pluralForm?: string): string {
  if (Math.abs(count) === 1) {
    return singular;
  }
  if (pluralForm !== undefined) {
    return pluralForm;
  }
  return pluralizeWord(singular);
}

/** Apply English pluralization rules to a single word. */
function pluralizeWord(word: string): string {
  const lower = word.toLowerCase();

  if (UNCHANGING.has(lower)) {
    return word;
  }

  const irregular = IRREGULAR[lower];
  if (irregular) {
    return matchCase(word, irregular);
  }

  // -s, -x, -z, -ch, -sh → add "es"  (match, box, bus, dish)
  if (/(?:s|x|z|ch|sh)$/i.test(word)) {
    return `${word}es`;
  }
  // consonant + y → "ies"  (city → cities, but day → days)
  if (/[^aeiou]y$/i.test(word)) {
    return `${word.slice(0, -1)}ies`;
  }
  // consonant + o → "es"  (potato → potatoes, but video → videos)
  if (/[^aeiou]o$/i.test(word) && !/(?:photo|piano|halo|solo|video|memo|logo|auto|pro)$/i.test(word)) {
    return `${word}es`;
  }
  // -f / -fe → "ves"  (leaf → leaves, life → lives)
  if (/(?:[^f]f|fe)$/i.test(word)) {
    return `${word.replace(/fe?$/i, "")}ves`;
  }

  return `${word}s`;
}

/** Preserve the casing style of the original word on its replacement. */
function matchCase(original: string, replacement: string): string {
  if (original === original.toUpperCase()) {
    return replacement.toUpperCase();
  }
  if (original[0] === original[0]?.toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

export interface CountOptions {
  /** Explicit plural form, when the suffix rules get it wrong. */
  plural?: string;
  /**
   * Copy for the zero case. House Style: *"No devices found."* reads better than
   * *"0 devices found."* — pass `"No devices"` to get the worded negative.
   * When omitted, zero renders numerically (`"0 devices"`).
   */
  zero?: string;
}

/**
 * Format a count with its noun, agreeing across zero / one / many.
 *
 * This is the function that replaces the prohibited patterns — use it anywhere a
 * count reaches the user (toast titles, `List.Section` subtitles, empty-state copy).
 *
 * @example
 * countOf(0, "device")                          // "0 devices"
 * countOf(0, "device", { zero: "No devices" })  // "No devices"
 * countOf(1, "device")                          // "1 device"
 * countOf(7, "device")                          // "7 devices"
 * countOf(2, "match")                           // "2 matches"
 *
 * @example  // the fleet defects this closes
 * `${n} item(s)`  →  countOf(n, "item")
 * `${n} items`    →  countOf(n, "item")     // no longer says "1 items"
 */
export function countOf(count: number, singular: string, options: CountOptions = {}): string {
  if (count === 0 && options.zero !== undefined) {
    return options.zero;
  }
  return `${formatCount(count)} ${plural(count, singular, options.plural)}`;
}

/** Thousands separators via the user's locale — `1234` → `"1,234"`. */
function formatCount(count: number): string {
  return new Intl.NumberFormat().format(count);
}
