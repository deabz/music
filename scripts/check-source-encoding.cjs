const fs = require("node:fs");
const path = require("node:path");
const decoder = new TextDecoder("utf-8", { fatal: true });
for (const directory of ["src", "test", "scripts", "web"]) {
  for (const name of fs.readdirSync(directory)) {
    if (!/\.(?:js|cjs|py|css|json)$/.test(name)) continue;
    const file = path.join(directory, name);
    try { decoder.decode(fs.readFileSync(file)); }
    catch { throw new Error(`Source file is not valid UTF-8: ${file}`); }
  }
}
console.log("Source UTF-8 encoding checks passed.");
