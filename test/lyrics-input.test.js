const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildLyricsModal, parseSongQuery, cleanSongText } = require("../src/lyrics-input");

test("lyrics modal has exactly one required short Song input with the requested limits", () => {
  const modal = buildLyricsModal().toJSON();
  assert.equal(modal.custom_id, "lyrics:modal"); assert.equal(modal.title, "Find lyrics");
  assert.equal(modal.components.length, 1); assert.equal(modal.components[0].components.length, 1);
  const input = modal.components[0].components[0];
  assert.equal(input.style, 1); assert.equal(input.label, "Song");
  assert.equal(input.placeholder, "Artist - Song title");
  assert.equal(input.required, true); assert.equal(input.min_length, 2); assert.equal(input.max_length, 100);
  assert.equal(buildLyricsModal({ panel: true }).toJSON().custom_id, "lyrics:modal:panel");
});

test("typed queries distinguish Artist - Title from cleaned free text", () => {
  assert.deepEqual(parseSongQuery("  Artist - My Song (Official Video) [Lyrics]  "),
    { artist: "Artist", title: "My Song", query: "Artist My Song", mode: "artist-title" });
  assert.deepEqual(parseSongQuery("  my favourite song lyrics  "),
    { artist: "", title: "", query: "my favourite song", mode: "search" });
  assert.equal(parseSongQuery(" \t\n ").query, "");
  assert.equal(cleanSongText("Artist - Topic"), "Artist");
});
