const { runYtdlpTool } = require("../src/ytdlp-tools");
runYtdlpTool([process.argv[2] === "update" ? "-U" : "--version"])
  .then(({ stdout, stderr }) => { if (stdout) console.log(stdout); if (stderr) console.error(stderr); })
  .catch(error => { console.error("yt-dlp tool failed:", error.message); process.exitCode = 1; });
