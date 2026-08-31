const assert = require('assert');
const docs = require('tsds-typedoc');

describe('exports .cjs', () => {
  it('defaults', () => {
    assert.equal(typeof docs, 'function');
  });
});
