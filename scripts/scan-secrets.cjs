// Only classifications and source locations leave the scanner; never matched text.
try {
  const report = require("../src/secret-scan").scanRepository();
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
} catch {
  console.error("Secret scan incomplete; release gate remains blocked.");
  process.exitCode = 1;
}
