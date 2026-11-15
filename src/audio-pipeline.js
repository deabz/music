const { spawn } = require("node:child_process");
const { PassThrough } = require("node:stream");
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
function createAudioPipeline(track, filters = {}, offset = 0, launch = spawn) {
  const stream = new PassThrough({ highWaterMark: PREFETCH_BYTES });
  const job = { stream, cancelled: false, error: null, downloadDone: false, outputDone: false,
    inputType: "webm/opus", rate: filters.nightcore ? 1.323 : 1, children: [] };
  const fail = error => {
    if (job.cancelled || job.error) return;
    job.error = error;
    job.onFailure?.(error);
    if (!stream.destroyed) stream.destroy(error);
    job.cancel();
  };
  // Keep errors handled even before a prefetched stream has a player subscriber.
  stream.on("error", fail);
  stream.on("finish", () => { job.outputDone = true; });
  job.cancel = () => {
    if (job.cancelled) return;
    job.cancelled = true;
    for (const child of job.children) {
      terminateChild(child);
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
    }
    stream.destroy();
  };
  const finish = () => {
    if (job.sourceEnded && job.children.every(child => child.pipelineClosed) && !job.error && !job.cancelled) stream.end();
  };
  const output = source => {
    source.on("end", () => { job.sourceEnded = true; finish(); });
    source.pipe(stream, { end: false });
  };
  const watch = (child, label, downloader = false) => {
    job.children.push(child);
    let detail = "";
    child.stderr?.on("data", chunk => { detail = (detail + chunk).slice(-2000); });
    for (const pipe of [child.stdin, child.stdout, child.stderr]) pipe?.on("error", fail);
    child.on("error", fail);
    child.on("close", code => {
      child.pipelineClosed = true;
      if (downloader) job.downloadDone = true;
      if (code !== 0) fail(new Error(detail.trim() || `${label} exited with code ${code}.`));
      finish();
    });
    return child;
  };
  try {
    const options = { format: "bestaudio[ext=webm][acodec=opus]", output: "-", noPlaylist: true,
      noWarnings: true, quiet: true, ...youtubeCookieOptions(), ...youtubeRuntimeOptions(),
      ffmpegLocation: ffmpeg,
      ...(offset > 0 ? { downloadSections: `*${formatYtdlpTime(offset)}-inf` } : {}) };
    // Native spawn avoids tinyspawn's unbounded duplicate stdout collection.
    const download = watch(launch(ytdlp.constants.YOUTUBE_DL_PATH,
      [...ytdlp.args(options), "--", track.url], { windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] }), "yt-dlp", true);
    job.download = download;
    const effects = [];
    if (filters.bassboost) effects.push("bass=g=10");
    if (filters.eightd) effects.push("apulsator=hz=0.1");
    if (filters.nightcore) effects.push("asetrate=44100*1.2,atempo=1.2");
    if (filters.echo) effects.push("aecho=0.8:0.88:60:0.4");
    if (effects.length) {
      const filter = watch(launch(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0",
        "-af", effects.join(","), "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"],
      { windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] }), "FFmpeg");
      job.inputType = "raw";
      download.stdout.pipe(filter.stdin);
      output(filter.stdout);
    } else output(download.stdout);
  } catch (error) { fail(error); job.cancel(); }
  return job;
}
module.exports = { createAudioPipeline, PREFETCH_BYTES, terminateChild };
