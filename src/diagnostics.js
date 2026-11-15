const { execFile } = require("node:child_process");
const dgram = require("node:dgram");
const { randomInt } = require("node:crypto");
const { redactDiagnostic, classifyStreamFailure } = require("./playback-errors");
const DIAGNOSTICS_TIMEOUT_MS = 60000;
function execute(file, args) {
  return new Promise(resolve => execFile(file, args, { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    resolve({ ok: !error, detail: !error ? String(stdout || stderr).split(/\r?\n/)[0] : "unavailable" });
  }));
}
function udpDns(server, signal, createSocket = dgram.createSocket) {
  return new Promise(resolve => {
    const socket = createSocket("udp4"), id = randomInt(65536);
    const header = Buffer.alloc(12); header.writeUInt16BE(id); header.writeUInt16BE(0x100, 2); header.writeUInt16BE(1, 4);
    const query = Buffer.concat([header, Buffer.from([7]), Buffer.from("discord"), Buffer.from([3]), Buffer.from("com"), Buffer.from([0, 0, 1, 0, 1])]);
    let settled = false;
    const finish = ok => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      try { socket.close(); } catch { /* Socket may not have bound. */ }
      resolve({ server, reply: ok });
    };
    const abort = () => finish(false);
    const timer = setTimeout(abort, 3000);
    socket.on("error", abort);
    socket.on("message", packet => { if (packet.length >= 12 && packet.readUInt16BE(0) === id && (packet[2] & 0x80)) finish(true); });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    try { socket.send(query, 53, server, error => { if (error) finish(false); }); } catch { finish(false); }
  });
}
function aborted(signal) {
  return new Promise(resolve => {
    if (signal.aborted) resolve({ ok: false, detail: "timeout" });
    else signal.addEventListener("abort", () => resolve({ ok: false, detail: "timeout" }), { once: true });
  });
}
async function youtubeProbe(signal) {
  const utils = require("./music-utils");
  let searchError, entries = [];
  try { entries = await utils.searchYouTube("never gonna give you up", 3, undefined, signal); } catch (error) { searchError = error; }
    if (signal.aborted) return { ok: false, detail: "(network) timeout" };
  const job = require("./audio-pipeline").createAudioPipeline({ title: "Public diagnostics sample", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  job.onFailure = () => {};
  let bytes = 0, timer;
  const cancel = () => job.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await Promise.race([job.ready, aborted(signal)]);
    if (!job.error && !job.cancelled) await new Promise(resolve => {
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(); };
      timer = setTimeout(finish, 8000);
      job.stream.on("data", chunk => { bytes += Math.min(chunk.length, 256 * 1024 - bytes); if (bytes >= 256 * 1024) finish(); });
      job.stream.once("end", finish); job.stream.once("close", finish); job.stream.once("error", finish);
    });
    const error = job.error || searchError;
    const detail = [job.stderr, job.filterStderr, error?.stderr, error?.message].filter(Boolean).join("\n");
    if (!error && entries.length && bytes > 0 && !signal.aborted) return { ok: true, detail: `(search=${entries.length} audio=${bytes} bytes)` };
    return { ok: false, detail: `(${classifyStreamFailure(detail).code}) ${redactDiagnostic(detail.slice(-500), job.diagnosticSecrets || [])}` };
  } finally {
    clearTimeout(timer); signal.removeEventListener("abort", cancel); job.cancel(); await job.termination;
  }
}
function defaultChecks(env) {
  return {
    ytdlp: async () => {
      try { const result = await require("./ytdlp-tools").runYtdlpTool(["--version"]); return { ok: true, detail: result.stdout }; }
      catch { return { ok: false, detail: "unavailable" }; }
    },
    ffmpeg: () => execute(require("ffmpeg-static"), ["-version"]),
    python: () => execute("python3", ["--version"]),
    udp: async signal => {
      const results = await Promise.all(["1.1.1.1", "8.8.8.8"].map(server => udpDns(server, signal)));
      return { ok: results.some(item => item.reply), detail: results.map(item => `${item.server}=${item.reply ? "reply" : "no reply"}`).join(" ") + " (hint only; does not verify Discord voice UDP)" };
    },
    gateway: async signal => {
      const response = await fetch("https://discord.com/api/v10/gateway", { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
      await response.body?.cancel(); return { ok: response.ok, detail: `HTTP ${response.status}` };
    },
    youtube: youtubeProbe,
    commit: async () => {
      const supplied = env.RENDER_GIT_COMMIT || env.GIT_COMMIT;
      if (supplied && /^[a-f0-9]{7,40}$/i.test(supplied)) return { ok: true, detail: supplied.slice(0, 12) };
      const result = await execute("git", ["rev-parse", "--short", "HEAD"]);
      return { ok: true, detail: /^[a-f0-9]{7,40}$/i.test(result.detail) ? result.detail : "unknown" };
    }
  };
}
async function runDiagnostics({ env = process.env, checks = {}, log = console.log, timeoutMs = DIAGNOSTICS_TIMEOUT_MS } = {}) {
  if (env.STARTUP_DIAGNOSTICS === "false") return null;
  const controller = new AbortController();
  require("node:events").setMaxListeners(25, controller.signal);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const available = { ...defaultChecks(env), ...checks };
    const names = ["ytdlp", "ffmpeg", "python", "udp", "gateway", "youtube", "commit"];
    const results = Object.fromEntries(await Promise.all(names.map(async name => {
      const value = await Promise.race([Promise.resolve().then(() => available[name](controller.signal)).catch(() => ({ ok: false, detail: "unavailable" })), aborted(controller.signal)]);
      return [name, value || { ok: false, detail: "unavailable" }];
    })));
    const secrets = Object.entries(env).filter(([key]) => /TOKEN|SECRET|PASSWORD|COOKIE|PROXY|API_KEY/i.test(key)).map(([, value]) => value).filter(Boolean);
    const safe = value => redactDiagnostic(String(value || "unavailable"), secrets).replace(/[\r\n]+/g, " ").slice(0, 650);
    const status = name => results[name].ok ? "OK" : "FAILED";
    const lines = [`node: ${process.version} ${process.platform}`, `bot: ${require("../package.json").version} commit ${safe(results.commit.detail)}`,
      `yt-dlp: ${status("ytdlp")} ${safe(results.ytdlp.detail)}`, `ffmpeg: ${results.ffmpeg.ok ? "yes" : "no"} ${safe(results.ffmpeg.detail)}`,
      `python3: ${results.python.ok ? "yes" : "no"} ${safe(results.python.detail)} (informational)`,
      `YOUTUBE_COOKIES_FILE configured: ${env.YOUTUBE_COOKIES_FILE ? "yes" : "no"}`, `YTDLP_PROXY configured: ${env.YTDLP_PROXY ? "yes" : "no"}`,
      `udp: ${safe(results.udp.detail)}`, `gateway: ${safe(results.gateway.detail)}`,
      `youtube: ${results.youtube.ok ? "OK" : "FAILED"} ${safe(results.youtube.detail)}`,
      `summary: youtube=${status("youtube")} ytdlp=${status("ytdlp")} ffmpeg=${status("ffmpeg")} udp=${results.udp.ok ? "hint-OK" : "no-reply"}`];
    const block = lines.map(line => `[diagnostics] ${line}`).join("\n");
    try { log(block); } catch { /* Logging must never crash the bot. */ }
    return block;
  } catch { return null; }
  finally { clearTimeout(timer); controller.abort(); }
}
function createStartupDiagnostics(run = runDiagnostics) {
  let started = false;
  return (options = {}) => {
    if (started || (options.env || process.env).STARTUP_DIAGNOSTICS === "false") return Promise.resolve(null);
    started = true;
    return Promise.resolve().then(() => run(options)).catch(() => null);
  };
}
const startStartupDiagnostics = createStartupDiagnostics();
module.exports = { runDiagnostics, startStartupDiagnostics, createStartupDiagnostics, udpDns, youtubeProbe, DIAGNOSTICS_TIMEOUT_MS };
