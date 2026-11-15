const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildPlayerPanel, formatTrackTitle, TRACK_TITLE_MAX_LENGTH, buildPlayConfirmation, buildFavouritesMenu } = require("../src/player-panel");
const { buildQueueEmbed, buildQueueComponents, queuePageCount } = require("../src/commands");
const { lyricsPayload } = require("../src/lyrics-controller");
const full = "Travis Scott feat. Future, Young Thug & M.I.A. - FRANCHISE (Official Music Video)";
const track = title => ({ title, url: "https://youtube.com/watch?v=abc", author: "Artist", duration: 180 });
const totalSize = embed => (embed.title || "").length + (embed.description || "").length + (embed.footer?.text || "").length
  + (embed.author?.name || "").length + (embed.fields || []).reduce((sum, field) => sum + field.name.length + field.value.length, 0);

test("full current and waiting titles wrap without the old 40/50 limits", () => {
  const panel = buildPlayerPanel({ current: track(full), queue: [track(full)], volume: 0 });
  const text = panel.embeds[0].description;
  assert.ok(text.includes(`[${full}](https://youtube.com/watch?v=abc) - [\`03:00\`],`));
  assert.ok(text.includes(`\`1.\` **${full}**`)); assert.ok(!text.includes("\u2026"));
  assert.equal(panel.embeds[0].footer.text, "Volume: 0"); assert.deepEqual(panel.allowedMentions.parse, []);
});

test("one exported safety cap preserves Unicode, escape tokens, mentions and complete links", () => {
  assert.equal(TRACK_TITLE_MAX_LENGTH, 200);
  const title = "[".repeat(99) + "\uD83C\uDFB5".repeat(100);
  const text = formatTrackTitle(title);
  assert.equal(text.isWellFormed(), true); assert.ok(text.endsWith("\u2026"));
  assert.equal(text, formatTrackTitle(title.slice(0, 1000)));
  for (let budget = 1; budget <= 20; budget++) {
    const limited = formatTrackTitle("[\\\uD83C\uDFB5]".repeat(100), budget);
    assert.ok(limited.length <= budget); assert.equal(limited.isWellFormed(), true);
    const tail = limited.replace(/\u2026$/, "").match(/\\+$/)?.[0] || "";
    assert.equal(tail.length % 2, 0);
  }
  const embed = buildPlayerPanel({ current: track(title), queue: [] }).embeds[0];
  assert.ok(embed.description.startsWith(`[${text}](https://youtube.com/watch?v=abc)`));
  const safe = formatTrackTitle("Closer (Video) [x] @everyone @here <@&12345678901234567>");
  assert.ok(safe.includes("(Video) \\[x\\]")); assert.ok(!safe.includes("\\("));
  assert.ok(!safe.includes("@everyone")); assert.ok(!safe.includes("@here")); assert.ok(!safe.includes("<@&"));
});

test("panel budget omits whole waiting rows and reserves the exact remaining-count line", () => {
  const title = "[".repeat(TRACK_TITLE_MAX_LENGTH);
  const embed = buildPlayerPanel({ current: track(title), queue: Array.from({ length: 25 }, () => track(title)) }).embeds[0];
  const shown = [...embed.description.matchAll(/`\d+\.`/g)].length;
  assert.ok(shown > 0 && shown < 10);
  assert.ok(embed.description.endsWith(`...and ${25 - shown} more`));
  assert.equal((embed.description.match(/\u2026/g) || []).length, 0);
  assert.ok(embed.description.length <= 4096); assert.ok(totalSize(embed) <= 6000);
});

test("ten long waiting titles and a maximally encoded current link stay valid", () => {
  for (const title of ["A".repeat(200), "*".repeat(200), "\uD83C\uDFB5".repeat(200)]) {
    const current = { ...track(title), url: "https://example.com/" + "(".repeat(570) };
    const embed = buildPlayerPanel({ current, queue: Array.from({ length: 10 }, () => track(title)) }).embeds[0];
    assert.ok(embed.description.length <= 4096); assert.ok(totalSize(embed) <= 6000);
    assert.ok(embed.description.includes("%28")); assert.ok(embed.description.includes(") - [`03:00`],"));
  }
});

test("queue pagination budgets complete rows, keeps full titles and reaches every waiting track", () => {
  const queue = Array.from({ length: 27 }, (_, index) => ({ ...track("[".repeat(198) + index), author: "*".repeat(120) }));
  const pages = queuePageCount(queue); assert.ok(pages > 3);
  const positions = [];
  for (let page = 0; page < pages; page++) {
    const embed = buildQueueEmbed({ current: track(full), queue, page, playbackStatus: "playing" }).toJSON();
    assert.ok(embed.fields[0].value.includes(full)); assert.ok(embed.description.length <= 4096);
    assert.ok(totalSize(embed) <= 6000);
    for (const field of embed.fields) assert.ok(field.value.length <= 1024);
    positions.push(...[...embed.description.matchAll(/\*\*#(\d+)\*\*/g)].map(match => Number(match[1])));
    const buttons = buildQueueComponents({ queue, page })[0].toJSON().components;
    assert.equal(buttons[0].disabled, page === 0); assert.equal(buttons[1].disabled, page === pages - 1);
  }
  assert.deepEqual(positions, Array.from({ length: 27 }, (_, index) => index + 1));
});

test("confirmations and lyrics preserve full capped titles, while select options stay within 100", () => {
  assert.equal(buildPlayConfirmation([track(full)]).content, `**${full}** added to the queue`);
  const title = "[".repeat(200);
  const payload = lyricsPayload({ title, artist: "A".repeat(200) }, ["Lyrics body"]);
  const embed = payload.embeds[0];
  assert.ok(embed.title.length <= 256); assert.equal(embed.fields.find(field => field.name === "Song").value, formatTrackTitle(title));
  assert.ok(totalSize(embed) <= 6000);
  const ordinary = lyricsPayload({ title: full, artist: "Artist" }, ["Lyrics body"]).embeds[0];
  assert.ok(ordinary.title.includes(full));
  const item = { ...track("\uD83C\uDFB5".repeat(100)), id: "song", author: "Artist" };
  const favourite = buildFavouritesMenu([item], "user")[0].components[0].options[0];
  const suggestion = buildPlayerPanel({ current: item, queue: [], panelSuggestions: [item] }).components[0].components[0].options[0];
  for (const option of [favourite, suggestion]) {
    assert.ok(option.label.length <= 100); assert.ok(option.label.endsWith("\u2026")); assert.equal(option.label.isWellFormed(), true);
    assert.ok(option.description.length <= 100);
  }
});
