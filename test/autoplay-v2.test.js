const { test } = require("node:test");
const assert = require("node:assert/strict");
const { AutoplayCandidates, rankAutoplayCandidates, AUTOPLAY_SCORE_WEIGHTS, buildThemeQueries, MIX_CACHE_TTL_MS } = require("../src/autoplay-candidates");
const { SongMemory, songKey } = require("../src/song-identity");
const { chooseAutoplayCandidate, limitSuggestionArtists, AUTOPLAY_MAX_CONSECUTIVE_ARTIST, SUGGESTIONS_MAX_PER_ARTIST } = require("../src/autoplay-candidates");
const song = (artist, title, id = title) => ({ title: `${artist} - ${title}`, author: artist, url: `https://example.com/${id}`, duration: 180 });
const seed = { ...song("Seed", "Original"), url: "https://youtube.com/watch?v=dQw4w9WgXcQ" };
test("ranker rejects alternate uploads of FRANCHISE, queue/recent repeats, junk, versions and duration bounds", () => {
  const current = song("Travis Scott feat. Future, Young Thug & M.I.A.", "FRANCHISE (Official Music Video)");
  const old = song("Other", "Played"), waiting = song("Next", "Waiting");
  const memory = new SongMemory(); memory.recordStart(old);
  const candidates = [song("Travis Scott", "FRANCHISE (Audio)"), { ...old, url: "other-upload" }, waiting,
    song("Other", "Nursery Rhymes"), song("Other", "New Song (Remix)"), { ...song("Other", "Short"), duration: 59 },
    { ...song("Other", "Long"), duration: 361 }, song("Fresh", "Good")];
  assert.deepEqual(rankAutoplayCandidates(candidates, { current, queue: [waiting], autoplayMemory: memory }, current).map(track => track.title), ["Fresh - Good"]);
});
test("mix cache combines cached previous seeds and multi-seed membership improves ranking", async () => {
  const previous = { ...song("Previous", "Past"), url: "https://youtube.com/watch?v=9bZkp7q19f0" };
  const common = song("Shared", "Session Song"), unique = song("Single", "One Seed");
  const state = { current: seed, queue: [], history: [previous] }; let requests = 0, time = 0;
  const provider = new AutoplayCandidates(state, { now: () => time, mix: async () => { requests++; return [unique, common]; }, search: () => assert.fail("mix should be sufficient") });
  provider.cache.set("9bZkp7q19f0", { time: 0, items: [common] });
  const first = await provider.list(seed); assert.equal(first[0].title, common.title); assert.equal(first[0].mixSeeds.length, 2);
  await provider.list(seed); assert.equal(requests, 1);
  time = MIX_CACHE_TTL_MS + 1; await provider.list(seed); assert.equal(requests, 2); provider.dispose();
});
test("empty/failed mixes fall back to cleaned-title theme, hints and previous artists", async () => {
  for (const failed of [false, true]) {
    const queries = []; const track = { ...seed, genre: "hip hop", tags: ["trap"] };
    const state = { current: track, queue: [], history: [song("Previous", "Track")] };
    const provider = new AutoplayCandidates(state, { mix: async () => { if (failed) throw new Error("synthetic"); return []; },
      search: async query => { queries.push(query); return [song("Fresh", "Theme Song")]; }, log() {} });
    const items = await provider.list(track); assert.equal(items.length, 1);
    assert.ok(queries.some(query => query.includes("Original") && query.includes("similar")));
    assert.ok(queries.some(query => query.includes("hip hop") && query.includes("Previous"))); provider.dispose();
  }
  assert.ok(buildThemeQueries(seed)[0].startsWith("Original"));
});
test("scores are calculated from the exported weight object", () => {
  const entry = { ...song("Different", "New"), mixSeeds: ["one", "two"] };
  const result = rankAutoplayCandidates([entry], { current: seed, queue: [] }, seed)[0];
  assert.equal(result.suggestionScore, 2 * AUTOPLAY_SCORE_WEIGHTS.mixMembership + AUTOPLAY_SCORE_WEIGHTS.additionalSeed
    + AUTOPLAY_SCORE_WEIGHTS.similarDuration + AUTOPLAY_SCORE_WEIGHTS.sameScript);
});
test("two autoplay songs by one artist prefer another artist, with same-artist fallback only if necessary", () => {
  assert.equal(AUTOPLAY_MAX_CONSECUTIVE_ARTIST, 2);
  const current = { ...song("Artist", "Current"), autoSuggested: true };
  const state = { current, queue: [], history: [{ ...song("Artist", "Previous"), autoSuggested: true }] };
  const same = { ...song("Artist", "Third"), mixSeeds: ["a", "b", "c"] }, different = song("Other", "Alternative");
  assert.equal(chooseAutoplayCandidate([same, different], state, current).title, different.title);
  assert.equal(chooseAutoplayCandidate([same], state, current).title, same.title);
  current.autoSuggested = false;
  assert.equal(chooseAutoplayCandidate([same, different], state, current).title, same.title);
});
test("suggestion list caps each main artist at the exported limit and deduplicates song identity", () => {
  const items = [...Array.from({ length: 5 }, (_, index) => song("Artist", `Song ${index}`)), song("Other", "Other"), song("Artist", "Song 0 (Audio)")];
  const limited = limitSuggestionArtists(items);
  assert.equal(limited.filter(track => track.author === "Artist").length, SUGGESTIONS_MAX_PER_ARTIST);
  assert.equal(limited.length, 3);
});
