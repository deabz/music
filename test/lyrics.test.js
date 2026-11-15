const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLyricsService, prepareLyricsInput, bestLyricsMatch, lyricsText } = require('../src/lyrics');
const record = (extra = {}) => ({ trackName: 'Burn', artistName: 'Ellie Goulding', duration: 231, plainLyrics: 'Synthetic test line', ...extra });
const response = (data, status = 200) => ({ ok: status === 200, status, json: async () => data });
test('YouTube metadata is cleaned and main artists inferred', () => {
  for (const [title, artist, song] of [
    ['Ellie Goulding - Burn (Official Video)', 'Ellie Goulding', 'Burn'],
    ['Dream ft. PmBata - Roadtrip (Official Lyric Video)', 'Dream', 'Roadtrip'],
    ['HZINO - JAYDA WAYDA ( OFFICIAL AUDIO)', 'HZINO', 'JAYDA WAYDA'],
    ['23 - Torn [Music Video] | GRM Daily', '23', 'Torn']
  ]) {
    const input = prepareLyricsInput({ title, author: 'GRM Daily', duration: 231 });
    assert.equal(input.artist, artist); assert.equal(input.title, song);
  }
  assert.equal(prepareLyricsInput({ title: 'Burn', author: 'Ellie GouldingVEVO' }).artist, 'Ellie Goulding');
});
test('exact lookup includes metadata and caches successful results', async () => {
  const calls = [];
  const service = createLyricsService({ request: async (url, options) => { calls.push(url); assert.match(options.headers['User-Agent'], /LunaBot/); return response(record()); } });
  const track = { title: 'Ellie Goulding - Burn', duration: 231 };
  assert.equal((await service.lookup(track)).text, 'Synthetic test line');
  assert.equal((await service.lookup(track)).found, true);
  assert.equal(calls.length, 1); assert.equal(new URL(calls[0]).searchParams.get('duration'), '231');
});
test('404 searches, duration ranks matches, and clearly wrong songs are rejected', async () => {
  const calls = [];
  const service = createLyricsService({ request: async url => { calls.push(url); return url.includes('/api/get?') ? response(null, 404) : response([record({ duration: 250 }), record({ duration: 232 })]); } });
  assert.equal((await service.lookup({ title: 'Ellie Goulding - Burn', duration: 231 })).found, true);
  assert.equal(calls.length, 2);
  const input = prepareLyricsInput({ title: 'Ellie Goulding - Burn', duration: 231 });
  assert.equal(bestLyricsMatch([record({ duration: 250 }), record({ duration: 232 })], input).duration, 232);
  assert.equal(bestLyricsMatch([record({ trackName: 'Different Song' }), record({ artistName: 'Someone Else' })], input), null);
});
test('free text searches directly; synced lyrics and instrumental are supported', async () => {
  let url;
  const service = createLyricsService({ request: async value => { url = value; return response([record({ plainLyrics: null, syncedLyrics: '[00:01.20]Synthetic first\n[00:02.00]Synthetic second' })]); } });
  assert.equal((await service.lookup('Ellie Goulding Burn lyrics')).text, 'Synthetic first\nSynthetic second');
  assert.match(url, /api\/search/);
  assert.equal(lyricsText(record({ plainLyrics: null, syncedLyrics: '[00:01.00]Line' })), 'Line');
  const instrumental = createLyricsService({ request: async () => response(record({ instrumental: true, plainLyrics: null })) });
  assert.equal((await instrumental.lookup('Ellie Goulding - Burn')).instrumental, true);
});
test('negative cache expires; network failures and timeouts are not cached', async () => {
  let clock = 0, calls = 0;
  const negative = createLyricsService({ now: () => clock, request: async () => { calls++; return response([]); } });
  await negative.lookup('absent song'); await negative.lookup('absent song'); assert.equal(calls, 1);
  clock = 600001; await negative.lookup('absent song'); assert.equal(calls, 2);
  const unavailable = createLyricsService({ request: async () => { calls++; throw new Error('network'); } });
  await unavailable.lookup('absent song'); await unavailable.lookup('absent song'); assert.equal(calls, 4);
  let signal;
  const timeout = createLyricsService({ timeoutMs: 5, request: async (_, options) => { signal = options.signal; return new Promise(() => {}); } });
  assert.equal((await timeout.lookup('absent song')).found, false); assert.equal(signal.aborted, true);
});
