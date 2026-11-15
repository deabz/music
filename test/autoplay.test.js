const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isSongResult, resolveSuggestedTrack, suggestionScore } = require("../src/music-utils");
const song = (title, channel = "HZINO", url = title) => ({ title, channel: { name: channel }, url, durationInSec: 180 });
test("autoplay rejects kids and non-song terms in titles and channels", () => {
  for (const term of ["Danny Go!", "Dance Songs for Kids", "Nursery Rhymes", "Children", "compilation", "mix", "playlist", "1 hour", "reaction", "live concert", "full album", "karaoke", "podcast"]) {
    assert.equal(isSongResult(song("HZINO - " + term)), false, term);
    assert.equal(isSongResult(song("HZINO - Song", term)), false, term + " channel");
  }
  assert.equal(isSongResult(song("HZINO - New Song")), true);
  assert.equal(isSongResult({ ...song("Valid"), isLive: true }), false);
  assert.equal(isSongResult({ ...song("Valid"), durationInSec: 361 }), false);
});
test("suggestions prefer same artist over uploader and reject unrelated songs and tried URLs", async () => {
  const current = { title: "HZINO - JAYDA WAYDA", author: "GRM Daily", url: "current" };
  const candidates = [song("Danny Go! Dance Songs for Kids", "Danny Go!"),
    song("Unrelated Song", "Unrelated Artist"), song("Another Artist - Song", "GRM Daily"),
    song("HZINO - Strong Choice", "HZINO - Topic"), song("HZINO - JAYDA WAYDA (Lyrics)", "GRM Daily")];
  const queries = [];
  const search = async query => { queries.push(query); return candidates; };
  const chosen = await resolveSuggestedTrack(current, new Set(), search, () => null);
  assert.equal(chosen.title, "HZINO - Strong Choice");
  assert.ok(queries.every(query => query.startsWith("HZINO")));
  const alternative = await resolveSuggestedTrack(current, new Set([chosen.url]), search, () => null);
  assert.equal(alternative.title, "Another Artist - Song");
  assert.equal(suggestionScore(song("Unrelated", "Other"), "HZINO", "GRM Daily"), 0);
});
test("autoplay stops if only unrelated, repeated, live, overlong or junk results remain", async () => {
  const current = { title: "HZINO - Current", author: "HZINO", url: "current" };
  const candidates = [song("Other artist - Other song", "Other artist"), song("HZINO - Current (Lyrics)"),
    song("HZINO - Kids Mix"), { ...song("HZINO - Long"), durationInSec: 1000 },
    { ...song("HZINO - Live"), isLive: true }, song("HZINO - Previously tried", "HZINO", "tried")];
  const result = await resolveSuggestedTrack(current, new Set(["tried"]), async () => candidates, () => null);
  assert.equal(result, null);
});
test("artist inference recognizes Unicode dash separators", async () => {
  const queries = [];
  const result = await resolveSuggestedTrack({ title: "HZINO \u2014 Current", author: "GRM Daily", url: "current" },
    new Set(), async query => { queries.push(query); return [song("HZINO - Another", "HZINO - Topic")]; }, () => null);
  assert.deepEqual(queries, ["HZINO official audio", "HZINO songs"]);
  assert.equal(result?.title, "HZINO - Another");
});
