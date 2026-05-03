'use strict';

var setup = require('../../../middleware/cityValidation');

module.exports.tests = {};

module.exports.tests.interface = function(test, common) {
  test('factory returns a middleware function', function(t) {
    var mw = setup();
    t.equal(typeof mw, 'function', 'middleware is a function');
    t.equal(mw.length, 3, 'middleware takes req/res/next');
    t.end();
  });
};

module.exports.tests.no_city_in_request = function(test, common) {
  test('skips when request has no parsed city', function(t) {
    var mw = setup();
    var req = { clean: { parsed_text: { street: 'hauptstraße' } } };
    var res = { data: [{ layer: 'address', match_type: 'exact', parent: { locality: ['Geisingen'] } }] };
    mw(req, res, function() {
      t.equal(res.data[0].match_type, 'exact', 'match_type unchanged when no city in request');
      t.end();
    });
  });
};

module.exports.tests.city_exact_match = function(test, common) {
  test('leaves match_type unchanged when city matches exactly', function(t) {
    var mw = setup();
    var req = { clean: { parsed_text: { city: 'karlsruhe' } } };
    var res = { data: [{ layer: 'address', match_type: 'exact', confidence: 1, parent: { locality: ['Karlsruhe'] } }] };
    mw(req, res, function() {
      t.equal(res.data[0].match_type, 'exact', 'exact match preserved');
      t.end();
    });
  });
};

module.exports.tests.city_prefix_match = function(test, common) {
  test('treats "freiburg" as matching "Freiburg im Breisgau"', function(t) {
    var mw = setup();
    var req = { clean: { parsed_text: { city: 'freiburg' } } };
    var res = { data: [{ layer: 'address', match_type: 'exact', confidence: 1, parent: { locality: ['Freiburg im Breisgau'] } }] };
    mw(req, res, function() {
      t.equal(res.data[0].match_type, 'exact', 'prefix match not flagged as mismatch');
      t.end();
    });
  });
};

module.exports.tests.city_mismatch = function(test, common) {
  test('overrides match_type to city_mismatch when cities clearly differ', function(t) {
    var mw = setup();
    var req = { clean: { parsed_text: { city: 'freiburg' } } };
    var res = { data: [{ layer: 'address', match_type: 'exact', confidence: 1, parent: { locality: ['Geisingen'] } }] };
    mw(req, res, function() {
      t.equal(res.data[0].match_type, 'city_mismatch', 'match_type overridden to city_mismatch');
      t.equal(res.data[0].confidence, 0.5, 'confidence capped at 0.5');
      t.end();
    });
  });
};

module.exports.tests.plz_mismatch_takes_precedence = function(test, common) {
  test('does not override plz_mismatch label', function(t) {
    var mw = setup();
    var req = { clean: { parsed_text: { city: 'freiburg' } } };
    var res = { data: [{ layer: 'address', match_type: 'plz_mismatch', confidence: 0.5, parent: { locality: ['Geisingen'] } }] };
    mw(req, res, function() {
      t.equal(res.data[0].match_type, 'plz_mismatch', 'plz_mismatch label preserved');
      t.end();
    });
  });
};

module.exports.tests.admin_layer_skipped = function(test, common) {
  test('skips locality-layer results (city IS the result)', function(t) {
    var mw = setup();
    var req = { clean: { parsed_text: { city: 'freiburg' } } };
    var res = { data: [{ layer: 'locality', match_type: 'exact', confidence: 1, parent: { locality: ['Freiburg im Breisgau'] } }] };
    mw(req, res, function() {
      t.equal(res.data[0].match_type, 'exact', 'admin result not flagged');
      t.end();
    });
  });
};

module.exports.tests.no_result_city = function(test, common) {
  test('skips when result has no parent locality', function(t) {
    var mw = setup();
    var req = { clean: { parsed_text: { city: 'freiburg' } } };
    var res = { data: [{ layer: 'address', match_type: 'exact', confidence: 1, parent: {} }] };
    mw(req, res, function() {
      t.equal(res.data[0].match_type, 'exact', 'no change when locality unknown');
      t.end();
    });
  });
};

module.exports.tests.localadmin_fallback = function(test, common) {
  test('falls back to localadmin when locality is absent', function(t) {
    var mw = setup();
    var req = { clean: { parsed_text: { city: 'karlsruhe' } } };
    var res = { data: [{ layer: 'address', match_type: 'exact', confidence: 1, parent: { localadmin: ['Karlsruhe'] } }] };
    mw(req, res, function() {
      t.equal(res.data[0].match_type, 'exact', 'localadmin used as fallback');
      t.end();
    });
  });
};

module.exports.tests.parenthetical_stripped = function(test, common) {
  test('strips parenthetical disambiguation before comparing', function(t) {
    var mw = setup();
    var req = { clean: { parsed_text: { city: 'rheinfelden' } } };
    var res = { data: [{ layer: 'address', match_type: 'exact', confidence: 1, parent: { locality: ['Rheinfelden (Baden)'] } }] };
    mw(req, res, function() {
      t.equal(res.data[0].match_type, 'exact', 'parenthetical stripped before comparison');
      t.end();
    });
  });
};

module.exports.all = function(tape, common) {
  function test(name, testFunction) {
    return tape('cityValidation: ' + name, testFunction);
  }
  for (var testCase in module.exports.tests) {
    module.exports.tests[testCase](test, common);
  }
};
