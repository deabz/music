const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { runDiagnostics, createStartupDiagnostics, udpDns } = require("../src/diagnostics");
const checks = ok => Object.fromEntries(["ytdlp", "ffmpeg", "python", "udp", "gateway", "youtube", "commit"].map(name => [name, async () => ({ ok, detail: ok ? `${name} fixture OK` : "unavailable" })]));
test("diagnostics produce one log block with every result and no configured secrets", async () => {
  const secret = require("node:crypto").randomBytes(24).toString("hex");
  const env = { DISCORD_TOKEN: secret, YTDLP_PROXY: "http://fixture.invalid:8080", YOUTUBE_COOKIES_FILE: "/fixture/private/source" };
  const supplied = checks(true); supplied.youtube = async () => ({ ok: false, detail: `${secret} ${env.YTDLP_PROXY} ${env.YOUTUBE_COOKIES_FILE}` });
  const logs = []; const block = await runDiagnostics({ env, checks: supplied, log: value => logs.push(value) });
  assert.equal(logs.length, 1); assert.ok(!block.includes(secret)); assert.ok(!block.includes(env.YTDLP_PROXY)); assert.ok(!block.includes(env.YOUTUBE_COOKIES_FILE));
  for (const item of ["node:", "bot:", "yt-dlp:", "ffmpeg:", "python3:", "udp:", "gateway:", "youtube:", "summary:"]) assert.ok(block.includes(item));
  assert.match(block, /YOUTUBE_COOKIES_FILE configured: yes/); assert.match(block, /youtube=FAILED/);
});
test("tool errors, unavailable Python and logging failures never throw", async () => {
  const supplied = checks(false); supplied.ytdlp = async () => { throw new Error("fixture failure"); };
  const result = await runDiagnostics({ env: {}, checks: supplied, log() { throw new Error("logger unavailable"); } });
  assert.match(result, /python3: no/); assert.match(result, /udp=no-reply/); assert.match(result, /ytdlp=FAILED/);
});
test("Windows socket access denial is a network failure rather than YouTube 403", () => {
  const { classifyStreamFailure } = require("../src/playback-errors");
  assert.equal(classifyStreamFailure("[WinError 10013] socket access forbidden by its permissions").code, "network");
  assert.equal(classifyStreamFailure("HTTP Error 403: Forbidden").code, "403");
});
test("overall timeout bounds checks that ignore cancellation", async () => {
  const supplied = Object.fromEntries(Object.keys(checks(true)).map(name => [name, () => new Promise(() => {})]));
  const start = Date.now(); const result = await runDiagnostics({ env: {}, checks: supplied, timeoutMs: 25, log() {} });
  assert.ok(Date.now() - start < 1000); assert.match(result, /timeout/); assert.match(result, /youtube=FAILED/);
});
test("startup runner is asynchronous, once-only, disabled by configuration and rejection-safe", async () => {
  let count = 0, release;
  const start = createStartupDiagnostics(() => { count++; return new Promise(resolve => { release = resolve; }); });
  assert.equal(await start({ env: { STARTUP_DIAGNOSTICS: "false" } }), null); assert.equal(count, 0);
  const pending = start({ env: {} }); assert.equal(count, 0); await Promise.resolve(); assert.equal(count, 1);
  assert.equal(await start({ env: {} }), null); release("done"); assert.equal(await pending, "done");
  assert.equal(await createStartupDiagnostics(() => { throw new Error("fixture"); })({ env: {} }), null);
  assert.equal(await runDiagnostics({ env: { STARTUP_DIAGNOSTICS: "false" }, log() { assert.fail(); } }), null);
});
test("DNS UDP hint checks response transaction ID and closes sockets on reply or abort", async () => {
  for (const reply of [true, false]) {
    let closed = 0; const controller = new AbortController(); const socket = new EventEmitter();
    socket.close = () => { closed++; };
    socket.send = (query, port, host) => {
      assert.equal(port, 53); assert.equal(host, "1.1.1.1");
      if (reply) { const packet = Buffer.alloc(12); query.copy(packet, 0, 0, 2); packet[2] = 0x80; process.nextTick(() => socket.emit("message", packet)); }
      else process.nextTick(() => controller.abort());
    };
    assert.equal((await udpDns("1.1.1.1", controller.signal, () => socket)).reply, reply); assert.equal(closed, 1);
  }
});
