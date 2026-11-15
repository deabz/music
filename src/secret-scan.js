const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");

// Reviewed local HTTP fixtures and historical template instructions. Exceptions
// apply only to the indicated generic rules in exact LF-normalized file contents.
// Structured token/key/cookie patterns are never exempted.
const REVIEWED_FIXTURES = [
  { path: "test/health-server.test.js", fingerprint: "9cf667dd91030847d96dd99f93ebe2a7dc708e32d3c906943422299025b282d1", lines: [69, 96, 144, 146] },
  { path: "test/health-server.test.js", fingerprint: "8d8eb9d7782a0b69c573717cdb2d988883fa49ce7fb9d1c6c020c69ebe8e4f99", lines: [69, 96, 142, 144] },
  { path: "test/health-server.test.js", fingerprint: "472d7229ab078e9dc8b0baf0b6b1a371c0152a4f568f30a3059c861f7e438eb3", lines: [68, 95] },
  { path: "test/health-server.test.js", fingerprint: "888b8c6dd3ec157ebf03bb3ac0acb1ff0e1b0557b1e2026926682a0417f3a9ff", lines: [56, 83] },
  { path: "music-bot/.env.example", fingerprint: "e873f9fcb73ac233e9bc186abed485ad983dffe428ce4ddf47c2caf494286868", lines: [1], type: "credential-assignment", classification: "reviewed-placeholder" },
  { path: ".env.node.example", fingerprint: "743e462f615e8a570ae24017bc335c00d5614290493f7d164d0163910787059d", lines: [1], type: "credential-assignment", classification: "reviewed-placeholder" }
];
const ASSIGNMENT_NAMES = "(?:DISCORD_TOKEN|MUSIC_DASHBOARD_TOKEN|SPOTIFY_CLIENT_SECRET|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY)";
const contentFingerprint = text => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
function isPlaceholder(value) {
  const text = value.trim();
  return !text || /^(?:YOUR_[A-Z_]+|<[^>\r\n]+>|\.{3}|undefined|null|true|false|\$\{[\w.]+\}|process\.env\.[A-Z_]+)$/i.test(text)
    || /^(?:paste|put|insert|enter|add|set)(?:_your)?_(?:discord_)?(?:bot_)?token(?:_here)?$/i.test(text)
    || /^(?:test|fixture|synthetic|example)[-_ ](?:token|key|secret|value|credential)(?:[-_ ](?:value|only|here))?$/i.test(text)
    || /^(?:replace|change)[-_ ](?:me|this)$/i.test(text)
    || /^(?:replace|change)_(?:me_with_|with_)?(?:(?:a|your|real|actual|valid|discord|bot)_)*token(?:_here)?$/i.test(text);
}
function scanText(text, { file, revision = "working-tree", reviewedFixtures = REVIEWED_FIXTURES } = {}) {
  const records = [], seen = new Set();
  const fingerprint = contentFingerprint(text);
  const add = (type, match, value, placeholderAllowed = false, runtime = false) => {
    const start = match.index + (match[0].search(/\S/) < 0 ? 0 : match[0].search(/\S/));
    const line = text.slice(0, start).split("\n").length;
    const key = `${type}:${line}`;
    if (seen.has(key)) return; seen.add(key);
    let classification = "potential-credential";
    if (runtime) classification = "runtime-reference";
    else if (placeholderAllowed && isPlaceholder(value)) classification = "placeholder";
    else if (["bearer-literal", "credential-assignment"].includes(type)) {
      const review = reviewedFixtures.find(item => (item.type || "bearer-literal") === type && item.path === file && item.fingerprint === fingerprint && item.lines.includes(line));
      if (review) classification = review.classification || "reviewed-test-fixture";
    }
    records.push({ path: file, revision, line, type, classification });
  };
  const strong = [
    ["discord-token", /[MNO][A-Za-z0-9_-]{23,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{27,}/g],
    ["supabase-key", /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}\b/g],
    ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}\b/g],
    ["cookie-line", /(?:^|\n)(?:#HttpOnly_)?\.?(?:youtube|google)\.com\t(?:TRUE|FALSE)\t[^\n]+/gi],
    ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g]
  ];
  for (const [type, regex] of strong) for (const match of text.matchAll(regex)) add(type, match, match[0]);
  const quoted = new RegExp("\\b" + ASSIGNMENT_NAMES + "\\s*=\\s*([\"'])([^\"'\\r\\n]*)\\1", "g");
  for (const match of text.matchAll(quoted)) add("credential-assignment", match, match[2], true);
  const env = new RegExp("(?:^|\\n)\\s*(?:export\\s+)?" + ASSIGNMENT_NAMES + "\\s*=\\s*([^\\r\\n#]*)", "g");
  for (const match of text.matchAll(env)) add("credential-assignment", match, match[1].replace(/^["']|["']$/g, ""), true);
  const bearer = /Authorization["']?\s*:\s*["'`]?Bearer\s+([^\s"'`\\,]+)/gi;
  for (const match of text.matchAll(bearer)) {
    const valueStart = match.index + match[0].lastIndexOf(match[1]);
    const runtime = /^\$\{(?:await\s+)?[A-Za-z_$][\w.$]*(?:\(\))?\}/.test(text.slice(valueStart));
    add("bearer-literal", match, match[1], true, runtime);
  }
  return records;
}
function scanRepository(root = process.cwd()) {
  const git = (args, options = {}) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, ...options });
  const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  const files = [...new Set([...tracked, ...git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean)])];
  const protectedPath = file => ((/(^|\/)\.env(?:\.|$)/i.test(file) && file !== ".env.example") || /(^|\/)cookies\.txt$/i.test(file) || file.startsWith("data/"));
  const protectedTracked = tracked.filter(protectedPath);
  const protectedWorking = files.filter(protectedPath);
  const protectedHistory = git(["log", "--all", "--format=%H", "--", ".env", "cookies.txt", "data/"]).trim().split(/\r?\n/).filter(Boolean);
  const report = { protectedTracked, protectedWorking, protectedHistory, trackedFiles: tracked.length, workingFiles: files.length, historyObjects: 0, historyCommits: 0,
    workingTree: [], history: [], reviewed: [], placeholders: 0, runtimeReferences: 0, errors: [] };
  if (protectedTracked.length || protectedWorking.length || protectedHistory.length) return { ...report, pass: false };
  const collect = (records, scope) => {
    for (const record of records) {
      if (record.classification === "placeholder") report.placeholders++;
      else if (record.classification === "runtime-reference") report.runtimeReferences++;
      else if (record.classification.startsWith("reviewed-")) report.reviewed.push(record);
      else report[scope].push(record);
    }
  };
  for (const file of files) {
    try { collect(scanText(fs.readFileSync(path.join(root, file)).toString("utf8"), { file }), "workingTree"); }
    catch { report.errors.push({ path: file, revision: "working-tree", reason: "unreadable" }); }
  }
  const objects = git(["rev-list", "--objects", "--all"]).trim().split(/\r?\n/).filter(Boolean).map(line => {
    const split = line.indexOf(" "); return { oid: split < 0 ? line : line.slice(0, split), path: split < 0 ? null : line.slice(split + 1) };
  });
  const types = git(["cat-file", "--batch-check"], { input: objects.map(object => object.oid).join("\n") + "\n" }).trim().split(/\r?\n/);
  const selected = objects.flatMap((object, index) => {
    const type = types[index]?.split(" ")[1]; return ["blob", "commit", "tag"].includes(type) ? [{ ...object, type }] : [];
  });
  report.historyObjects = selected.length; report.historyCommits = selected.filter(object => object.type === "commit").length;
  const batch = git(["cat-file", "--batch"], { encoding: null, input: selected.map(object => object.oid).join("\n") + "\n" });
  let cursor = 0;
  for (const object of selected) {
    const headerEnd = batch.indexOf(10, cursor), header = batch.subarray(cursor, headerEnd).toString("ascii").split(" ");
    const size = Number(header[2]);
    if (headerEnd < 0 || !Number.isSafeInteger(size) || size < 0 || headerEnd + 1 + size >= batch.length) throw new Error("Invalid Git object stream.");
    cursor = headerEnd + 1;
    const text = batch.subarray(cursor, cursor + size).toString("utf8"); cursor += size + 1;
    const file = object.path || (object.type === "commit" ? "(commit message)" : "(tag metadata)");
    const records = scanText(text, { file, revision: object.oid });
    if (records.some(record => record.classification !== "placeholder") && object.type === "blob") {
      const commits = git(["log", "--all", "--format=%H", "--find-object=" + object.oid]).trim().split(/\r?\n/).filter(Boolean);
      for (const commit of commits) {
        const row = git(["ls-tree", "-r", "--full-tree", commit]).split("\n").find(line => line.includes(object.oid + "\t"));
        if (row) { for (const record of records) { record.revision = commit; record.path = row.split("\t").slice(1).join("\t"); } break; }
      }
    }
    collect(records, "history");
  }
  report.pass = !report.workingTree.length && !report.history.length && !report.errors.length;
  return report;
}
module.exports = { REVIEWED_FIXTURES, contentFingerprint, isPlaceholder, scanText, scanRepository };
