const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createLyricsController, splitLyrics, escapeLyrics, lyricsPayload } = require('../src/lyrics-controller');
function fixture(extra = {}) {
  const calls = [], lookedUp = [], collector = new EventEmitter(); let collectorOptions;
  const interaction = { guild: { id: 'guild' }, user: { id: 'user' },
    reply: async payload => calls.push(['reply', payload]),
    showModal: async modal => calls.push(['modal', modal.toJSON()]),
    deferReply: async payload => { interaction.deferred = true; calls.push(['defer', payload]); },
    editReply: async payload => { calls.push(['edit', payload]); return { createMessageComponentCollector: options => { collectorOptions = options; return collector; } }; },
    followUp: async payload => calls.push(['followUp', payload]), ...extra };
  let clock = 0;
  const controller = createLyricsController({ now: () => clock, service: { lookup: async query => { lookedUp.push(query); return { found: true, title: 'Test', artist: 'Artist', text: 'Synthetic test line', ...extra.result }; } } });
  return { calls, lookedUp, interaction, controller, collector, get collectorOptions() { return collectorOptions; }, advance: () => { clock += 5001; } };
}
test('current track is auto detected, typed song overrides it, and idle opens modal before defer', async () => {
  const f = fixture(), track = { title: 'Current' };
  await f.controller.open(f.interaction, { track }); assert.equal(f.lookedUp[0], track);
  f.advance(); await f.controller.open(f.interaction, { track, song: 'Typed song' }); assert.equal(f.lookedUp[1], 'Typed song');
  const idle = fixture(); await idle.controller.open(idle.interaction);
  assert.deepEqual(idle.calls.map(call => call[0]), ['modal']);
});
test('modal submits use trimmed query, shared cooldown, guild check and reject whitespace', async () => {
  const f = fixture({ customId: 'lyrics:modal', isModalSubmit: () => true, fields: { getTextInputValue: () => '  Artist - Song  ' } });
  assert.equal(await f.controller.handleModal(f.interaction), true); assert.equal(f.lookedUp[0], 'Artist - Song');
  await f.controller.handleModal(f.interaction); assert.match(f.calls.at(-1)[1].content, /wait 5/);
  const empty = fixture({ customId: 'lyrics:modal', isModalSubmit: () => true, fields: { getTextInputValue: () => '   ' } });
  await empty.controller.handleModal(empty.interaction); assert.equal(empty.calls[0][0], 'reply'); assert.equal(empty.lookedUp.length, 0);
  const dm = fixture({ guild: null }); await dm.controller.open(dm.interaction, { song: 'Test' }); assert.equal(dm.lookedUp.length, 0);
});
test('not found offers Genius, instrumental explains, and all output disallows mentions', async () => {
  const missing = fixture({ result: { found: false } }); await missing.controller.open(missing.interaction, { song: 'Test' });
  assert.match(missing.calls.at(-1)[1].content, /Couldn't find lyrics.*Search Genius/);
  assert.deepEqual(missing.calls.at(-1)[1].allowedMentions.parse, []);
  const instrumental = fixture({ result: { instrumental: true } }); await instrumental.controller.open(instrumental.interaction, { song: 'Test' });
  assert.match(instrumental.calls.at(-1)[1].embeds[0].description, /instrumental/);
});
test('page splitting preserves lines, caps pages and escapes markdown and mentions', () => {
  const line = 'test line '.repeat(100), pages = splitLyrics(Array(60).fill(line).join('\n'));
  assert.equal(pages.length, 10); assert.match(pages.at(-1), /truncated/);
  assert.ok(pages.every(page => page.length < 4096));
  assert.ok(pages[0].split('\n').every(value => value === line));
  assert.equal(escapeLyrics('*** @everyone <@&123>'), '\\*\\*\\* @\u200beveryone \\<@\u200b&123\\>');
  const payload = lyricsPayload({ title: 'Title', artist: 'Artist' }, ['one', 'two']);
  assert.equal(payload.embeds[0].footer.text, 'Page 1/2 - Lyrics from LRCLIB');
});
test('pagination is invoker-only, lasts ten minutes, navigates and removes controls', async () => {
  const f = fixture({ result: { text: `${'a'.repeat(3000)}\n${'b'.repeat(3000)}` } });
  await f.controller.open(f.interaction, { song: 'Test' }); assert.equal(f.collectorOptions.time, 600000);
  let refused = false, acknowledged = false, edited;
  f.collector.emit('collect', { user: { id: 'other' }, reply: async () => { refused = true; } });
  f.collector.emit('collect', { user: { id: 'user' }, customId: 'lyrics:next', deferUpdate: async () => { acknowledged = true; }, editReply: async payload => { edited = payload; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(refused && acknowledged); assert.equal(edited.embeds[0].footer.text, 'Page 2/2 - Lyrics from LRCLIB');
  f.collector.emit('end'); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls.at(-1)[1].components, []);
});
module.exports = { fixture };
