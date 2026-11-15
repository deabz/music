const { test } = require("node:test");
const assert = require("node:assert/strict");
const { classifyStreamFailure, isExpectedPipeFailure } = require("../src/playback-errors");
test("download failure reasons are classified without leaking raw details", () => {
  for (const [detail, code] of [
    ["unable to download video data: HTTP Error 403: Forbidden", "403"],
    ["Sign in to confirm your age", "sign-in"], ["This video is age-restricted", "sign-in"],
    ["Private video", "unavailable"], ["This video has been removed", "unavailable"],
    ["Requested format is not available", "format"], ["HTTP Error 429: Too Many Requests", "rate-limit"],
    ["Connection reset by peer", "network"], ["Request timed out", "network"], ["Unrecognized problem", "unknown"]
  ]) {
    const result = classifyStreamFailure(detail + " fixture/PRIVATE\\path");
    assert.equal(result.code, code, detail);
    assert.ok(!result.message.includes("PRIVATE"));
  }
});


test("pipe noise is harmless only for intentional aborts or natural completion within five seconds", () => {
  for (const detail of ["EPIPE", "Broken pipe", "[Errno 22] Invalid argument", "[Errno 32] Broken pipe"]) {
    assert.equal(isExpectedPipeFailure(detail, { intentionallyAborted: true }), true);
    assert.equal(isExpectedPipeFailure(detail, { naturalAudioEnd: true }), true);
    assert.equal(isExpectedPipeFailure(detail, { durationSeconds: 180, positionSeconds: 175 }), true);
    assert.equal(isExpectedPipeFailure(detail, { durationSeconds: 180, positionSeconds: 174.9 }), false);
    assert.equal(isExpectedPipeFailure(detail, { durationSeconds: 180, positionSeconds: 2 }), false);
    assert.equal(isExpectedPipeFailure(detail, {}), false);
  }
  assert.equal(isExpectedPipeFailure("HTTP Error 403", { naturalAudioEnd: true }), false);
});
