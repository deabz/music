const { test } = require("node:test");
const assert = require("node:assert/strict");
const { songKey, hasVersion, SongMemory, blockedSongKeys, RECENT_SONG_MEMORY_SIZE } = require("../src/song-identity");
test("FRANCHISE uploads, feature credits, Unicode and metadata suffixes share one identity", () => {
  const titles = ["Travis Scott feat. Future, Young Thug & M.I.A. - FRANCHISE (Official Music Video)",
    "Travis Scott - FRANCHISE (Audio)", "Travis Scott - FRANCHISE [Lyric Video]", "Travis Scott - FRANCHISE (Lyrics)",
    "Travis Scott featuring Young Thug - FRANCHISE [HD]", "Travis Scott - FRANCHISE (Explicit)"];
  assert.equal(new Set(titles.map(title => songKey({ title, author: "Lyrics Channel" }))).size, 1);
  assert.equal(songKey({ title: "Beyonc\u00e9 - A & B [4K]" }), songKey({ title: "Beyonce - A and B (Clean)" }));
  assert.equal(songKey({ title: "Song (Audio)", author: "Artist - Topic" }), songKey({ title: "Artist - Song" }));
});
test("different versions keep different song keys and are flagged for autoplay rejection", () => {
  const base = songKey({ title: "Artist - Song" });
  for (const version of ["Remix", "Live", "Acoustic", "Sped Up", "Slowed", "Cover", "Instrumental"]) {
    const title = `Artist - Song (${version})`;
    assert.notEqual(songKey({ title }), base); assert.equal(hasVersion(title), true);
  }
});
test("memory records user/autoplay starts once per instance, caps 50 and includes queue in exclusion", () => {
  const memory = new SongMemory();
  const first = { title: "Artist - First", url: "first", panelInstanceId: "first" };
  memory.recordStart(first); memory.recordStart({ ...first }); assert.equal(memory.entries.length, 1);
  for (let index = 0; index < 60; index++) memory.recordStart({ title: `Artist - Song ${index}`, url: String(index), panelInstanceId: String(index) });
  assert.equal(memory.entries.length, RECENT_SONG_MEMORY_SIZE); assert.equal(memory.urls().has("0"), false);
  const queued = { title: "Other - Waiting" };
  const state = { autoplayMemory: memory, current: first, queue: [queued] };
  const blocked = blockedSongKeys(state); assert.ok(blocked.has(songKey(first))); assert.ok(blocked.has(songKey(queued)));
  assert.equal(new SongMemory().entries.length, 0);
});
