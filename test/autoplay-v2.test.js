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
    { title: "FRANCHISE (Lyrics)", author: "Lyrics Channel", url: "bare-lyrics-upload", duration: 180 },
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
test("cached historical mixes do not cause new historical requests; video ID variants cannot repeat", async () => {
  let requests = 0;
  const state = { current: seed, queue: [], history: [{ ...song("Past", "History"), url: "https://youtube.com/watch?v=9bZkp7q19f0" }] };
  const provider = new AutoplayCandidates(state, { mix: async () => { requests++; return [song("Fresh", "New")]; } });
  await provider.list(seed); assert.equal(requests, 1); provider.dispose();
  const retitled = { ...song("New Name", "Retitled"), url: "https://youtu.be/dQw4w9WgXcQ?t=30" };
  assert.equal(rankAutoplayCandidates([retitled], state, seed).length, 0);
});
test("duration median and detected title script contribute to session relevance", () => {
  const current = { ...seed, title: "Artist - \u041f\u0435\u0441\u043d\u044f", duration: 120 };
  const state = { current, queue: [], history: [{ ...song("Past", "Previous"), duration: 240 }] };
  const matching = { ...song("Other", "\u041d\u043e\u0432\u0430\u044f"), duration: 180 };
  const other = { ...song("Different", "English Title"), duration: 320 };
  const ranked = rankAutoplayCandidates([other, matching], state, current);
  assert.equal(ranked[0].title, matching.title);
  assert.equal(ranked[0].suggestionScore - ranked[1].suggestionScore, AUTOPLAY_SCORE_WEIGHTS.similarDuration + AUTOPLAY_SCORE_WEIGHTS.sameScript);
});
test("lookup queue serializes per server and cancellation prevents queued requests from starting", async () => {
  let requests = 0, active = 0, maxActive = 0;
  const state = { current: seed, queue: [] };
  const provider = new AutoplayCandidates(state, { mix: (id, signal) => {
    requests++; active++; maxActive = Math.max(maxActive, active);
    return new Promise((resolve, reject) => signal.addEventListener("abort", () => { active--; reject(Object.assign(new Error("cancelled"), { name: "AbortError" })); }, { once: true }));
  } });
  const first = provider.list(seed); const caught = first.catch(error => assert.equal(error.name, "AbortError"));
  const second = provider.list({ ...seed, url: "https://youtube.com/watch?v=9bZkp7q19f0" });
  await new Promise(setImmediate); assert.equal(requests, 1);
  provider.cancel(); await caught; assert.deepEqual(await second, []);
  assert.equal(maxActive, 1); assert.equal(active, 0); provider.dispose();
});
test("Mix extractor uses bounded flat watch radio requests and preserves required entry metadata", async () => {
  const { fetchMix } = require("../src/autoplay-candidates");
  const controller = new AbortController();
  const entries = await fetchMix("dQw4w9WgXcQ", controller.signal, async (url, options, execution) => {
    assert.equal(url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ");
    assert.equal(options.flatPlaylist, true); assert.equal(options.skipDownload, true); assert.equal(options.playlistEnd, 25);
    assert.equal(execution.signal, controller.signal); assert.equal(execution.timeout, 20000);
    return { entries: [{ id: "9bZkp7q19f0", title: "Artist - Song", channel: "Artist", duration: 180, url: "9bZkp7q19f0", live_status: null }] };
  });
  assert.equal(entries[0].url, "https://www.youtube.com/watch?v=9bZkp7q19f0"); assert.equal(entries[0].duration, 180); assert.equal(entries[0].isLive, false);
});
