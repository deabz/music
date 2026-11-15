const { execFile } = require("node:child_process");
const { constants } = require("youtube-dl-exec");

function runYtdlpTool(args, execute = execFile) {
  return new Promise((resolve, reject) => {
    execute(constants.YOUTUBE_DL_PATH, args, { windowsHide: true, timeout: args.includes("-U") ? 120000 : 8000,
      encoding: "utf8", maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}
async function logYtdlpVersion(run = runYtdlpTool, logger = console) {
  try {
    const result = await run(["--version"]);
    if (!result.stdout) throw new Error("Empty version response");
    logger.log(`[ytdlp] version ${result.stdout.split(/\r?\n/)[0]}`);
  } catch { logger.warn("[ytdlp] Warning: could not determine version; continuing startup."); }
}
module.exports = { runYtdlpTool, logYtdlpVersion };
