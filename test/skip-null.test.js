const { test } = require('node:test');
const assert = require('node:assert/strict');

test('original prefetch expression reproduces the reported null job TypeError', () => {
  const state = { prefetch: null };
  const next = [].shift();
  // Optional chaining returns undefined, which also equals the empty queue result.
  assert.equal(state.prefetch?.track, next);
  assert.throws(() => !null && state.prefetch?.track === next ? state.prefetch.job : null,
    error => error instanceof TypeError && /reading 'job'/.test(error.message));
});
