const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
test("proxy reaches metadata, mix, stream and tool calls without appearing in diagnostics", async () => {
  const proxy = "http://fixture.invalid:8080";
  const previous = process.env.YTDLP_PROXY; process.env.YTDLP_PROXY = proxy;
  try {
    const utils = require("../src/music-utils"); let calls = 0;
    const run = async (url, options) => { assert.ok(options.proxy === proxy); calls++; return { entries: [] }; };
    await utils.searchYouTube("fixture", 1, run); await utils.resolvePlaylist("https://example.com/playlist", run);
    await require("../src/autoplay-candidates").fetchMix("dQw4w9WgXcQ", undefined, run);
    const result = await require("../src/ytdlp-tools").runYtdlpTool(["--version"], (file, args, options, callback) => {
      assert.equal(args[0], "--proxy"); assert.ok(args[1] === proxy); callback(null, proxy, proxy);
    });
    assert.ok(!result.stdout.includes(proxy)); assert.ok(!result.stderr.includes(proxy)); assert.equal(calls, 3);
    const spawn = () => Object.assign(new EventEmitter(), { stdout: new PassThrough(), stdin: new PassThrough(), stderr: new PassThrough(), kill() {} });
    const job = require("../src/audio-pipeline").createAudioPipeline({ url: "https://example.com/audio" }, {}, 0, spawn, async stream => ({ stream, type: "arbitrary" }));
    await job.ready;
    assert.ok(job.diagnosticSecrets.includes(proxy));
    const diagnostic = require("../src/playback-errors").streamFailureDiagnostic({ activePipeline: job }, {}, new Error(proxy));
    assert.ok(!diagnostic.includes(proxy)); job.cancel();
  } finally { if (previous === undefined) delete process.env.YTDLP_PROXY; else process.env.YTDLP_PROXY = previous; }
});
test("Linux uses process groups, Windows uses taskkill, closed children are not killed", async () => {
  const { terminateChild } = require("../src/audio-pipeline"); const groups = [], launched = [];
  const child = { pid: 456, kill() { assert.fail("group kill should succeed"); } };
  terminateChild(child, "linux", () => assert.fail("no shell"), (...args) => groups.push(args));
  assert.deepEqual(groups, [[-456, "SIGKILL"]]);
  const killer = new EventEmitter(); const pending = terminateChild(child, "win32", (file, args, options) => { launched.push(file); assert.equal(options.windowsHide, true); return killer; });
  killer.emit("close", 0); await pending; assert.deepEqual(launched, ["taskkill"]);
  terminateChild({ pipelineClosed: true, kill() { assert.fail(); } }, "linux");
});
test("Linux read-only secret source is copied to a private writable temp file", async () => {
  const calls = [];
  const fakeFs = { mkdtemp: async () => "/tmp/nyx-cookies-fixture", chmod: async (...args) => calls.push(args), copyFile: async (...args) => calls.push(args) };
  const context = { module: { exports: {} }, process: { platform: "linux", env: {}, execPath: "/usr/bin/node" },
    require: name => name === "fs/promises" ? fakeFs : name === "path" ? require("node:path").posix : name === "os" ? { tmpdir: () => "/tmp" } : require("node:module").createRequire(require.resolve("../src/music-utils"))(name) };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/music-utils"), "utf8"), context);
  const target = await context.module.exports.prepareYouTubeCookies("/run/secrets/youtube");
  assert.equal(target, "/tmp/nyx-cookies-fixture/cookies.txt");
  assert.ok(calls.some(args => args[0] === "/tmp/nyx-cookies-fixture" && args[1] === 0o700));
  assert.ok(calls.some(args => args[0] === target && args[1] === 0o600));
  assert.ok(calls.some(args => args[0] === "/run/secrets/youtube" && args[1] === target));
});
test("Docker and shell line endings remain LF and private files stay outside the build context", () => {
  const docker = fs.readFileSync(require.resolve("../Dockerfile"), "utf8"); assert.ok(!docker.includes("\r"));
  assert.match(docker, /FROM node:22/); assert.match(docker, /python3/); assert.match(docker, /npm ci --omit=dev/);
  assert.doesNotMatch(docker, /\bPORT\s*=/, "Render supplies PORT at runtime");
  const ignored = fs.readFileSync(require.resolve("../.dockerignore"), "utf8");
  for (const name of [".env", "cookies.txt", "data/", "node_modules/", ".git/", "logs/"]) assert.ok(ignored.split("\n").includes(name));
});

test("Render deploys the verified branch using the production Docker health endpoint", () => {
  const blueprint = fs.readFileSync(require.resolve("../render.yaml"), "utf8");
  assert.match(blueprint, /branch: render-ready/);
  assert.match(blueprint, /runtime: docker/);
  assert.match(blueprint, /healthCheckPath: \/health/);
  assert.ok(!/NODE_VERSION|buildCommand:|startCommand:/.test(blueprint));
});

test("locked Discord HTTP client includes the undici security fixes", () => {
  const lock = require("../package-lock.json");
  const selected = Object.entries(lock.packages).filter(([name]) => name.endsWith("/undici"));
  assert.ok(selected.length);
  for (const [, entry] of selected) {
    const [major, minor, patch] = entry.version.split(".").map(Number);
    assert.equal(major, 6, "Keep the supported Discord HTTP client major version");
    assert.ok(minor > 29 || (minor === 29 && patch >= 1));
  }
});
