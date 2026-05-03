const _ = require('lodash');
const Query = require('./Query');
const match_phrase = require('../lib/leaf/match_phrase');
const match = require('../lib/leaf/match');

// Helper: build a street clause that accepts exact match_phrase OR fuzzy match.
// Uses multiple strategies to bridge German compound/hyphenated street mismatches:
// 1. Exact match_phrase (highest priority, standard search analyzer)
// 2. match with peliasStreet analyzer (bridges tokenization differences)
// 3. match with decompounded form + peliasStreet (bridges compound words)
// 4. Fugenelement (-en-) expanded form (e.g. "Markgrafstr."→"Markgrafenstr.")
// 5. Fuzzy match (catches typos and ö↔oe transliteration, lowest priority)
function fuzzyStreetClause(vs) {
  const clauses = [
    // Priority 1: Exact phrase match with the normal search analyzer
    match_phrase('address_parts.street', vs.var('input:street'), {
      slop: vs.var('address:street:slop'),
      analyzer: vs.var('address:street:analyzer'),
      boost: 5
    }),
    // Priority 2: Match using peliasStreet (index analyzer)
    match('address_parts.street', vs.var('input:street'), {
      analyzer: 'peliasStreet',
      operator: 'and',
      boost: 3
    }),
    // Priority 5a: Fuzzy fuzziness:1 — catches typos and ö↔oe transliteration
    // (e.g. "Löwenthal" query vs "Loewenthal" index: 1-edit, no prefix restriction)
    match('address_parts.street', vs.var('input:street'), {
      fuzziness: 1,
      operator: 'and',
      boost: 1,
      analyzer: vs.var('address:street:analyzer')
    }),
    // Priority 5b: Fuzzy fuzziness:2 prefix_length:8 — catches German -en- Fugenelement
    // "Markgrafstr." → "markgrafstr" shares 8-char prefix "markgraf" with "markgrafenstr"
    // prefix_length:8 blocks short false positives (e.g. "angerstr" vs "angelest" differ at pos 6)
    match('address_parts.street', vs.var('input:street'), {
      fuzziness: 2,
      prefix_length: 8,
      operator: 'and',
      boost: 1,
      analyzer: vs.var('address:street:analyzer')
    })
  ];

  // Priority 2.5: If decompounded variant exists, try matching it with peliasStreet
  // E.g. "kurfürstenanlage" → "kurfürsten-anlage" → tokens match index
  if (vs.isset('input:street_decompounded')) {
    clauses.splice(2, 0,
      match('address_parts.street', vs.var('input:street_decompounded'), {
        analyzer: 'peliasStreet',
        operator: 'and',
        boost: 2.5
      })
    );
  }

  // Concatenated variant (hyphens removed): "rot-kreuz-straße" → "rotkreuzstraße"
  // Matches index entries stored as compounds
  if (vs.isset('input:street_concatenated')) {
    clauses.push(
      match('address_parts.street', vs.var('input:street_concatenated'), {
        analyzer: 'peliasStreet',
        operator: 'and',
        boost: 2.5
      })
    );
  }

  // Prefix-stripped variant: "am hafenmarkt" → "hafenmarkt"
  // Matches index entries without the Am/An/Im preposition
  if (vs.isset('input:street_without_prefix')) {
    clauses.push(
      match('address_parts.street', vs.var('input:street_without_prefix'), {
        analyzer: 'peliasStreet',
        operator: 'and',
        boost: 2
      })
    );
  }

  // Fugenelement (-en-) expanded variant: "Markgrafstraße" → "Markgrafenstraße"
  // German compounds lose the -en- linking element when abbreviated;
  // this explicitly restores it as a soft should clause.
  if (vs.isset('input:street_en_expanded')) {
    clauses.push(
      match('address_parts.street', vs.var('input:street_en_expanded'), {
        analyzer: 'peliasStreet',
        operator: 'and',
        boost: 2
      })
    );
  }

  return {
    bool: {
      should: clauses,
      minimum_should_match: 1
    }
  };
}

function createAddressShould(vs) {
  const shouldClauses = [
    // non-numeric tokens are stripped from the index, use the phrase field to improve sorting.
    // see: https://github.com/pelias/pelias/issues/810
    match_phrase('phrase.default', vs.var('input:housenumber'))
  ];

  // When a postcode is available, boost results in the matching PLZ.
  // This is a soft tiebreaker: when the same house+street exists in multiple
  // PLZs (e.g. at a PLZ boundary), prefer the one matching the user's PLZ.
  if (vs.isset('input:postcode')) {
    shouldClauses.push(
      match_phrase('address_parts.zip', vs.var('input:postcode'), { boost: 10 })
    );
  }

  const should = {
    bool: {
      _name: 'fallback.address',
      must: [
        match_phrase('address_parts.number', vs.var('input:housenumber')),
        fuzzyStreetClause(vs)
      ],
      should: shouldClauses,
      filter: {
        term: {
          layer: 'address'
        }
      }
    }
  };

  if (vs.isset('boost:address')) {
    should.bool.boost = vs.var('boost:address');
  }

  return should;
}

function createUnitAndAddressShould(vs) {
  const should = {
    bool: {
      _name: 'fallback.address',
      must: [
        match_phrase('address_parts.unit', vs.var('input:unit')),
        match_phrase('address_parts.number', vs.var('input:housenumber')),
        fuzzyStreetClause(vs)
      ],
      should: [
        // non-numeric tokens are stripped from the index, use the phrase field to improve sorting.
        // see: https://github.com/pelias/pelias/issues/810
        match_phrase('phrase.default', vs.var('input:housenumber'))
      ],
      filter: {
        term: {
          layer: 'address'
        }
      }
    }
  };

  if (vs.isset('boost:address')) {
    should.bool.boost = vs.var('boost:address');
  }

  return should;
}

