const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createAudioPipeline, PREFETCH_BYTES, terminateChild } = require("../src/audio-pipeline");

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
test("stdout/stdin EPIPE is handled and intentional Windows abort noise stays silent", async () => {
  for (const intentional of [true, false]) {
    const fixture = launcher();
    const job = createAudioPipeline({ url: "test" }, { echo: true }, 0, fixture.spawn);
    let failures = 0;
    job.onFailure = () => { failures++; };
    if (intentional) job.cancel();
    for (const { child } of fixture.calls) {
      child.stdout.emit("error", Object.assign(new Error("Invalid argument"), { code: "EINVAL" }));
      child.stdin.emit("error", Object.assign(new Error("Broken pipe"), { code: "EPIPE" }));
      child.emit("close", 1);
    }
    assert.equal(failures, intentional ? 0 : 1);
    job.cancel();
  }
});
test("EOF is released only after successful child close without awaiting a promise", async () => {
  const fixture = launcher();
  const job = createAudioPipeline({ url: "test" }, {}, 0, fixture.spawn);
  job.stream.resume();
  fixture.calls[0].child.stdout.end("audio");
  await new Promise(setImmediate);
  assert.equal(job.stream.writableEnded, false);
  fixture.calls[0].child.emit("close", 0);
  assert.equal(job.stream.writableEnded, true);
  job.cancel();
});
test("Windows cancellation targets the process tree, with fallback on taskkill failure", () => {
  let kills = 0;
  const child = { pid: 12345, kill() { kills++; } };
  let argumentsUsed;
  const killer = new EventEmitter();
  terminateChild(child, "win32", (file, args, options) => {
    argumentsUsed = { file, args, options }; return killer;
  });
  assert.equal(argumentsUsed.file, "taskkill");
  assert.deepEqual(argumentsUsed.args, ["/PID", "12345", "/T", "/F"]);
  assert.equal(argumentsUsed.options.windowsHide, true);
  assert.equal(kills, 0);
  killer.emit("close", 1);
  assert.equal(kills, 1);
});
test("natural-end pipe noise can complete without failure; early pipe failures remain errors", async () => {
  for (const natural of [true, false]) {
    const fixture = launcher();
    const job = createAudioPipeline({ url: "test" }, {}, 0, fixture.spawn);
    assert.equal(job.intentionallyAborted, false);
    job.shouldIgnoreFailure = () => natural;
    fixture.calls[0].child.stderr.write("ERROR: unable to write data: [Errno 32] Broken pipe");
    fixture.calls[0].child.emit("close", 1);
    assert.equal(Boolean(job.error), !natural);
    if (natural) assert.equal(job.stream.writableEnded, true);
    else assert.equal(job.intentionallyAborted, false, "failure cleanup must not be labelled user cancellation");
    job.cancel();
  }
});
