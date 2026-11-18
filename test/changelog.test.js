const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { isNoise, classify, buildEntries, mergeEntries } = require("../scripts/generate-changelog.cjs");

test("commit prefixes map to changelog categories; unprefixed commits are Changed", () => {
  assert.deepEqual(classify("add: karaoke effect"), { type: "Added", text: "Karaoke effect" });
  assert.deepEqual(classify("improve: faster search"), { type: "Improved", text: "Faster search" });
  assert.deepEqual(classify("fix(audio): bass boost clipping"), { type: "Fixed", text: "Bass boost clipping" });
  assert.deepEqual(classify("Remove: old panel"), { type: "Removed", text: "Old panel" });
  assert.deepEqual(classify("change: default volume"), { type: "Changed", text: "Default volume" });
  assert.deepEqual(classify("Tidy up startup logs"), { type: "Changed", text: "Tidy up startup logs" });
  assert.deepEqual(classify("note: something: else"), { type: "Changed", text: "Note: something: else" });
});

test("merges, readme updates and the bot's own changelog commits are skipped", () => {
  for (const subject of ["Merge branch 'main'", "Merge pull request #4 from x/y", "update readme", "Update README.md",
    "docs: update readme", "chore: update changelog [skip ci]", "chore: update changelog", "anything [skip ci]", ""]) assert.equal(isNoise(subject), true, subject);
  for (const subject of ["fix: readme link in help", "add: merge queue", "Update dependencies"]) assert.equal(isNoise(subject), false, subject);
});

test("entries group by day newest first with short hash links, and keep hand-written entries", () => {
  const commits = [
    { hash: "c".repeat(40), date: "2026-11-18T12:00:00Z", subject: "add: new effects" },
    { hash: "b".repeat(40), date: "2026-11-18T10:00:00Z", subject: "Merge branch 'x'" },
    { hash: "a".repeat(40), date: "2026-11-17T09:00:00Z", subject: "fix: notifications" }
  ];
  const entries = buildEntries(commits, "https://github.com/owner/repo");
  assert.deepEqual(entries.map(entry => entry.id), ["auto-2026-11-18", "auto-2026-11-17"]);
  assert.equal(entries[0].title, "1 addition");
  assert.deepEqual(entries[0].changes[0], { type: "Added", text: "New effects", hash: "ccccccc", date: "2026-11-18T12:00:00.000Z",
    url: `https://github.com/owner/repo/commit/${"c".repeat(40)}` });
  const merged = mergeEntries([{ id: "manual", date: "2026-11-12T00:00:00Z", title: "Old", changes: [] },
    { id: "auto-2020-01-01", auto: true, date: "2020-01-01T00:00:00Z", changes: [] }], entries);
  assert.deepEqual(merged.map(entry => entry.id), ["auto-2026-11-18", "auto-2026-11-17", "manual"]);
});

test("the committed changelog.json is valid and uses known categories", () => {
  const entries = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "changelog.json"), "utf8"));
  assert.ok(Array.isArray(entries) && entries.length >= 2);
  for (const entry of entries) {
    assert.ok(entry.id && entry.title && !Number.isNaN(Date.parse(entry.date)));
    for (const change of entry.changes) assert.ok(["Added", "Improved", "Fixed", "Removed", "Changed"].includes(change.type), change.type);
  }
});
