const _ = require('lodash');

/**
 * German street abbreviation normalizer.
 *
 * Expands common German street-type abbreviations to their full form so that
 * queries like "Herrenstr. 29" match index entries stored as "Herrenstraße 29".
 *
 * Runs on `clean.parsed_text.street` — designed to be inserted as middleware
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

function middleware() {
  return function (req, res, next) {
    const street = _.get(req, 'clean.parsed_text.street');
    if (street) {
      const normalized = normalizeStreet(street);
      if (normalized !== street) {
        req.clean.parsed_text.street = normalized;
      }
    }
    return next();
  };
}

// also export normalizeStreet for unit testing
middleware.normalizeStreet = normalizeStreet;

module.exports = middleware;
