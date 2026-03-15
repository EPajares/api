var normalizeGermanAddress = require('../../../middleware/normalizeGermanAddress');

module.exports.tests = {};

module.exports.tests.interface = function(test, common) {
  test('factory returns a middleware function', function(t) {
    var mw = normalizeGermanAddress();
    t.equal(typeof mw, 'function', 'middleware is a function');
    t.equal(mw.length, 3, 'middleware takes req/res/next');
    t.end();
  });
};

module.exports.tests.slash_house_numbers = function(test, common) {
  var fn = normalizeGermanAddress.normalizeText;

  test('strips /1 sub-unit', function(t) {
    t.equal(fn('Hauptstr. 30/1, Dettingen unter Teck, 73265'),
               'Hauptstr. 30, Dettingen unter Teck, 73265');
    t.end();
  });

  test('strips /III roman sub-unit', function(t) {
    t.equal(fn('Kronenstr. 19/III, Stuttgart, 70173'),
               'Kronenstr. 19, Stuttgart, 70173');
    t.end();
  });

  test('strips /a letter sub-unit', function(t) {
    t.equal(fn('Musterstr. 5/a, Berlin, 10115'),
               'Musterstr. 5, Berlin, 10115');
    t.end();
  });

  test('does not touch postcodes or other slashes', function(t) {
    t.equal(fn('Musterstr. 5, Berlin, 10115'),
               'Musterstr. 5, Berlin, 10115');
    t.end();
  });
};

module.exports.tests.range_house_numbers = function(test, common) {
  var fn = normalizeGermanAddress.normalizeText;

  test('strips range 71-73', function(t) {
    t.equal(fn('Waldstr. 71-73, Karlsruhe, 76133'),
               'Waldstr. 71, Karlsruhe, 76133');
    t.end();
  });

  test('strips range 1-3', function(t) {
    t.equal(fn('Bahnhofstr. 1-3, Walldorf, 69190'),
               'Bahnhofstr. 1, Walldorf, 69190');
    t.end();
  });

  test('strips range with spaces 17 - 18', function(t) {
    t.equal(fn('Q 1, 17 - 18, Mannheim, 68161'),
               'Q1 17, Mannheim, 68161');
    t.end();
  });

  test('does not alter hyphenated street names', function(t) {
    t.equal(fn('Karl-Marx-Str. 5, Berlin, 10115'),
               'Karl-Marx-Str. 5, Berlin, 10115');
    t.end();
  });
};

module.exports.tests.mannheim_quadrate = function(test, common) {
  var fn = normalizeGermanAddress.normalizeText;

  test('N 7, 13-15, Mannheim → N7 13, Mannheim', function(t) {
    t.equal(fn('N 7, 13-15, Mannheim, 68161'),
               'N7 13, Mannheim, 68161');
    t.end();
  });

  test('C 3, 18, Mannheim → C3 18, Mannheim', function(t) {
    t.equal(fn('C 3, 18, Mannheim, 68159'),
               'C3 18, Mannheim, 68159');
    t.end();
  });

  test('U1, 13-15, Mannheim → U1 13, Mannheim', function(t) {
    t.equal(fn('U1, 13-15, Mannheim, 68161'),
               'U1 13, Mannheim, 68161');
    t.end();
  });

  test('L 14, 16-17, Mannheim → L14 16, Mannheim', function(t) {
    t.equal(fn('L 14, 16-17, Mannheim, 68161'),
               'L14 16, Mannheim, 68161');
    t.end();
  });

  test('J7, 18-19, Mannheim → J7 18, Mannheim', function(t) {
    t.equal(fn('J7, 18-19, Mannheim, 68159'),
               'J7 18, Mannheim, 68159');
    t.end();
  });

  test('G 7, 17 A, Mannheim (letter suffix)', function(t) {
    t.equal(fn('G 7, 17 A, Mannheim, 68159'),
               'G7 17 A, Mannheim, 68159');
    t.end();
  });

  test('does not match non-Mannheim addresses', function(t) {
    t.equal(fn('A 2, 5, Stuttgart, 70173'),
               'A 2, 5, Stuttgart, 70173');
    t.end();
  });
};

module.exports.tests.middleware_integration = function(test, common) {
  test('middleware modifies req.clean.text', function(t) {
    var mw = normalizeGermanAddress();
    var req = { clean: { text: 'Hauptstr. 30/1, Herrenberg, 71083' } };
    var res = {};
    mw(req, res, function() {
      t.equal(req.clean.text, 'Hauptstr. 30, Herrenberg, 71083');
      t.end();
    });
  });

  test('middleware does nothing when text is unchanged', function(t) {
    var mw = normalizeGermanAddress();
    var req = { clean: { text: 'Musterstr. 5, Berlin, 10115' } };
    var res = {};
    mw(req, res, function() {
      t.equal(req.clean.text, 'Musterstr. 5, Berlin, 10115');
      t.end();
    });
  });
};

module.exports.all = function(tape, common) {
  function test(name, testFunction) {
    return tape('normalizeGermanAddress: ' + name, testFunction);
  }
  for (var testCase in module.exports.tests) {
    module.exports.tests[testCase](test, common);
  }
};
