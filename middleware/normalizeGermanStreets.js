const _ = require('lodash');

/**
 * German query normalizer.
 *
 * 1) Expands common German street-type abbreviations to their full form so that
 *    queries like "Herrenstr. 29" match index entries stored as "Herrenstraße 29".
 *
 * 2) Strips parenthetical disambiguation suffixes from city names, e.g.
 *    "Rheinfelden (Baden)" → "Rheinfelden", "Singen (Hohentwiel)" → "Singen".
 *    German official names often include these, but OSM/WOF data stores only
 *    the base city name.
 *
 * 3) Expands personal/honorific abbreviations so that compound street names
 *    match their indexed forms (e.g. "Friedr." → "Friedrich", "St." → "Sankt").
 *
 * 4) Strips "Am"/"An"/"Im" prefixes from street names when those prefixes cause
 *    a mismatch with the indexed form (e.g. "Am Hafenmarkt" → "Hafenmarkt").
 *
 * 5) Strips parenthetical content from street names that confuses the parser.
 *
 * Runs on `clean.parsed_text` — designed to be inserted as middleware
 * after libpostal (and after defer_to_pelias_parser) in the search pipeline.
 */

// Patterns are applied in order.  Each entry:
//   pattern  – RegExp to test/replace on the street string
//   replace  – replacement string (may use capture groups)
const STREET_EXPANSIONS = [
  // "str." or "Str." at end of word (with or without trailing period)
  // e.g. "Herrenstr." → "Herrenstraße", "Hauptstr" → "Hauptstraße"
  { pattern: /str\.$/i,        replace: 'straße' },
  { pattern: /str$/i,          replace: 'straße' },

  // "strasse" → "straße" (common ASCII transliteration)
  { pattern: /strasse$/i,      replace: 'straße' },

  // "pl." at end → "platz"  (e.g. "Marktpl." → "Marktplatz")
  { pattern: /pl\.$/i,         replace: 'platz' },

  // "westl." at start → "westliche"  (e.g. "Westl.-Karl-Friedrich-Str." → "Westliche-Karl-Friedrich-Str.")
  { pattern: /^westl\./i,      replace: 'westliche' },

  // "östl." at start → "östliche"
  { pattern: /^östl\./i,       replace: 'östliche' },

  // Personal/honorific abbreviations (inside compound street names)
  // "Friedr." → "Friedrich"  (Karl-Friedr.-Str. → Karl-Friedrich-Str.)
  { pattern: /friedr\./ig,     replace: 'friedrich' },

  // "Seb." → "Sebastian"  (Seb.Merkle Str. → Sebastian Merkle Str.)
  { pattern: /\bseb\./ig,      replace: 'sebastian' },

  // "v." → "von"  (Margarethe-v.-Wrangell → Margarethe-von-Wrangell)
  { pattern: /\bv\./ig,        replace: 'von' },

  // "Dr." → "doktor"  (Dr. Zimmermannstr. → Doktor-Zimmermann-Str.)
  // Note: libpostal often keeps "dr." as-is in parsed_text
  { pattern: /\bdr\.\s*/ig,    replace: 'doktor-' },

  // "St." / "St " at START → "Sankt"  (St. Georgstr. → Sankt-Georg-Str.)
  { pattern: /^st[\.\s]+/i,    replace: 'sankt-' },
];

/**
 * Strip parenthetical content from a street name.
 * "Schloßweg (Jesuitenschloß)" → "Schloßweg"
 * "Hauptstr. (Rathaus) 18" → "Hauptstr. 18"
 */
function stripParenthetical(street) {
  return street.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
}

/**
 * Strip "Am"/"An"/"Im" prefix from street names when they cause mismatch.
 * "am hafenmarkt" → "hafenmarkt"
 * "am bildweg" → "bildweg"
 * "am franziskusplatz" → "franziskusplatz"
 * But keep genuine "Am" streets like "Am Gesundbrunnen" (these are indexed with "Am").
 */
function stripLocationPrefix(street) {
  const prefixMatch = street.match(/^(am|an|im|beim)\s+(.+)$/i);
  if (!prefixMatch) {
    return null;
  }
  return prefixMatch[2];
}

/**
 * Insert hyphens into compound German street names to match the indexed form.
 *
 * German streets in OSM/OA often use hyphens between components:
 *   "Kurfürsten-Anlage", "Hansjakob-Straße", "Rotkreuz-Straße"
 * But user input often writes them as one word:
 *   "Kurfürstenanlage", "Hansjakobstraße", "Rotkreuzstraße"
 *
 * The peliasTokenizer splits on hyphens, creating a token-count mismatch:
 *   index: "kurfursten | anlage"  (2 tokens)
 *   query: "kurfurstenanlage"     (1 token)  → no match!
 *
 * This function detects compound words ending with known German suffixes
 * and inserts a hyphen before the suffix so the tokenizer splits them
 * the same way as the indexed form.
 *
 * Only applies to single-word street names (no existing spaces/hyphens
 * in the base part before any known suffix).
 */
const GERMAN_STREET_SUFFIXES = [
  // Order matters: longer suffixes first to avoid partial matches
  'straße', 'strasse', 'gasse', 'brücke', 'bruecke',
  'anlage', 'steige', 'ring', 'platz', 'weg', 'pfad',
  'graben', 'allee', 'damm', 'chaussee', 'promenade',
  'ufer', 'gässle', 'gässchen', 'steg', 'markt',
  'höhe', 'hoehe', 'berg', 'halde', 'acker',
];

