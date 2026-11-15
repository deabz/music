const { spawn } = require("node:child_process");
const { PassThrough } = require("node:stream");
const { demuxProbe, StreamType } = require("@discordjs/voice");
const ytdlp = require("youtube-dl-exec");
const ffmpeg = require("ffmpeg-static");
const { youtubeCookieOptions, youtubeRuntimeOptions, formatYtdlpTime } = require("./music-utils");

// Backpressure bounds the unread output; child pipes have small additional buffers.
const PREFETCH_BYTES = 2 * 1024 * 1024;
function terminateChild(child, platform = process.platform, launch = spawn, killGroup = process.kill) {
  if (child.pipelineClosed) return;
  if (Number.isInteger(child.pid) && platform === "win32") {
    // yt-dlp can itself spawn FFmpeg for download-sections. Kill that tree too.
    try {
      const killer = launch("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.on("error", () => child.kill());
      killer.on("close", code => { if (code !== 0 && !child.pipelineClosed) child.kill(); });
    } catch { child.kill(); }
  } else if (Number.isInteger(child.pid) && platform !== "win32") {
    try { killGroup(-child.pid, "SIGKILL"); } catch { child.kill(); }
  } else child.kill();
}
function createAudioPipeline(track, filters = {}, offset = 0, launch = spawn, probe = demuxProbe) {
  const stream = new PassThrough({ highWaterMark: PREFETCH_BYTES });
  const job = { stream, stderr: "", filterStderr: "", cancelled: false, intentionallyAborted: false, error: null, downloadDone: false, outputDone: false,
    inputType: null, formatReady: false, rate: filters.nightcore ? 1.323 : 1, children: [],
    filters: { ...filters }, offset, exits: {}, commands: [], diagnosticSecrets: [] };
  job.ready = new Promise(resolve => { job.resolveReady = resolve; });
  job.sourceStreams = new Set();
  const fail = (error, stage = "player") => {
    if (job.cancelled || job.error) return;
    error.stderr = job.stderr || error.stderr || "";
    error.stage ||= stage;
    if (job.shouldIgnoreFailure?.(error)) {
      job.ignoredPipe = true;
      job.sourceEnded = true;
      job.finish?.();
      return;
    }
    job.error = error;
    job.resolveReady();
    job.onFailure?.(error);
    if (!stream.destroyed) stream.destroy(error);
    job.cancel("failure");
  };
  // Keep errors handled even before a prefetched stream has a player subscriber.
  stream.on("error", error => fail(error));
  stream.on("finish", () => { job.outputDone = true; });
  job.cancel = (reason = "intentional") => {
    if (job.cancelled) return;
    job.intentionallyAborted = reason === "intentional";
    job.cancelled = true;
    for (const child of job.children) {
      terminateChild(child);
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
    }
    for (const source of job.sourceStreams) source.destroy();
    stream.destroy();
    job.resolveReady();
  };
  const finish = () => {
    if (job.sourceEnded && job.children.every(child => child.pipelineClosed) && !job.error && !job.cancelled) stream.end();
  };
  job.finish = finish;
  const output = source => {
    source.on("end", () => { job.sourceEnded = true; finish(); });
    source.pipe(stream, { end: false });
  };
  const watch = (child, label, downloader = false) => {
    const stage = downloader ? "extract" : "ffmpeg";
    job.children.push(child);
    let detail = "";
    child.stderr?.on("data", chunk => {
      detail = (detail + chunk).slice(-2000);
      if (downloader) job.stderr = detail;
      else job.filterStderr = detail;
    });
    for (const pipe of [child.stdin, child.stdout, child.stderr]) pipe?.on("error", error => fail(error, stage));
    child.on("error", error => fail(error, stage));
    child.on("close", (code, signal) => {
      child.pipelineClosed = true;
      job.exits[stage] = { code, signal: signal || null };
      if (downloader) job.downloadDone = true;
      if (code !== 0) fail(new Error(detail.trim() || `${label} exited with code ${code}.`), stage);
      finish();
    });
    return child;
  };
  try {
    const options = { format: "bestaudio[ext=webm][acodec=opus]/bestaudio", output: "-", noPlaylist: true,
      noWarnings: true, quiet: true, ...youtubeCookieOptions(), ...youtubeRuntimeOptions(),
      ffmpegLocation: ffmpeg,
      ...(offset > 0 ? { downloadSections: `*${formatYtdlpTime(offset)}-inf` } : {}) };
    job.diagnosticSecrets = [options.cookies].filter(Boolean);
    job.commands.push({ stage: "extract", executable: ytdlp.constants.YOUTUBE_DL_PATH, args: [...ytdlp.args(options), "--", track.url] });
    // Native spawn avoids tinyspawn's unbounded duplicate stdout collection.
    const download = watch(launch(ytdlp.constants.YOUTUBE_DL_PATH,
      [...ytdlp.args(options), "--", track.url], { windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] }), "yt-dlp", true);
    job.download = download;
    // Probe at most a small prefix of this same download, preserving its bytes.
    // Only validated Discord-compatible WebM Opus uses the fast path.
    Promise.resolve(probe(download.stdout, 8192)).then(({ stream: source, type }) => {
      if (job.cancelled) { source.destroy(); return; }
      job.sourceStreams.add(source);
      source.on("error", error => fail(error, "probe"));
      const effects = [];
      if (filters.bassboost) effects.push("bass=g=10");
      if (filters.eightd) effects.push("apulsator=hz=0.1");
      if (filters.nightcore) effects.push("asetrate=44100*1.2,atempo=1.2");
      if (filters.echo) effects.push("aecho=0.8:0.88:60:0.4");
      if (effects.length || type !== StreamType.WebmOpus) {
        const args = ["-hide_banner", "-loglevel", "error", "-i", "pipe:0",
          ...(effects.length ? ["-af", effects.join(",")] : []),
          "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"];
        job.commands.push({ stage: "ffmpeg", executable: ffmpeg, args });
        let child;
        try { child = launch(ffmpeg, args,
          { windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] }); }
        catch (error) { fail(error, "ffmpeg"); return; }
        const filter = watch(child, "FFmpeg");
        job.inputType = StreamType.Raw;
        source.pipe(filter.stdin);
        output(filter.stdout);
      } else {
        job.inputType = StreamType.WebmOpus;
        output(source);
      }
      job.formatReady = true;
      job.resolveReady();
    }).catch(error => fail(error, "probe"));
  } catch (error) { fail(error, "extract"); job.cancel(); }
  return job;
}
module.exports = { createAudioPipeline, PREFETCH_BYTES, terminateChild };
