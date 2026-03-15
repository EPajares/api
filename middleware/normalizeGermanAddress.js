const _ = require('lodash');

/**
 * Pre-parser normalizer for German address text.
 *
 * Runs BEFORE libpostal so that the parser receives a cleaner input string.
 *
 * Handles three patterns that confuse libpostal:
 *
 * 1) Slash house-number sub-units – "Hauptstr. 30/1" or "Kronenstr. 19/III"
 *    Strips the sub-unit after the slash: "Hauptstr. 30" / "Kronenstr. 19"
 *
 * 2) Range house numbers – "Waldstr. 71-73" or "Bahnhofstr. 1-3"
 *    Keeps only the first (lower) number: "Waldstr. 71" / "Bahnhofstr. 1"
 *
 * 3) Mannheim Quadrate grid – "N 7, 13-15, Mannheim, 68161"
 *    Collapses the quadrat name (e.g. "N 7" → "N7"), removes the comma between
 *    block and house number, and applies the range rule if needed.
 *    Result: "N7 13, Mannheim, 68161"
 *
 * 4) Parenthetical disambiguation in street names – "Hauptstr. (Rathaus) 18"
 *    Strips "(Rathaus)" to avoid confusing libpostal.
 */

// Mannheim quadrat pattern:
//   <letter>[space]<digit(s)>,  <housenumber>
// Letters A–U, block digits typically 1–7 (but L/N can reach 14+)
// Must appear before ", Mannheim" in the string to avoid false positives.
const MANNHEIM_QUADRAT_RE =
  /^([A-U])\s*(\d{1,2})\s*[,\s]\s*(\d[\w\s-]*?)\s*,\s*Mannheim\b/i;

// Slash sub-unit after a house number, before a comma or end-of-string.
// "30/1" → "30", "19/III" → "19", "5/a" → "5"
const SLASH_HOUSE_RE = /(\d+)\s*\/\s*[A-Za-z0-9]+(?=\s*,|\s*$)/g;

// Range house number before a comma or end-of-string.
// "71-73" → "71", "1-3" → "1", "17 - 18" → "17"
// Negative lookbehind ensures we don't match inside words like "Karl-Marx-Str"
// We require a preceding space or start-of-string so we only touch numbers.
const RANGE_HOUSE_RE = /(?<=\s|^)(\d+)\s*-\s*\d+(?=\s*,|\s*$)/g;

function normalizeText(text) {
  if (!_.isString(text) || _.isEmpty(text.trim())) {
    return text;
  }

  let result = text;

  // --- Mannheim Quadrate ---
  const mMatch = MANNHEIM_QUADRAT_RE.exec(result);
  if (mMatch) {
    const letter = mMatch[1].toUpperCase();
    const block = mMatch[2];
    let houseNum = mMatch[3].trim();
    // Strip range in house number (e.g. "13-15" → "13")
    houseNum = houseNum.replace(/^(\d+)\s*-\s*\d+/, '$1');
    // Rebuild: "N7 13, Mannheim, ..."
    const rest = result.slice(mMatch[0].length);
    result = `${letter}${block} ${houseNum}, Mannheim${rest}`;
  }

  // --- Slash sub-units ---
  result = result.replace(SLASH_HOUSE_RE, '$1');

  // --- Range house numbers ---
  result = result.replace(RANGE_HOUSE_RE, '$1');

  // --- Comma-separated house numbers: "9, 11" → "9" ---
  // "Heidolfstr. 9, 11, Bruchsal" → "Heidolfstr. 9, Bruchsal"
  // Only match when digits appear on both sides of a comma (not "street, city").
  result = result.replace(/(\d+)\s*,\s*(\d+)(?=\s*,)/g, '$1');

  // --- "und" / "+" compound house numbers ---
  // "Hauptstr. 64 und 66" → "Hauptstr. 64"
  // "Libanonstr. 4+6" → "Libanonstr. 4"
  result = result.replace(/(\d+)\s+und\s+\d+/gi, '$1');
  result = result.replace(/(\d+)\s*\+\s*\d+/g, '$1');

  // --- Abbreviation period without space before next word ---
  // "Seb.Merkle Str." → "Seb. Merkle Str."
  // Only insert space when a lowercase letter precedes the period (abbreviation like "Seb.")
  // and an uppercase letter follows (new word). Avoids breaking "H.A.U." acronyms.
  result = result.replace(/([a-zäöüß])\.([A-ZÄÖÜ])/g, '$1. $2');

  // --- Compound street name hyphenation ---
  // German streets named after people use hyphens: "Karl Friedrich Str." → "Karl-Friedrich-Str."
  // Match: capitalized word (NOT a preposition/article) followed by a street-suffix word.
  // Exclude common prepositions/articles: Am, An, Im, Auf, Vor, Bei, Zum, Zur, In
  var compoundRe = new RegExp(
    '\\b(?!Am\\b|An\\b|Im\\b|Auf\\b|Vor\\b|Bei\\b|Zum\\b|Zur\\b|In\\b)' +
    '([A-ZÄÖÜ][a-zäöüß]+)\\s+' +
    '([A-ZÄÖÜ][a-zäöüß]*(?:str(?:\\.|aße|asse)?|weg|platz|gasse|allee))\\b',
    'g'
  );
  result = result.replace(compoundRe, '$1-$2');

  // --- Parenthetical content in street part (before city comma) ---
  // "Hauptstr. (Rathaus) 18, 73275 Ohmden" → "Hauptstr. 18, 73275 Ohmden"
  // "Schloßweg (Jesuitenschloß), 79249 Merzhausen" → "Schloßweg, 79249 Merzhausen"
  result = result.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

  return result;
}

function middleware() {
  return function (req, res, next) {
    const text = _.get(req, 'clean.text');
    if (text) {
      const normalized = normalizeText(text);
      if (normalized !== text) {
        req.clean.text = normalized;
      }
    }
    return next();
  };
}

// Export for unit testing
middleware.normalizeText = normalizeText;

module.exports = middleware;
