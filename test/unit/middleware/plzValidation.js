'use strict';

var setup = require('../../../middleware/plzValidation');

module.exports.tests = {};

module.exports.tests.interface = function(test, common) {
  test('factory returns a middleware function', function(t) {
    var mw = setup();
    t.equal(typeof mw, 'function', 'middleware is a function');
    t.equal(mw.length, 3, 'middleware takes req/res/next');
    t.end();
  });
};

module.exports.tests.no_plz_in_request = function(test, common) {
  test('skips when request has no PLZ', function(t) {
    var mw = setup();
    var req = { clean: { text: 'Hauptstraße 1, Berlin' } };
    var res = { data: [{ match_type: 'exact', address_parts: { zip: '10115' } }] };
    mw(req, res, function() {
      t.equal(res.data[0].match_type, 'exact', 'match_type unchanged when no PLZ in request');
      t.end();
    });
  });
};

module.exports.tests.plz_match = function(test, common) {
  test('leaves match_type unchanged when PLZ matches', function(t) {
    var mw = setup();
    var req = { clean: { parsed_text: { postalcode: '79104' }, text: 'Sautierstraße 1, 79104, Freiburg' } };
    var res = { data: [{ match_type: 'exact', address_parts: { zip: '79104' } }] };
    mw(req, res, function() {
      t.equal(res.data[0].match_type, 'exact', 'match_type stays exact when PLZ matches');
      t.end();
    });
  });
};

module.exports.tests.plz_mismatch_parsed_text = function(test, common) {
  test('overrides match_type to plz_mismatch when parsed_text PLZ does not match result', function(t) {
    var mw = setup();
    var req = { clean: { parsed_text: { postalcode: '76131' }, text: 'Markgrafstr. 8, 76131 Karlsruhe' } };
    var res = { data: [{ match_type: 'exact', address_parts: { zip: '76571' } }] };
    mw(req, res, function() {
      t.equal(res.data[0].match_type, 'plz_mismatch', 'match_type overridden to plz_mismatch');
      t.end();
    });
  });
};

module.exports.tests.plz_mismatch_structured = function(test, common) {
  test('overrides match_type using clean.postalcode for structured queries', function(t) {
    var mw = setup();
    var req = { clean: { postalcode: '76131', text: '' } };
    var res = { data: [{ match_type: 'exact', address_parts: { zip: '76530' } }] };
    mw(req, res, function() {
      t.equal(res.data[0].match_type, 'plz_mismatch', 'structured PLZ mismatch overrides match_type');
      t.end();
    });
  });
};

module.exports.tests.plz_fallback_from_raw_text = function(test, common) {
  test('extracts PLZ from raw text when parsed_text.postalcode is absent', function(t) {
    var mw = setup();
    // Simulates the case where normalizeGermanAddress strips PLZ before libpostal runs
    var req = { clean: { parsed_text: { street: 'sautierstraße', housenumber: '1' }, text: 'Sautierstraße 1, 79104, Freiburg' } };
    var res = { data: [{ match_type: 'exact', address_parts: { zip: '78187' } }] };
    mw(req, res, function() {
      t.equal(res.data[0].match_type, 'plz_mismatch', 'PLZ extracted from raw text as fallback');
      t.end();
    });
  });
};

module.exports.tests.result_without_zip = function(test, common) {
  test('leaves match_type unchanged when result has no address_parts.zip', function(t) {
    var mw = setup();
    var req = { clean: { parsed_text: { postalcode: '76131' }, text: 'Markgrafstr. 8, 76131 Karlsruhe' } };
    var res = { data: [{ match_type: 'exact', address_parts: {} }] };
    mw(req, res, function() {
      t.equal(res.data[0].match_type, 'exact', 'match_type unchanged when result has no zip');
      t.end();
    });
  });
};

module.exports.tests.empty_data = function(test, common) {
  test('skips when res.data is empty', function(t) {
    var mw = setup();
    var req = { clean: { parsed_text: { postalcode: '76131' } } };
    var res = { data: [] };
    mw(req, res, function() {
      t.equal(res.data.length, 0, 'no change to empty data');
      t.end();
    });
  });
};

module.exports.all = function(tape, common) {
  function test(name, testFunction) {
    return tape('plzValidation: ' + name, testFunction);
  }
  for (var testCase in module.exports.tests) {
    module.exports.tests[testCase](test, common);
  }
};
