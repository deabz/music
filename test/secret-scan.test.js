const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { scanText, isPlaceholder, contentFingerprint } = require("../src/secret-scan");
const unknown = () => randomBytes(32).toString("hex");
test("descriptive credential slots are placeholders, arbitrary opaque values are not", () => {
  const instruction = ["insert", "your", "bot", "token", "here"].join("_");
  assert.equal(isPlaceholder(instruction), true); assert.equal(isPlaceholder(unknown()), false);
  const records = scanText(["DISCORD_TOKEN", instruction].join("="), { file: ".env.example" });
  assert.equal(records[0].classification, "placeholder");
});
test("opaque assignments and bearer values are flagged without returning their values", () => {
  const value = unknown();
  const text = [["MUSIC_DASHBOARD", "TOKEN"].join("_") + "=" + value, "Authorization: Bearer " + value].join("\n");
  const result = scanText(text, { file: "fixture.txt" });
  assert.ok(result.length >= 2); assert.ok(result.every(record => record.classification === "potential-credential"));
  assert.ok(!JSON.stringify(result).includes(value));
});
test("runtime interpolation is not a literal exposed credential", () => {
  const text = "Authorization: `Bearer " + "$" + "{runtimeValue}`";
  assert.equal(scanText(text, { file: "fixture.js" })[0].classification, "runtime-reference");
});
test("structured credential, cookie and private-key patterns remain active even for reviewed files", () => {
  const token = ["M" + "x".repeat(24), "y".repeat(7), "z".repeat(28)].join(".");
  const key = "sb_" + "secret_" + unknown();
  const jwt = ["eyJ" + "a".repeat(20), "b".repeat(20), "c".repeat(32)].join(".");
  const cookie = [".youtube.com", "TRUE", "/", "TRUE", "0", "fixture", unknown()].join("\t");
  const privateKey = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
  const text = [token, key, jwt, cookie, privateKey].join("\n");
  const result = scanText(text, { file: "test/fixture.js", reviewedFixtures: [{ path: "test/fixture.js", fingerprint: contentFingerprint(text), lines: [1, 2, 3, 4, 5] }] });
  assert.ok(result.every(record => record.classification === "potential-credential")); assert.equal(result.length, 5);
});
test("review exceptions require exact content, path, line and bearer rule", () => {
  const text = "Authorization: Bearer " + unknown();
  const reviews = [{ path: "test/reviewed.js", fingerprint: contentFingerprint(text), lines: [1] }];
  assert.equal(scanText(text, { file: "test/reviewed.js", reviewedFixtures: reviews })[0].classification, "reviewed-test-fixture");
  for (const [file, content] of [["elsewhere.js", text], ["test/reviewed.js", text + "\n"], ["test/reviewed.js", "\n" + text]]) {
    assert.equal(scanText(content, { file, reviewedFixtures: reviews })[0].classification, "potential-credential");
  }
});
test("both investigated historical HTTP fixtures retain only precisely reviewed bearer findings", () => {
  for (const revision of ["8f7b5556c6ddae07b03eca3d4071ad9b5c4116fe", "74ca3cf5e69e6688518e794554dfe51693217ae6"]) {
    const file = "test/health-server.test.js";
    const text = execFileSync("git", ["show", `${revision}:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const result = scanText(text, { file, revision });
    assert.equal(result.filter(record => record.classification === "reviewed-test-fixture").length, 4);
    assert.equal(result.filter(record => record.classification === "potential-credential").length, 0);
  }
});
test("current environment example contains only comments and empty lines", () => {
  const text = require("node:fs").readFileSync(require.resolve("../.env.example"), "utf8");
  assert.ok(text.split(/\r?\n/).every(line => !line.trim() || line.trim().startsWith("#")));
  assert.equal(scanText(text, { file: ".env.example" }).filter(record => record.classification === "potential-credential").length, 0);
});
