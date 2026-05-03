'use strict';

/**
 * PLZ (postal code) validation middleware.
 *
 * Runs after confidenceScore/confidenceScoreFallback.  When the request
 * contains a German postal code AND the top result's postal code does not
 * match, the result's match_type is overridden to 'plz_mismatch' so that
 * consumers are not misled by Pelias's 'exact' label.
 *
 * Typical failure mode this prevents:
 *   Query  : "Markgrafstr. 8, Karlsruhe, 76131"
 *   Result : Markgraf-Wilhelm-Straße 8, Gaggenau (PLZ 76571) — match_type "exact"
 *   After  : match_type becomes "plz_mismatch"
 */

const _ = require('lodash');
const logger = require('pelias-logger').get('api');

// Matches an isolated 5-digit German postal code in the raw query text.
// Requires a word boundary on both sides so that house-number ranges or
// phone prefixes (which are rare in geocoding inputs) are not mistaken for PLZs.
const PLZ_RE = /\b(\d{5})\b/;

function setup() {
  return validate;
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

  const inputPlz = getInputPlz(req);
  if (!inputPlz) {
    return next();
  }

  res.data = res.data.map(hit => applyPlzValidation(hit, inputPlz));

  next();
}

/**
 * Return the PLZ from the request, trying three sources in priority order:
 *   1. req.clean.postalcode          — structured geocoding
 *   2. req.clean.parsed_text.postalcode — libpostal parse (free-text)
 *   3. regex match on req.clean.text — fallback when postalcode is stripped
 *      from parsed_text by a later pipeline stage (e.g. defer_to_pelias_parser)
 */
function getInputPlz(req) {
  // Structured geocoding: postalcode is a top-level clean field
  if (!_.isNil(_.get(req, 'clean.postalcode'))) {
    return req.clean.postalcode;
  }
  // Free-text search: postalcode comes from libpostal via parsed_text
  if (!_.isNil(_.get(req, 'clean.parsed_text.postalcode'))) {
    return req.clean.parsed_text.postalcode;
  }
  // Fallback: extract directly from the raw input text.  This covers the
  // case where postalcode is present in the original query but has been
  // stripped from parsed_text by a downstream sanitizer.
  const rawText = _.get(req, 'clean.text', '');
  const m = PLZ_RE.exec(rawText);
  return m ? m[1] : null;
}

function applyPlzValidation(hit, inputPlz) {
  const resultPlz = _.get(hit, 'address_parts.zip');

  if (!resultPlz) {
    // No PLZ in result (e.g. street-only fallback) — cannot validate, leave as-is
    return hit;
  }

  if (resultPlz !== inputPlz) {
    logger.debug(
      '[plz-validation] mismatch — input: %s, result: %s, label: %s',
      inputPlz,
      resultPlz,
      _.get(hit, 'name.default', '')
    );
    hit.match_type = 'plz_mismatch';
    // Cap confidence at 0.5 — consistent with the deal-breaker in confidenceScore.js
    // for search_pelias_parser queries, where PLZ mismatch already sets 0.5.
    // For address_search_using_ids the fallback scorer leaves confidence at 1.0,
    // which is misleading for a wrong-city result.
    hit.confidence = Math.min(hit.confidence || 1, 0.5);
  }

  return hit;
}

module.exports = setup;
