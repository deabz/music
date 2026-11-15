const { test } = require("node:test");
const assert = require("node:assert/strict");
const { constants } = require("youtube-dl-exec");
const { runYtdlpTool, logYtdlpVersion } = require("../src/ytdlp-tools");
test("version and update use the wrapper's executable path with Windows-safe execFile", async () => {
  for (const argument of ["--version", "-U"]) {
    const result = await runYtdlpTool([argument], (file, args, options, callback) => {
      assert.equal(file, constants.YOUTUBE_DL_PATH);
      assert.deepEqual(args, [argument]);
      assert.equal(options.windowsHide, true);
      assert.ok(options.timeout > 0);
      callback(null, "2026.10.26\n", "");
    });
    assert.equal(result.stdout, "2026.10.26");
  }
});
test("version logging is informative and failures never block startup", async () => {
  const messages = [], warnings = [];
  const logger = { log: text => messages.push(text), warn: text => warnings.push(text) };
  await logYtdlpVersion(async () => ({ stdout: "2026.10.26" }), logger);
  assert.deepEqual(messages, ["[ytdlp] version 2026.10.26"]);
  await logYtdlpVersion(async () => { throw new Error("synthetic failure"); }, logger);
  assert.equal(warnings.length, 1);
});
