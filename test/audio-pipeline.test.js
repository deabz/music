const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createAudioPipeline, PREFETCH_BYTES } = require("../src/audio-pipeline");

function launcher() {
  const calls = [];
  const spawn = (file, args) => {
    const child = new EventEmitter();
    Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      kills: 0, kill() { this.kills++; } });
    calls.push({ file, args, child });
    return child;
  };
  return { calls, spawn };
}
test("shared pipeline buffers with backpressure and preserves effect/seek options", async () => {
  const { calls, spawn } = launcher();
  const job = createAudioPipeline({ url: "https://youtube.invalid/song" }, { echo: true }, 12, spawn);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].args.includes("bestaudio[ext=webm][acodec=opus]"));
  assert.ok(calls[0].args.includes("*00:00:12.000-inf"));
  assert.ok(calls[1].args.includes("aecho=0.8:0.88:60:0.4"));
  assert.equal(job.inputType, "raw");
  assert.equal(job.stream.readableHighWaterMark, PREFETCH_BYTES);
  calls[1].child.stdout.write(Buffer.alloc(PREFETCH_BYTES * 2));
  assert.equal(calls[1].child.stdout.isPaused(), true);
  job.cancel(); job.cancel();
  for (const { child } of calls) {
    assert.equal(child.kills, 1);
    assert.equal(child.stdout.destroyed, true);
    assert.equal(child.stdin.destroyed, true);
  }
  assert.equal(job.stream.destroyed, true);
});
test("cancelled child errors are ignored; genuine exit failure is retained", () => {
  const first = launcher();
  const cancelled = createAudioPipeline({ url: "test" }, {}, 0, first.spawn);
  cancelled.cancel();
  first.calls[0].child.emit("error", new Error("intentional kill"));
  first.calls[0].child.emit("close", 1);
  assert.equal(cancelled.error, null);
  const second = launcher();
  const failed = createAudioPipeline({ url: "test" }, {}, 0, second.spawn);
  second.calls[0].child.stderr.write("blocked download");
  second.calls[0].child.emit("close", 1);
  assert.match(failed.error.message, /blocked download/);
  failed.cancel();
});