function decompoundStreet(street) {
  // Only try to decompound single words (no spaces).
  // But hyphens are OK — we process each segment.
  if (/\s/.test(street)) {
    return street;
  }

  // Split by hyphens, decompound ONLY the LAST segment (the suffix part)
  // "sankt-georgstraße" → segments: ["sankt", "georgstraße"] → decompound last: "georg-straße"
  // "rot-kreuz-straße" → segments: ["rot", "kreuz", "straße"] → last is "straße", too short, leave
  const segments = street.split('-');
  if (segments.length === 0) {
    return street;
  }

  const lastSeg = segments[segments.length - 1];
  const lastLower = lastSeg.toLowerCase();

  for (const suffix of GERMAN_STREET_SUFFIXES) {
    if (lastLower.endsWith(suffix) && lastLower.length > suffix.length + 2) {
      // Split the last segment: "georgstraße" → "georg" + "straße"
      const cut = lastSeg.length - suffix.length;
      segments[segments.length - 1] = lastSeg.slice(0, cut);
      segments.push(lastSeg.slice(cut));
      return segments.join('-');
    }
  }

  // Also try: if the whole compound has no hyphens, split at the suffix
  if (segments.length === 1) {
    const lower = street.toLowerCase();
    for (const suffix of GERMAN_STREET_SUFFIXES) {
      if (lower.endsWith(suffix) && lower.length > suffix.length + 2) {
        const cut = street.length - suffix.length;
        return street.slice(0, cut) + '-' + street.slice(cut);
      }
    }
  }

  return street;
}

function normalizeStreet(street) {
  if (!_.isString(street) || _.isEmpty(street.trim())) {
    return street;
  }

  // Strip parenthetical content first
  let result = stripParenthetical(street);

  for (const rule of STREET_EXPANSIONS) {
    if (rule.pattern.test(result)) {
      result = result.replace(rule.pattern, rule.replace);
    }
  }

  // Clean up double hyphens or trailing hyphens from expansions
  result = result.replace(/-{2,}/g, '-').replace(/-\s/g, '-').replace(/\s-/g, '-').replace(/-$/g, '');

  return result;
}

/**
 * Restore parenthetical city disambiguation that libpostal strips.
 *
 * Libpostal normalises "Rheinfelden (Baden)" → "rheinfelden baden".
 * If the original raw query text contains e.g. "Rheinfelden (Baden)",
 * this function puts the parens back: "rheinfelden (baden)".
 *
 * @param {string} city  – parsed city from libpostal
 * @param {string} rawText – original user query text
 * @returns {string} city, potentially with restored parentheses
 */
function normalizeCity(city, rawText) {
  if (!_.isString(city) || _.isEmpty(city)) {
    return city;
  }
  // Already has parens → nothing to do
  if (city.includes('(')) {
    return city;
  }
  if (!_.isString(rawText) || _.isEmpty(rawText)) {
    return city;
  }

  // Find a "Name (Qualifier)" pattern in the raw text where
  // lowercased "name qualifier" matches the parsed city.
  const parenRe = /([A-Za-zÀ-ÿ\u00C0-\u024F-]+)\s*\(([^)]+)\)/g;
  let match;
  while ((match = parenRe.exec(rawText)) !== null) {
    const candidate = (match[1] + ' ' + match[2]).toLowerCase();
    if (candidate === city.toLowerCase()) {
      // Reconstruct with parens, preserving lowercased form from libpostal
      return match[1].toLowerCase() + ' (' + match[2].toLowerCase() + ')';
    }
  }
  return city;
}

function middleware() {
  return function (req, res, next) {
    const street = _.get(req, 'clean.parsed_text.street');
    if (street) {
      const normalized = normalizeStreet(street);
      if (normalized !== street) {
        req.clean.parsed_text.street = normalized;
      }

      // Generate a decompounded variant that inserts hyphens into compound
      // German words so the tokenizer can split them like the index does.
      // Store as a separate field for the query layer to use alongside the original.
      const currentStreet = req.clean.parsed_text.street;
      const decompounded = currentStreet.split(/\s+/).map(decompoundStreet).join(' ');
      if (decompounded !== currentStreet) {
        req.clean.parsed_text.street_decompounded = decompounded;
      }

      // Generate a concatenated variant that removes hyphens from compound
      // street names. Handles the REVERSE case: user has "Rot-Kreuz-Straße"
      // but index has "Rotkreuzstraße" (one compound token).
      if (currentStreet.includes('-')) {
        const concatenated = currentStreet.replace(/-/g, '');
        if (concatenated !== currentStreet) {
          req.clean.parsed_text.street_concatenated = concatenated;
        }
      }

      // Store an alternative street name without "Am"/"An"/"Im" prefix.
      const stripped = stripLocationPrefix(currentStreet);
      if (stripped) {
        req.clean.parsed_text.street_without_prefix = stripped;
      }
    }
    // Restore parenthetical city names
    const city = _.get(req, 'clean.parsed_text.city');
    const rawText = _.get(req, 'clean.text', '');
    if (city) {
      const normalizedCity = normalizeCity(city, rawText);
      if (normalizedCity !== city) {
        req.clean.parsed_text.city = normalizedCity;
      }
    }
    return next();
  };
}

// also export for unit testing
middleware.normalizeStreet = normalizeStreet;
middleware.normalizeCity = normalizeCity;
middleware.stripLocationPrefix = stripLocationPrefix;
middleware.stripParenthetical = stripParenthetical;

module.exports = middleware;
