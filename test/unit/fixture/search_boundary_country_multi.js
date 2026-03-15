module.exports = {
  'query': {
    'function_score': {
      'query': {
        'bool': {
          'minimum_should_match': 1,
          'should': [
            {
              'bool': {
                '_name': 'fallback.street',
                'must': [
                  {
                    'bool': {
                      'should': [
                        {
                          'match_phrase': {
                            'address_parts.street': {
                              'query': 'street value',
                              'boost': 5,
                              'slop': 4,
                              'analyzer': 'peliasQuery'
                            }
                          }
                        },
                        {
                          'match': {
                            'address_parts.street': {
                              'query': 'street value',
                              'boost': 3,
                              'operator': 'and',
                              'analyzer': 'peliasStreet'
                            }
                          }
                        },
                        {
                          'match': {
                            'address_parts.street': {
                              'query': 'street value',
                              'boost': 1,
                              'operator': 'and',
                              'analyzer': 'peliasQuery',
                              'fuzziness': 1
                            }
                          }
                        }
                      ],
                      'minimum_should_match': 1
                    }
                  }
                ],
                'should': [],
                'filter': {
                  'term': {
                    'layer': 'street'
                  }
                },
                'boost': 5
              }
            }
          ],
          'filter': {
            'bool': {
              'must': [
                {
                  'multi_match': {
                    'type': 'best_fields',
                    'query': 'ABC DEF',
                    'fields': [
                      'parent.country_a',
                      'parent.dependency_a'
                    ],
                    'analyzer': 'standard'
                  }
                },
                {
                  'terms': {
                    'layer': [
                      'test'
                    ]
                  }
                }
              ]
            }
          }
        }
      },
      'max_boost': 20,
      'functions': [
        {
          'field_value_factor': {
            'modifier': 'log1p',
            'field': 'popularity',
            'missing': 1
          },
          'weight': 1
        },
        {
          'field_value_factor': {
            'modifier': 'log1p',
            'field': 'population',
            'missing': 1
          },
          'weight': 2
        }
      ],
      'score_mode': 'avg',
      'boost_mode': 'multiply'
    }
  },
  'sort': [
    '_score'
  ],
  'size': 10,
  'track_scores': true
};
