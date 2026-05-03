'use strict';

/**
 * City validation middleware.
 *
 * Runs after plzValidation.  When the request contains a city name AND the
 * result's locality clearly does not match that city, the result's match_type
 * is overridden to 'city_mismatch' so that consumers are not misled by
 * Pelias's 'exact' label.
 *
 * This catches the case where no postal code is provided in the query, but
 * Pelias returns an address in a completely different city with the same
 * street name.
 *
 * Example (without PLZ):
 *   Query  : "Sautierstraße 1, Freiburg"
 *   Result : Sautierstraße 1, Geisingen (locality ≠ "Freiburg")
 *   After  : match_type becomes "city_mismatch"
 *
 * Matching strategy — normalized prefix comparison:
 *   queried "freiburg"  vs result "Freiburg im Breisgau" → match (result starts with query)
 *   queried "freiburg"  vs result "Geisingen"            → mismatch
 *   queried "neustadt"  vs result "Neustadt an der Weinstraße" → match (result starts with query)
 *   queried "karlsruhe" vs result "Karlsruhe"            → match (exact after normalization)
 *
 * Skips results that are already tagged as plz_mismatch (PLZ takes precedence)
 * and admin-layer results (city IS the result for those).
 */

const _ = require('lodash');
const logger = require('pelias-logger').get('api');

// Layers that ARE cities — no point comparing a city result against itself.
const ADMIN_LAYERS = new Set([
  'venue', 'locality', 'localadmin', 'borough', 'neighbourhood',
  'county', 'macrocounty', 'region', 'macroregion', 'dependency', 'country', 'postalcode'
]);

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

  const queriedCity = _.get(req, 'clean.parsed_text.city');
  if (!queriedCity) {
    return next();
  }

  res.data = res.data.map(hit => applyCityValidation(hit, queriedCity));

  next();
}

/**
 * Normalize a city name for comparison:
 *   - lowercase
 *   - strip parenthetical disambiguation suffixes, e.g. "Rheinfelden (Baden)" → "rheinfelden"
 *   - collapse whitespace
 */
function normalizeCity(name) {
  return name
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Return true when queried and result city are considered a match.
 * Uses prefix matching so that "freiburg" matches "Freiburg im Breisgau"
 * and "neustadt" matches "Neustadt an der Weinstraße".
 */
function citiesMatch(queried, result) {
  const q = normalizeCity(queried);
  const r = normalizeCity(result);
  return r.startsWith(q) || q.startsWith(r);
}

function applyCityValidation(hit, queriedCity) {
  // PLZ validation already flagged this result — don't double-label.
  if (hit.match_type === 'plz_mismatch') {
    return hit;
  }

  // Admin-layer results represent the city itself — no point checking.
  if (ADMIN_LAYERS.has(hit.layer)) {
    return hit;
  }

  // Prefer locality; fall back to localadmin for addresses in rural areas.
  const resultCity = _.get(hit, 'parent.locality[0]') ||
                     _.get(hit, 'parent.localadmin[0]');

  if (!resultCity) {
    return hit;
  }

  if (!citiesMatch(queriedCity, resultCity)) {
    logger.debug(
      '[city-validation] mismatch — queried: %s, result: %s, label: %s',
      queriedCity,
      resultCity,
      _.get(hit, 'name.default', '')
    );
    hit.match_type = 'city_mismatch';
    hit.confidence = Math.min(hit.confidence || 1, 0.5);
  }

  return hit;
}

module.exports = setup;
