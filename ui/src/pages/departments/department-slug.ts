// Turning a department name into the short code the identity server will accept.
//
// The person adding a department knows the name; the short code is bookkeeping that the
// boundary happens to read. So the screen types the code for them, and this module is
// where that guess is made. It is deliberately a plain transliteration: the Revised
// Romanization letter tables applied syllable by syllable, with none of the sound-change
// rules, because a code that is stable and predictable from the name it came from is
// worth more here than one that reads well out loud.

/** The short code shape the Gateway accepts (see ix-auth-admin-departments-http.ts). */
const DEPARTMENT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/u;

/** The longest short code the Gateway accepts. */
const DEPARTMENT_SLUG_MAX_LENGTH = 32;

/** The code used when a name romanizes to nothing a code can be made of. */
const FALLBACK_SLUG = "dept";

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const JUNGSEONG_COUNT = 21;
const JONGSEONG_COUNT = 28;

// prettier-ignore
const CHOSEONG = [
  "g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s",
  "ss", "", "j", "jj", "ch", "k", "t", "p", "h",
];

// prettier-ignore
const JUNGSEONG = [
  "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa",
  "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i",
];

// prettier-ignore
const JONGSEONG = [
  "", "k", "k", "k", "n", "n", "n", "t", "l", "k",
  "m", "l", "l", "l", "p", "l", "m", "p", "p", "t",
  "t", "ng", "t", "t", "k", "t", "p", "t",
];

/**
 * Write Hangul syllables in Latin letters, one syllable at a time.
 *
 * Everything that is not a precomposed Hangul syllable is passed through untouched, so a
 * mixed name keeps its Latin and digits.
 */
function romanizeHangul(text: string): string {
  let out = "";
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < HANGUL_BASE || code > HANGUL_LAST) {
      out += character;
      continue;
    }
    const offset = code - HANGUL_BASE;
    const choseong = Math.floor(offset / (JUNGSEONG_COUNT * JONGSEONG_COUNT));
    const jungseong = Math.floor((offset % (JUNGSEONG_COUNT * JONGSEONG_COUNT)) / JONGSEONG_COUNT);
    const jongseong = offset % JONGSEONG_COUNT;
    out += (CHOSEONG[choseong] ?? "") + (JUNGSEONG[jungseong] ?? "") + (JONGSEONG[jongseong] ?? "");
  }
  return out;
}

/**
 * The code the create form shows for a name nobody has overridden a code for.
 *
 * An empty name empties the field rather than falling back to a generic code: a form
 * that has not been filled in yet should not look like it has been.
 */
export function autoDepartmentSlug(name: string, taken: Iterable<string> = []): string {
  return name.trim().length === 0 ? "" : suggestDepartmentSlug(name, taken);
}

/** Whether the Gateway would accept this short code without arguing. */
export function isDepartmentSlug(slug: string): boolean {
  return DEPARTMENT_SLUG_PATTERN.test(slug);
}

function trimHyphens(value: string): string {
  return value.replace(/^-+/u, "").replace(/-+$/u, "");
}

function baseSlug(name: string): string {
  // NFC first so a decomposed name still arrives as syllables the table above can read;
  // NFKD afterwards separates the accents off Latin letters so they can be dropped
  // rather than swallowing the letter they sit on.
  const romanized = romanizeHangul(name.normalize("NFC"));
  const flattened = romanized
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const hyphenated = trimHyphens(flattened.replace(/[^a-z0-9]+/gu, "-"));
  return trimHyphens(hyphenated.slice(0, DEPARTMENT_SLUG_MAX_LENGTH));
}

function withCounter(base: string, counter: number): string {
  const suffix = `-${counter}`;
  const head = trimHyphens(base.slice(0, DEPARTMENT_SLUG_MAX_LENGTH - suffix.length));
  return `${head || FALLBACK_SLUG}${suffix}`;
}

/**
 * Guess the short code for a department name, avoiding the codes already in use.
 *
 * The answer always satisfies {@link DEPARTMENT_SLUG_PATTERN}; a name that leaves nothing
 * usable behind falls back to a generic code rather than to an empty field, so the form
 * stays submittable and the person can override it.
 */
function suggestDepartmentSlug(name: string, taken: Iterable<string> = []): string {
  const used = new Set<string>();
  for (const entry of taken) {
    used.add(entry.trim().toLowerCase());
  }
  const base = baseSlug(name) || FALLBACK_SLUG;
  const root = isDepartmentSlug(base) ? base : FALLBACK_SLUG;
  let candidate = root;
  for (let counter = 2; used.has(candidate) && counter < 10_000; counter += 1) {
    const next = withCounter(root, counter);
    candidate = isDepartmentSlug(next) ? next : `${FALLBACK_SLUG}-${counter}`;
  }
  return candidate;
}