function createPostcodeAndAddressShould(vs) {
  const should = {
    bool: {
      _name: 'fallback.address',
      must: [
        match_phrase('address_parts.zip', vs.var('input:postcode')),
        match_phrase('address_parts.number', vs.var('input:housenumber')),
        fuzzyStreetClause(vs)
      ],
      should: [
        // non-numeric tokens are stripped from the index, use the phrase field to improve sorting.
        // see: https://github.com/pelias/pelias/issues/810
        match_phrase('phrase.default', vs.var('input:housenumber'))
      ],
      filter: {
        term: {
          layer: 'address'
        }
      }
    }
  };

  if (vs.isset('boost:address')) {
    should.bool.boost = vs.var('boost:address');
  }

  return should;
}

function createStreetShould(vs) {
  const should = {
    bool: {
      _name: 'fallback.street',
      must: [
        fuzzyStreetClause(vs)
      ],
      filter: {
        term: {
          layer: 'street'
        }
      }
    }
  };

  if (vs.isset('boost:street')) {
    should.bool.boost = vs.var('boost:street');
  }

  return should;

}

function createLayerIdsShould(layer, ids) {
  // create an object initialize with terms.'parent.locality_id' (or whatever)
  // must use array syntax for 2nd parameter as _.set interprets '.' as new object
  return _.set({}, ['terms', `parent.${layer}_id`], ids);
}

// Low-boost fallback: PLZ + street on address layer WITHOUT requiring house number.
// When the exact house number doesn't exist in the right PLZ (e.g. Lorcher Str 7
// in Lorch BW has no house 7, only 6 and 8), this branch surfaces neighbouring
// addresses so the interpolation service can estimate position.
// Very low boost (0.01) ensures exact address matches always outscore this.
// Tagged as 'fallback.street' so trimByGranularity removes these results when
// real address matches exist.
function createPostcodeAndStreetShould(vs) {
  return {
    bool: {
      _name: 'fallback.street',
      boost: 0.01,
      must: [
        match_phrase('address_parts.zip', vs.var('input:postcode')),
        fuzzyStreetClause(vs)
      ],
      filter: {
        term: {
          layer: 'address'
        }
      }
    }
  };
}

class AddressesUsingIdsQuery extends Query {
  constructor() {
    super();
  }

  render(vs) {
    // establish a base query with 'street' should condition and size/track_scores
    const base = {
      query: {
        function_score: {
          query: {
            bool: {
              minimum_should_match: 1,
              should: [
                createStreetShould(vs)
              ]
            }
          }
        }
      },
      size: vs.var('size'),
      track_scores: vs.var('track_scores')
    };

    // add unit/housenumber/street if available
    if (vs.isset('input:housenumber') && vs.isset('input:postcode')) {
      base.query.function_score.query.bool.should.push(createPostcodeAndAddressShould(vs));
    }
    // add unit/housenumber/street if available
    if (vs.isset('input:housenumber') && vs.isset('input:unit')) {
      base.query.function_score.query.bool.should.push(createUnitAndAddressShould(vs));
    }
    else if (vs.isset('input:housenumber')) {
      base.query.function_score.query.bool.should.push(createAddressShould(vs));
    }

    // Low-boost PLZ+street fallback for interpolation: surfaces neighbouring
    // addresses so the interpolation service can estimate position when the
    // exact housenumber is missing from the index.
    if (vs.isset('input:postcode')) {
      base.query.function_score.query.bool.should.push(createPostcodeAndStreetShould(vs));
    }

    // if there are layer->id mappings, add the layers with non-empty ids
    if (vs.isset('input:layers')) {
      // using $ due to reference object and not scalar object
      const layers_to_ids = vs.var('input:layers').$;

      // add the layers-to-ids 'should' conditions
      // if layers_to_ids is:
      // {
      //   locality: [1, 2],
      //   localadmin: [],
      //   region: [3, 4]
      // }
      // then this adds the results of:
      // - createShould('locality', [1, 2])
      // - createShould('region', [3, 4])
      // to an array
      const id_filters = Object.keys(layers_to_ids).reduce((acc, layer) => {
        if (!_.isEmpty(layers_to_ids[layer])) {
          acc.push(createLayerIdsShould(layer, layers_to_ids[layer]));
        }
        return acc;
      }, []);

      // add filter.bool.minimum_should_match and filter.bool.should,
      //  creating intermediate objects as it goes
      _.set(base.query.function_score.query.bool, 'filter.bool', {
        minimum_should_match: 1,
        should: id_filters
      });

    }

    // add any scores (_.compact removes falsey values from arrays)
    if (!_.isEmpty(this._score)) {
      base.query.function_score.functions = _.compact(this._score.map(view => view(vs)));
    }

    // add any filters
    if (!_.isEmpty(this._filter)) {
      // add filter.bool.must, creating intermediate objects if they don't exist
      //  using _.set does away with the need to check for object existence
      // _.compact removes falsey values from arrays
      _.set(
        base.query.function_score.query.bool,
        'filter.bool.must',
        _.compact(this._filter.map(view => view(vs))));

    }

    return base;
  }

}

module.exports = AddressesUsingIdsQuery;
