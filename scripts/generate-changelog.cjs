#!/usr/bin/env node
// Regenerates web/changelog.json from git history. Run by
// .github/workflows/changelog.yml on every push to main; safe to run locally.
//
// Commit prefixes decide the category:
//   add: -> Added   improve: -> Improved   fix: -> Fixed
//   remove: -> Removed   change: -> Changed   (anything else -> Changed)
// Merges, "update readme" and the bot's own [skip ci] commits are skipped.
// Hand-written entries (without "auto": true) are kept as they are.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// History before this commit predates the prefix convention and is not listed.
const BASELINE_COMMIT = "a5b2b3f";
const BASELINE_DATE = "2026-11-17T00:00:00Z";
const OUTPUT = path.join(__dirname, "..", "web", "changelog.json");

const CATEGORIES = [
  ["Added", /^(?:add|added|adds|feat|feature)$/],
  ["Improved", /^(?:improve|improved|improves|perf)$/],
  ["Fixed", /^(?:fix|fixed|fixes)$/],
  ["Removed", /^(?:remove|removed|removes)$/],
  ["Changed", /^(?:change|changed|changes)$/]
];
const PLURAL = { Added: ["addition", "additions"], Improved: ["improvement", "improvements"], Fixed: ["fix", "fixes"],
  Removed: ["removal", "removals"], Changed: ["change", "changes"] };
const ORDER = ["Added", "Improved", "Fixed", "Removed", "Changed"];

function isNoise(subject) {
  const text = subject.trim();
  return !text
    || /\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]/i.test(text)
    || /^merge\b/i.test(text)
    || /^chore(?:\(changelog\))?: update changelog\b/i.test(text)
    || /^(?:\w+(?:\([^)]*\))?:\s*)?update(?:d)? readme(?:\.md)?\.?$/i.test(text);
}

function classify(subject) {
  const match = /^\s*([a-z]+)(?:\([^)]*\))?!?:\s*(.+)$/i.exec(subject);
  const category = match && CATEGORIES.find(([, pattern]) => pattern.test(match[1].toLowerCase()));
  const text = (category ? match[2] : subject).trim();
  return { type: category ? category[0] : "Changed", text: text.charAt(0).toUpperCase() + text.slice(1) };
}

function titleFor(changes) {
  const counts = ORDER.map(type => [type, changes.filter(change => change.type === type).length]).filter(([, count]) => count);
  return counts.map(([type, count]) => `${count} ${PLURAL[type][count === 1 ? 0 : 1]}`).join(", ").replace(/^./, c => c.toUpperCase());
}

// commits: [{ hash, date, subject }] newest first. Returns one entry per UTC day.
function buildEntries(commits, repoUrl) {
  const days = new Map();
  for (const commit of commits) {
    if (isNoise(commit.subject)) continue;
    const day = new Date(commit.date).toISOString().slice(0, 10);
    if (!days.has(day)) days.set(day, []);
    const short = commit.hash.slice(0, 7);
    days.get(day).push({ ...classify(commit.subject), hash: short, date: new Date(commit.date).toISOString(),
      ...(repoUrl ? { url: `${repoUrl}/commit/${commit.hash}` } : {}) });
  }
  return [...days].map(([day, changes]) => {
    changes.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    return { id: `auto-${day}`, auto: true, date: changes[0].date, title: titleFor(changes), changes };
  });
}

function mergeEntries(existing, generated) {
  const manual = (Array.isArray(existing) ? existing : []).filter(entry => entry && !entry.auto);
  return [...generated, ...manual].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}
function repositoryUrl() {
  if (process.env.GITHUB_REPOSITORY) return `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${process.env.GITHUB_REPOSITORY}`;
  try {
    const remote = git(["remote", "get-url", "origin"]).trim();
    const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote);
    return match ? `https://github.com/${match[1]}` : null;
  } catch { return null; }
}
function readCommits() {
  let range = ["HEAD"];
  try { git(["merge-base", "--is-ancestor", BASELINE_COMMIT, "HEAD"]); range = [`${BASELINE_COMMIT}..HEAD`]; }
  catch { range = ["HEAD", `--since=${BASELINE_DATE}`]; } // Shallow clone or rewritten history.
  const separator = "\u001f";
  return git(["log", "--no-merges", `--format=%H${separator}%cI${separator}%s`, ...range]).split("\n").filter(Boolean)
    .map(line => { const [hash, date, subject] = line.split(separator); return { hash, date, subject }; });
}

function main() {
  const existing = fs.existsSync(OUTPUT) ? JSON.parse(fs.readFileSync(OUTPUT, "utf8")) : [];
  const entries = mergeEntries(existing, buildEntries(readCommits(), repositoryUrl()));
  const json = "[\n" + entries.map(entry => "  " + JSON.stringify(entry)).join(",\n") + "\n]\n";
  const previous = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, "utf8") : "";
  if (json === previous) { console.log("changelog.json is already up to date."); return; }
  fs.writeFileSync(OUTPUT, json);
  console.log(`Wrote ${entries.length} changelog entries to web/changelog.json.`);
}

if (require.main === module) main();
module.exports = { isNoise, classify, buildEntries, mergeEntries, titleFor };
