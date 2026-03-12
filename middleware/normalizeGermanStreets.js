const _ = require('lodash');

/**
 * German query normalizer.
 *
 * 1) Expands common German street-type abbreviations to their full form so that
 *    queries like "Herrenstr. 29" match index entries stored as "Herrenstraße 29".
 *
 * 2) Restores parenthetical disambiguation in city names when libpostal has
 *    flattened them.  E.g. the user writes "Rheinfelden (Baden)" but libpostal
 *    parses city as "rheinfelden baden".  The WOF/OSM index stores the name
 *    *with* parentheses ("Rheinfelden (Baden)"), so we reconstruct the original
 *    form so that ES can match it properly.
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
];

function normalizeStreet(street) {
  if (!_.isString(street) || _.isEmpty(street.trim())) {
    return street;
  }

  let result = street;
  for (const rule of STREET_EXPANSIONS) {
    if (rule.pattern.test(result)) {
      result = result.replace(rule.pattern, rule.replace);
      break;  // apply only the first matching rule
    }
  }
  return result;
}

// Restore parenthetical disambiguation in city names.
//
// German official city names include a geographic disambiguator in parentheses:
//   "Rheinfelden (Baden)", "Singen (Hohentwiel)", "Frankfurt (Oder)"
//
// The WOF/OSM index stores these *with* parentheses, e.g.
//   parent.locality = "Rheinfelden (Baden)"
//
// But libpostal strips the parens and flattens to "rheinfelden baden".
// ES then tokenises "rheinfelden" and "baden" separately, often matching the
// wrong city (e.g. the city "Baden" a.k.a. Baden-Baden).
//
// Fix: detect parenthetical content in the raw query text, and if libpostal
// produced a flattened version, restore the parentheses so ES can match the
// indexed form.
//
// Example:
//   raw text:  "Kapuzinerstr. 4, Rheinfelden (Baden), 79618"
//   libpostal: city = "rheinfelden baden"
//   restored:  city = "rheinfelden (baden)"
const PAREN_CONTENT = /\(([^)]+)\)/g;

function normalizeCity(city, rawText) {
  if (!_.isString(city) || _.isEmpty(city.trim())) {
    return city;
  }

  // If the city already contains parens, leave it alone.
  if (city.includes('(')) {
    return city;
  }

  // Only act when the raw query text contained parentheses (meaning the user
  // deliberately included a disambiguator that libpostal then flattened).
  if (!_.isString(rawText) || !rawText.includes('(')) {
    return city;
  }

  const matches = rawText.match(PAREN_CONTENT);
  if (!matches) {
    return city;
  }

  for (const m of matches) {
    const inner = m.slice(1, -1).trim();
    // Check if the flattened city ends with the inner text (case-insensitive).
    if (inner && city.toLowerCase().endsWith(inner.toLowerCase())) {
      const base = city.slice(0, city.length - inner.length).trim();
      if (base.length > 0) {
        // Restore the parenthetical form: "rheinfelden (baden)"
        return base + ' (' + inner.toLowerCase() + ')';
      }
    }
  }

  return city;
}

function middleware() {
  return function (req, res, next) {
    const parsedText = _.get(req, 'clean.parsed_text');
    if (!parsedText) {
      return next();
    }

    // normalize street abbreviations
    const street = parsedText.street;
    if (street) {
      const normalizedStreet = normalizeStreet(street);
      if (normalizedStreet !== street) {
        parsedText.street = normalizedStreet;
      }
    }

    // strip parenthetical disambiguation from city
    const city = parsedText.city;
    if (city) {
      const rawText = _.get(req, 'clean.text', '');
      const normalizedCity = normalizeCity(city, rawText);
      if (normalizedCity !== city) {
        parsedText.city = normalizedCity;
      }
    }

    return next();
  };
}

// export helpers for unit testing
middleware.normalizeStreet = normalizeStreet;
middleware.normalizeCity = normalizeCity;

module.exports = middleware;
