var normalizeGermanStreets = require('../../../middleware/normalizeGermanStreets');

module.exports.tests = {};

module.exports.tests.interface = function(test, common) {
  test('factory returns a middleware function', function(t) {
    var mw = normalizeGermanStreets();
    t.equal(typeof mw, 'function', 'middleware is a function');
    t.equal(mw.length, 3, 'middleware takes req/res/next');
    t.end();
  });
};

module.exports.tests.normalizeStreet_unit = function(test, common) {
  var fn = normalizeGermanStreets.normalizeStreet;

  test('str. suffix → straße', function(t) {
    t.equal(fn('Herrenstr.'), 'Herrenstraße');
    t.equal(fn('Hauptstr.'), 'Hauptstraße');
    t.end();
  });

  test('str suffix (no dot) → straße', function(t) {
    t.equal(fn('Herrenstr'), 'Herrenstraße');
    t.end();
  });

  test('strasse → straße', function(t) {
    t.equal(fn('Herrenstrasse'), 'Herrenstraße');
    t.end();
  });

  test('pl. suffix → platz', function(t) {
    t.equal(fn('Marktpl.'), 'Marktplatz');
    t.end();
  });

  test('already correct straße is unchanged', function(t) {
    t.equal(fn('Herrenstraße'), 'Herrenstraße');
    t.end();
  });

  test('non-matching string is unchanged', function(t) {
    t.equal(fn('Am Waldrand'), 'Am Waldrand');
    t.end();
  });

  test('null / undefined / empty returns as-is', function(t) {
    t.equal(fn(null), null);
    t.equal(fn(undefined), undefined);
    t.equal(fn(''), '');
    t.equal(fn('  '), '  ');
    t.end();
  });

  test('case insensitive', function(t) {
    t.equal(fn('HerrenSTR.'), 'Herrenstraße');
    t.equal(fn('HERRENSTRASSE'), 'HERRENstraße');
    t.end();
  });
};

module.exports.tests.normalizeCity_unit = function(test, common) {
  var fn = normalizeGermanStreets.normalizeCity;

  test('restores parens when libpostal flattened them', function(t) {
    // libpostal gives "rheinfelden baden" from "Rheinfelden (Baden)"
    t.equal(
      fn('rheinfelden baden',
        'Kapuzinerstr. 4, Rheinfelden (Baden), 79618'),
      'rheinfelden (baden)');
    t.equal(
      fn('singen hohentwiel',
        'Hauptstr. 3, Singen (Hohentwiel), 78224'),
      'singen (hohentwiel)');
    t.equal(
      fn('feldberg schwarzwald',
        'Falkauerstr. 1, Feldberg (Schwarzwald), 79868'),
      'feldberg (schwarzwald)');
    t.end();
  });

  test('leaves city alone when it already has parens', function(t) {
    t.equal(
      fn('Rheinfelden (Baden)', 'anything'), 'Rheinfelden (Baden)');
    t.end();
  });

  test('leaves city alone when no parens in raw text', function(t) {
    t.equal(fn('Stuttgart', 'Hauptstr. 1, Stuttgart, 70173'),
      'Stuttgart');
    t.equal(fn('Mannheim', ''), 'Mannheim');
    t.end();
  });

  test('null / undefined / empty returns as-is', function(t) {
    t.equal(fn(null, ''), null);
    t.equal(fn(undefined, ''), undefined);
    t.equal(fn('', ''), '');
    t.end();
  });
};

module.exports.tests.middleware_integration = function(test, common) {

  test('normalises parsed_text.street in req.clean', function(t) {
    var mw = normalizeGermanStreets();
    var req = { clean: { parsed_text: { street: 'Herrenstr.' } } };
    mw(req, {}, function() {
      t.equal(req.clean.parsed_text.street, 'Herrenstraße');
      t.end();
    });
  });

  test('does nothing when parsed_text.street is absent', function(t) {
    var mw = normalizeGermanStreets();
    var req = { clean: { parsed_text: { locality: 'Stuttgart' } } };
    mw(req, {}, function() {
      t.deepEqual(req.clean.parsed_text, { locality: 'Stuttgart' });
      t.end();
    });
  });

  test('does nothing when clean is absent', function(t) {
    var mw = normalizeGermanStreets();
    var req = {};
    mw(req, {}, function() {
      t.deepEqual(req, {});
      t.end();
    });
  });

  test('does nothing when street already has straße', function(t) {
    var mw = normalizeGermanStreets();
    var req = { clean: { parsed_text: { street: 'Herrenstraße' } } };
    mw(req, {}, function() {
      t.equal(req.clean.parsed_text.street, 'Herrenstraße');
      t.end();
    });
  });

  test('restores parens in city field', function(t) {
    var mw = normalizeGermanStreets();
    var req = {
      clean: {
        text: 'Kapuzinerstr. 4, Rheinfelden (Baden), 79618',
        parsed_text: {
          city: 'rheinfelden baden',
          street: 'kapuzinerstraße'
        }
      }
    };
    mw(req, {}, function() {
      t.equal(req.clean.parsed_text.city, 'rheinfelden (baden)');
      t.end();
    });
  });

  test('leaves city alone when it already has parens', function(t) {
    var mw = normalizeGermanStreets();
    var req = {
      clean: {
        text: 'test',
        parsed_text: { city: 'Rheinfelden (Baden)' }
      }
    };
    mw(req, {}, function() {
      t.equal(req.clean.parsed_text.city, 'Rheinfelden (Baden)');
      t.end();
    });
  });

  test('normalises both street and city together', function(t) {
    var mw = normalizeGermanStreets();
    var req = {
      clean: {
        text: 'Hauptstr. 3, Singen (Hohentwiel), 78224',
        parsed_text: {
          street: 'Hauptstr.',
          city: 'singen hohentwiel'
        }
      }
    };
    mw(req, {}, function() {
      t.equal(req.clean.parsed_text.street, 'Hauptstraße');
      t.equal(req.clean.parsed_text.city, 'singen (hohentwiel)');
      t.end();
    });
  });
};

module.exports.all = function (tape, common) {
  function test(name, testFunction) {
    return tape('middleware/normalizeGermanStreets: ' + name, testFunction);
  }

  for (var testCase in module.exports.tests) {
    module.exports.tests[testCase](test, common);
  }
};
