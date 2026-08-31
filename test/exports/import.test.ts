import assert from 'assert';
import docs from 'tsds-typedoc';

describe('exports .ts', () => {
  it('defaults', () => {
    assert.equal(typeof docs, 'function');
  });
});
