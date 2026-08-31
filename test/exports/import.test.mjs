import assert from 'assert';
import docs from 'tsds-typedoc';

describe('exports .mjs', () => {
  it('defaults', () => {
    assert.equal(typeof docs, 'function');
  });
});
