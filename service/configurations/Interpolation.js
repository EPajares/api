const url = require('url');
const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const Debug = require('../../helper/debug');
const debugLog = new Debug('interpolation:request');
const querystring = require('querystring');

const ServiceConfiguration = require('pelias-microservice-wrapper').ServiceConfiguration;

// PLZ centroid lookup: used to correct interpolation coordinates when the
// top ES result is a plz_mismatch (wrong city) so interpolation doesn't
// search near the wrong location.
const PLZ_CENTROIDS = (() => {
  try {
    const csv = fs.readFileSync(path.join(__dirname, '../../data/plz_geocoord.csv'), 'utf8');
    const map = {};
    for (const line of csv.split('\n').slice(1)) {
      const [plz, lat, lng] = line.split(',');
      if (plz && lat && lng) { map[plz.trim()] = { lat: parseFloat(lat), lon: parseFloat(lng) }; }
    }
    return map;
  } catch(e) {
    return {};
  }
})();

class Interpolation extends ServiceConfiguration {
  constructor(o) {
    super('interpolation', o);
  }

  getInterpolationNumber(req) {
    const parsedText = _.get(req, 'clean.parsed_text', {});
    const housenumber = parsedText.housenumber;
    const unit = parsedText.unit;
    const queryText = _.get(req, 'clean.query.text') || _.get(req, 'clean.text') || '';

    if (_.isString(housenumber) && _.isString(unit) && _.isString(queryText)) {
      const unitTrimmed = unit.trim();
      const housenumberTrimmed = housenumber.trim();

      if (!_.isEmpty(unitTrimmed) && !_.isEmpty(housenumberTrimmed)) {
        const slashPattern = new RegExp(
          `\\b${_.escapeRegExp(unitTrimmed)}\\s*\\/\\s*${_.escapeRegExp(housenumberTrimmed)}\\b`
        );

        if (slashPattern.test(queryText)) {
          return unitTrimmed;
        }
      }
    }

    return housenumber;
  }

  getStreetValue(req, hit) {
    const rawStreet = hit.address_parts.street || req.clean.parsed_text.street;

    if (_.isArray(rawStreet)) {
      return _.find(rawStreet, value => _.isString(value) && !_.isEmpty(value.trim()));
    }

    if (_.isString(rawStreet)) {
      return rawStreet;
    }

    return undefined;
  }

  getParameters(req, hit) {
    let lat = hit.center_point.lat;
    let lon = hit.center_point.lon;

    // When the top result is a plz_mismatch, its coordinates are in the wrong city.
    // Use the queried PLZ centroid instead so interpolation searches the right area.
    if (hit.match_type === 'plz_mismatch') {
      const queriedPlz = _.get(req, 'clean.parsed_text.postalcode') ||
                         _.get(req, 'clean.postalcode');
      const centroid = queriedPlz && PLZ_CENTROIDS[queriedPlz];
      if (centroid) {
        lat = centroid.lat;
        lon = centroid.lon;
      }
    }

    let params = {
      number: this.getInterpolationNumber(req),
      street: this.getStreetValue(req, hit),
      lat,
      lon
    };

    return params;
  }

  getUrl(_req) {
    return url.resolve(this.baseUrl, 'search/geojson');
  }

  getQueryDebug(req, hit) {
    const params = this.getParameters(req, hit);

    if (req.clean.exposeInternalDebugTools) {
      const table = url.resolve(this.baseUrl, 'extract/table') + '?' + querystring.stringify({ ...params, names: params.street });
      const raw = this.getUrl() + '?' + querystring.stringify(params);
      const demo = url.resolve(this.baseUrl, 'demo') + `/#16/${hit.center_point.lat}/${hit.center_point.lon}` +
        '?' + querystring.stringify({ name: params.street });
      return { links: { table, raw, demo }, params };
    } else {
      return { params };
    }
  }
}

module.exports = Interpolation;
