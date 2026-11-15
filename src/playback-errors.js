function classifyStreamFailure(detail = "") {
  const text = String(detail);
  if (/\b403\b|forbidden/i.test(text)) return { code: "403", message: "YouTube refused the download (403)" };
  if (/\b429\b|too many requests|rate.?limit/i.test(text)) return { code: "rate-limit", message: "YouTube rate-limited the download (429)" };
  if (/sign.?in|log.?in|age.?restrict|confirm your age|confirm you.?re not a bot/i.test(text)) return { code: "sign-in", message: "This video is age-restricted or needs sign-in" };
  if (/requested format.*not available|no video formats|no suitable formats/i.test(text)) return { code: "format", message: "The requested audio format is not available" };
  if (/private video|video (?:is )?(?:unavailable|removed)|video has been removed|not available|does not exist|deleted video/i.test(text)) return { code: "unavailable", message: "This video is private, unavailable, or removed" };
  if (/timed?\s*out|timeout|network|connection (?:reset|refused|aborted)|ENOTFOUND|ECONNRESET|ETIMEDOUT|unable to (?:connect|download webpage)|name resolution/i.test(text)) return { code: "network", message: "A network error or timeout interrupted the download" };
  return { code: "unknown", message: "Playback failed; check the host logs for details" };
}
module.exports = { classifyStreamFailure };
