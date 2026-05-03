'use strict';

/**
 * Street name validation middleware.
 *
 * Runs after confidenceScoreFallback / plzValidation / cityValidation.
 * Detects two classes of false-positive street matches and lowers confidence:
 *
 * Category B — compound-prefix expansion:
 *   Query "Fleiner Straße" matches "Balthasar-Fleiner-Straße" because the
 *   peliasStreet analyzer splits on hyphens and operator:AND is satisfied by
 *   the query tokens appearing as a SUFFIX of the result tokens.
 *   Detection: query token list is a proper suffix of result token list.
 *   Action: match_type = 'street_mismatch', confidence capped at 0.6.
 *
 * Category C — fuzzy street name collision:
 *   Query "Andreasstraße" fuzzy-matches "Andreaestraße" (1-edit distance).
 *   Detection: condensed forms (hyphens/spaces stripped) are neither equal
 *   nor substrings of each other.
 *   Action: match_type = 'street_mismatch', confidence capped at 0.5.
 */

const _ = require('lodash');
const logger = require('pelias-logger').get('api');

// Common German street-type suffixes (condensed, no hyphens/spaces).
// Used to detect Fugenelement expansions: "markgraf"+"straße" → "markgrafen"+"straße".
const STREET_SUFFIXES = [
  'straße', 'strasse', 'gasse', 'brücke', 'bruecke', 'anlage',
  'steige', 'ring', 'platz', 'weg', 'pfad', 'graben', 'allee',
  'damm', 'chaussee', 'promenade', 'ufer', 'steg', 'markt',
];

function setup() {
  return validate;
}

function tokenize(str) {
  if (!str) { return []; }
  // address_parts.street may be an array of aliases; use the first entry
  const s = Array.isArray(str) ? str[0] : str;
  if (typeof s !== 'string' || s.length === 0) { return []; }
  return s.toLowerCase().split(/[\s\-]+/).filter(t => t.length > 0);
}

function condense(tokens) {
  return tokens.join('');
}

// Returns true when result is a Fugenelement (-en-/-e-) expansion of query.
// e.g. "markgrafstraße" → "markgrafenstraße" (insert "en" before suffix).
// This prevents flagging the legitimate Markgrafstr./Markgrafenstraße case.
function isFugenelementExpansion(qCondensed, rCondensed) {
  for (const suffix of STREET_SUFFIXES) {
    if (qCondensed.endsWith(suffix) && rCondensed.endsWith(suffix)) {
      const qStem = qCondensed.slice(0, -suffix.length);
      const rStem = rCondensed.slice(0, -suffix.length);
      if (rStem === qStem + 'en' || rStem === qStem + 'e') {
        return true;
      }
    }
  }
  return false;
}

// Category B: every query token exactly matches the tail of the result token list,
// and the result has at least one additional prefix token.
function isQueryProperSuffixOfResult(qTokens, rTokens) {
  if (rTokens.length <= qTokens.length) { return false; }
  const offset = rTokens.length - qTokens.length;
  return qTokens.every((t, i) => t === rTokens[offset + i]);
}

function validate(req, res, next) {
  if (
    _.isUndefined(req.clean) ||
    _.isUndefined(res) ||
    _.isUndefined(res.data) ||
    res.data.length === 0
  ) {
    return next();
  }

  const inputStreet = _.get(req, 'clean.parsed_text.street');
  if (!inputStreet) { return next(); }

  const qTokens = tokenize(inputStreet);
  if (qTokens.length === 0) { return next(); }
  const qCondensed = condense(qTokens);

  res.data = res.data.map(hit => applyStreetValidation(hit, qTokens, qCondensed));
  next();
}

function applyStreetValidation(hit, qTokens, qCondensed) {
  const resultStreet = _.get(hit, 'address_parts.street');
  if (!resultStreet) { return hit; }

  const rTokens = tokenize(resultStreet);
  if (rTokens.length === 0) { return hit; }
  const rCondensed = condense(rTokens);

  // Category B: query tokens appear as a proper suffix of result tokens.
  // e.g. ["fleiner","straße"] is tail of ["balthasar","fleiner","straße"].
  if (isQueryProperSuffixOfResult(qTokens, rTokens)) {
    logger.debug(
      '[street-validation] compound-prefix expansion — query: %s  result: %s',
      qCondensed, rCondensed
    );
    hit.match_type = 'street_mismatch';
    hit.confidence = Math.min(hit.confidence || 1, 0.6);
    return hit;
  }

  // Category C: condensed forms are neither equal nor substrings of each other.
  // e.g. "andreasstraße" vs "andreaestraße" — one-edit fuzz collision.
  // Exempt: Fugenelement expansions like "markgrafstraße" → "markgrafenstraße"
  // where "-en-" is a legitimate German linking element before the street suffix.
  if (
    qCondensed !== rCondensed &&
    !rCondensed.includes(qCondensed) &&
    !qCondensed.includes(rCondensed) &&
    !isFugenelementExpansion(qCondensed, rCondensed)
  ) {
    logger.debug(
      '[street-validation] condensed mismatch — query: %s  result: %s',
      qCondensed, rCondensed
    );
    hit.match_type = 'street_mismatch';
    hit.confidence = Math.min(hit.confidence || 1, 0.5);
    return hit;
  }

  return hit;
}

// Export internals for unit testing
setup.tokenize = tokenize;
setup.condense = condense;
setup.isQueryProperSuffixOfResult = isQueryProperSuffixOfResult;
setup.isFugenelementExpansion = isFugenelementExpansion;

module.exports = setup;
