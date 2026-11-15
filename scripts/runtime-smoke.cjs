// Deterministic real-process verification, with no Discord login or public network.
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createAudioPipeline } = require("../src/audio-pipeline");
const ffmpeg = require("ffmpeg-static");

async function audio(filters, offset) {
  const children = [];
  const launch = (file, args, options) => {
    // Substitute only the network extractor; probing, filtering and piping are real.
    const source = !children.length;
    const child = spawn(source ? ffmpeg : file, source ? ["-hide_banner", "-nostdin", "-loglevel", "error",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", String(offset + 1),
      "-ac", "2", "-c:a", "libopus", "-f", "webm", "pipe:1"] : args, options);
    children.push(child); return child;
  };
  const job = createAudioPipeline({ url: "https://example.invalid/synthetic-audio" }, filters, offset, launch);
  const timeout = setTimeout(() => job.cancel(), 15000);
  try {
    await job.ready;
    let bytes = 0;
    for await (const chunk of job.stream) bytes += chunk.length;
    assert.equal(job.error, null); assert.equal(job.cancelled, false); assert.ok(bytes > 0);
    assert.ok(children.every(child => child.pipelineClosed));
    if (offset || Object.values(filters).some(Boolean)) {
      assert.equal(job.inputType, "raw");
      const seconds = bytes / 192000;
      assert.ok(seconds > 0.5 && seconds < 1.2, "PCM duration must match source position and speed");
    } else assert.equal(job.inputType, "webm/opus");
    console.log(`[runtime] audio=${Object.keys(filters).join("+") || "off"} offset=${offset} bytes=${bytes} OK`);
  } finally { clearTimeout(timeout); job.cancel(); await job.termination; }
}
async function main() {
  assert.deepEqual(require("../src/command-validation").validateCommands(require("../src/commands").commands), []);
  const ytdlp = require("youtube-dl-exec").constants.YOUTUBE_DL_PATH;
  assert.match(execFileSync(ytdlp, ["--version"], { timeout: 10000, encoding: "utf8", windowsHide: true }), /\d{4}\.\d{2}\.\d{2}/);
  assert.match(execFileSync(ffmpeg, ["-version"], { timeout: 10000, encoding: "utf8", windowsHide: true }), /ffmpeg version/);
  // Voice can construct a real inline-volume PCM resource and use its Opus encoder.
  const voice = require("@discordjs/voice");
  const resource = voice.createAudioResource(require("node:stream").Readable.from([Buffer.alloc(3840)]), { inputType: voice.StreamType.Raw, inlineVolume: true });
  resource.volume.setVolume(0.4); resource.playStream.destroy();
  const Opus = require("opusscript"), encoder = new Opus(48000, 2, Opus.Application.AUDIO);
  try { assert.ok(encoder.encode(Buffer.alloc(3840), 960).length > 0); } finally { encoder.delete(); }
  assert.ok(require("node:crypto").getCiphers().includes("aes-256-gcm"));
  require("@snazzah/davey");
  console.log("[runtime] command definitions, yt-dlp, ffmpeg, Opus, encryption and DAVE OK");
  for (const filters of [{}, { bassboost: true }, { eightd: true }, { nightcore: true }, { echo: true }, { bassboost: true, eightd: true, nightcore: true, echo: true }]) await audio(filters, 0);
  await audio({}, 60); await audio({ bassboost: true, eightd: true, nightcore: true, echo: true }, 60);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nyx-runtime-"));
  let server;
  const previousFile = process.env.MUSIC_STATE_FILE;
  try {
    assert.ok(!process.env.SUPABASE_URL, "This smoke test must use isolated JSON storage");
    process.env.MUSIC_STATE_FILE = path.join(directory, "state.json");
    const storage = require("../src/storage");
    await storage.loadAll(); await storage.saveGuilds({ fixture: { volume: 42 } }, { throwOnError: true });
    assert.equal((await storage.loadAll()).fixture.volume, 42);
    let ready = false;
    server = require("../src/health-server").createHealthServer({ page: require("../src/health-page").healthPage,
      dashboardPage: require("../src/dashboard-page").dashboardPage, getStatus: () => ({ ready }) });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "0.0.0.0", resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const route of ["/", "/health", "/commands", "/changelog", "/status", "/dashboard", "/api/commands", "/api/now-playing", "/site.css", "/site.js", "/favicon.ico"]) assert.equal((await fetch(base + route)).status, 200, route);
    assert.equal((await fetch(base + "/healthz")).status, 503);
    ready = true; assert.equal((await fetch(base + "/healthz")).status, 200);
    assert.equal((await fetch(base + "/api/dashboard")).status, 503);
    assert.equal((await fetch(base + "/missing")).status, 404);
    console.log("[runtime] writable storage, public HTTP, readiness and disabled dashboard OK");
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (previousFile === undefined) delete process.env.MUSIC_STATE_FILE; else process.env.MUSIC_STATE_FILE = previousFile;
    for (const name of ["state.json"]) await fs.unlink(path.join(directory, name)).catch(() => {});
    await fs.rmdir(directory);
  }
}
main().catch(error => { console.error(`[runtime] FAILED: ${error.code || error.name} (${String(error.stack || "").split("\n").find(line => line.includes("runtime-smoke.cjs:"))?.trim().replace(/.*runtime-smoke.cjs:/, "line ") || "tool execution"})`); process.exitCode = 1; });
