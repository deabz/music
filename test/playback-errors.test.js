const { test } = require("node:test");
const assert = require("node:assert/strict");
const { classifyStreamFailure } = require("../src/playback-errors");
test("download failure reasons are classified without leaking raw details", () => {
  for (const [detail, code] of [
    ["unable to download video data: HTTP Error 403: Forbidden", "403"],
    ["Sign in to confirm your age", "sign-in"], ["This video is age-restricted", "sign-in"],
    ["Private video", "unavailable"], ["This video has been removed", "unavailable"],
    ["Requested format is not available", "format"], ["HTTP Error 429: Too Many Requests", "rate-limit"],
    ["Connection reset by peer", "network"], ["Request timed out", "network"], ["Unrecognized problem", "unknown"]
  ]) {
    const result = classifyStreamFailure(detail + " C:\\PRIVATE\\path");
    assert.equal(result.code, code, detail);
    assert.ok(!result.message.includes("PRIVATE"));
  }
});
