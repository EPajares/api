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

// Strip parenthetical disambiguation suffix from German city names.
// German official city names often include a geographic disambiguator in
// parentheses, e.g. "Rheinfelden (Baden)", "Singen (Hohentwiel)".
// libpostal may strip the parens but keep the suffix: "rheinfelden baden".
// The OSM/WOF index only stores the base name ("Rheinfelden"), so we must
// strip the suffix to get a match.
//
// Strategy: look at the raw query text for parenthetical content.  If the
// parsed city ends with the same word(s) that appeared in parentheses,
// remove them.
const PAREN_SUFFIX = /\s*\(.*\)\s*$/;
const PAREN_CONTENT = /\(([^)]+)\)/g;

function normalizeCity(city, rawText) {
  if (!_.isString(city) || _.isEmpty(city.trim())) {
    return city;
  }

  // Case 1: parens still present (rare, but handle it)
  if (PAREN_SUFFIX.test(city)) {
    return city.replace(PAREN_SUFFIX, '').trim();
  }

  // Case 2: libpostal already stripped parens → detect from raw query text
  if (_.isString(rawText) && rawText.includes('(')) {
    const matches = rawText.match(PAREN_CONTENT);
    if (matches) {
      let result = city;
      for (const m of matches) {
        // m is like "(Baden)" — extract inner text
        const inner = m.slice(1, -1).trim().toLowerCase();
        if (inner && result.toLowerCase().endsWith(inner)) {
          result = result.slice(0, result.length - inner.length).trim();
        }
      }
      if (result.length > 0 && result !== city) {
        return result;
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
