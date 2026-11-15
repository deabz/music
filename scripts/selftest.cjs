// Standalone diagnostics never load dotenv, the bot entry point or Discord login.
const { runDiagnostics } = require("../src/diagnostics");
const { prepareYouTubeCookies } = require("../src/music-utils");
const fs = require("node:fs/promises");
const path = require("node:path");
(async () => {
  let copy;
  try {
    if (process.env.YOUTUBE_COOKIES_FILE) copy = await prepareYouTubeCookies();
    await runDiagnostics();
  } catch { console.log("[diagnostics] summary: unavailable; diagnostics did not crash startup"); }
  finally {
    if (copy) { await fs.unlink(copy).catch(() => {}); await fs.rmdir(path.dirname(copy)).catch(() => {}); }
  }
})();
