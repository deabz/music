function classifyStreamFailure(detail = "") {
  const text = String(detail);
  if (/WinError\s*10013|\bEACCES\b|\bENETUNREACH\b|\bEHOSTUNREACH\b/i.test(text)) return { code: "network", message: "A network error or timeout interrupted the download" };
  if (/\b403\b|forbidden/i.test(text)) return { code: "403", message: "YouTube refused the download (403)" };
  if (/\b429\b|too many requests|rate.?limit/i.test(text)) return { code: "rate-limit", message: "YouTube rate-limited the download (429)" };
  if (/sign.?in|log.?in|age.?restrict|confirm your age|confirm you.?re not a bot/i.test(text)) return { code: "sign-in", message: "This video is age-restricted or needs sign-in" };
  if (/requested format.*not available|no video formats|no suitable formats/i.test(text)) return { code: "format", message: "The requested audio format is not available" };
  if (/private video|video (?:is )?(?:private|unavailable|removed)|video has been removed|not available|does not exist|deleted video/i.test(text)) return { code: "unavailable", message: "This video is private, unavailable, or removed" };
  if (/timed?\s*out|timeout|network|connection (?:reset|refused|aborted)|ENOTFOUND|ECONNRESET|ETIMEDOUT|unable to (?:connect|download webpage)|name resolution/i.test(text)) return { code: "network", message: "A network error or timeout interrupted the download" };
  return { code: "unknown", message: "Playback failed; check the host logs for details" };
}
function redactDiagnostic(value, secrets = []) {
  let text = String(value ?? "");
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(secret).join("[redacted]");
  return text.replace(/((?:token|secret|password|authorization|api[_-]?key)[=:\s]+)(?:Bearer\s+)?[^\s&,;"']+/gi, "$1[redacted]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@");
}
function streamFailureDiagnostic(state, track, error, stage = "player") {
  const job = state.activePipeline;
  const secrets = [...(job?.diagnosticSecrets || []), ...Object.entries(process.env)
    .filter(([key]) => /TOKEN|SECRET|PASSWORD|COOKIE|API_KEY|PROXY/i.test(key)).map(([, value]) => value)];
  const redact = value => redactDiagnostic(value, secrets);
  return JSON.stringify({ guild: state.guild?.id, track: redact(track?.title), generation: job?.generationId ?? job?.playbackGeneration ?? null, stage: error.stage || stage,
    message: redact(error.message), effects: job?.filters || state.audioFilters,
    position: job?.offset ?? state.resumeOffsetSeconds ?? 0,
    exits: job?.exits || {}, commands: (job?.commands || []).map(command => ({ stage: command.stage,
      executable: redact(command.executable), args: command.args.map(redact) })),
    ytdlpStderr: redact((job?.stderr || error.stderr || "").slice(-2000)),
    ffmpegStderr: redact((job?.filterStderr || "").slice(-2000)) });
}
function streamEndDiagnostic(state, track, job, reason, resource) {
  const offset = job?.offset ?? state.resumeOffsetSeconds ?? 0;
  const delivered = (resource?.playbackDuration || 0) / 1000 * (job?.rate || state.resourcePlaybackRate || 1);
  const secrets = [...(job?.diagnosticSecrets || []), ...Object.entries(process.env)
    .filter(([key]) => /TOKEN|SECRET|PASSWORD|COOKIE|API_KEY|PROXY/i.test(key)).map(([, value]) => value)];
  return JSON.stringify({ guild: state.guild?.id, track: redactDiagnostic(track?.title, secrets),
    generation: job?.generationId ?? job?.playbackGeneration ?? null, reason,
    deliveredSeconds: delivered, expectedSeconds: Math.max(0, (track?.duration || 0) - offset),
    positionSeconds: offset + delivered,
    ytdlpExitCode: job?.exits?.extract?.code ?? null, ffmpegExitCode: job?.exits?.ffmpeg?.code ?? null });
}
const NATURAL_END_TOLERANCE_SECONDS = 5;
function isPipeFailure(detail = "") {
  return /\bEPIPE\b|broken pipe|\[?Errno\s+(?:22|32)\]?|\bEINVAL\b/i.test(String(detail));
}
function isExpectedPipeFailure(detail, { intentionallyAborted = false, naturalAudioEnd = false,
  positionSeconds = 0, durationSeconds = 0 } = {}) {
  if (!isPipeFailure(detail)) return false;
  return intentionallyAborted || naturalAudioEnd || (Number.isFinite(durationSeconds) && durationSeconds > 0
    && positionSeconds >= Math.max(0, durationSeconds - NATURAL_END_TOLERANCE_SECONDS));
}
module.exports = { classifyStreamFailure, isPipeFailure, isExpectedPipeFailure, NATURAL_END_TOLERANCE_SECONDS, redactDiagnostic, streamFailureDiagnostic, streamEndDiagnostic };
