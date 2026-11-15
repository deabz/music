const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPanelInteractionHandler } = require('../src/panel-interactions');
const { createLyricsController } = require('../src/lyrics-controller');
const { buildPlayerPanel } = require('../src/player-panel');
test('panel lyrics is read-only, private while playing, and opens a private-result modal when idle', async () => {
  const state = { current: { title: 'Synthetic track' }, queue: [], panelMessageId: 'panel', connection: { joinConfig: { channelId: 'voice' } } };
  const calls = [], queries = [];
  const lyrics = createLyricsController({ service: { lookup: async query => { queries.push(query); return { found: true, title: 'Track', artist: 'Artist', text: 'Synthetic test line' }; } } });
  const handler = createPanelInteractionHandler({ getMusic: () => state, lyrics });
  const interaction = { customId: 'panel:lyrics', guild: { id: 'guild' }, message: { id: 'panel' }, user: { id: 'user' }, member: { voice: {} },
    isButton: () => true, deferReply: async payload => calls.push(['defer', payload]), editReply: async payload => calls.push(['edit', payload]),
    reply: async payload => calls.push(['reply', payload]), showModal: async modal => calls.push(['modal', modal.toJSON()]) };
  assert.equal(await handler(interaction), true); assert.equal(queries[0], state.current); assert.equal(calls[0][1].ephemeral, true);
  state.current = null; calls.length = 0;
  await handler(interaction); assert.deepEqual(calls.map(call => call[0]), ['modal']); assert.equal(calls[0][1].custom_id, 'lyrics:modal:panel');
  const button = buildPlayerPanel(state).components.flatMap(row => row.components).find(item => item.custom_id === 'panel:lyrics');
  assert.equal(button.disabled, false);
  interaction.customId = 'lyrics:modal:panel'; interaction.isModalSubmit = () => true;
  interaction.user.id = 'another-user'; interaction.fields = { getTextInputValue: () => 'Artist - Track' };
  calls.length = 0; await lyrics.handleModal(interaction);
  assert.equal(calls[0][1].ephemeral, true); assert.equal(queries[1], 'Artist - Track');
});
