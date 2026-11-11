const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { prepareYouTubeCookies, youtubeCookieOptions } = require("../src/music-utils");

test("read-only source cookies are copied to a writable private file used by yt-dlp", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nyx-cookie-test-"));
  const source = path.join(directory, "source.txt");
  const content = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\ttest\tsynthetic\n";
  let destination;
  try {
    await fs.writeFile(source, content);
    await fs.chmod(source, 0o400);
    destination = await prepareYouTubeCookies(source);
    assert.notEqual(destination, source);
    assert.deepEqual(youtubeCookieOptions(), { cookies: destination });
    assert.equal(await fs.readFile(destination, "utf8"), content);
    await fs.appendFile(destination, "# updated by yt-dlp\n");
    assert.equal(await fs.readFile(source, "utf8"), content);
    if (process.platform !== "win32") {
      assert.equal((await fs.stat(destination)).mode & 0o777, 0o600);
      assert.equal((await fs.stat(path.dirname(destination))).mode & 0o777, 0o700);
    }
    assert.equal(await prepareYouTubeCookies(""), undefined);
  } finally {
    if (destination) {
      await fs.unlink(destination);
      await fs.rmdir(path.dirname(destination));
    }
    await fs.chmod(source, 0o600);
    await fs.unlink(source);
    await fs.rmdir(directory);
  }
});
