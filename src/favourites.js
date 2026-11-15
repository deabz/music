const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomBytes } = require("node:crypto");
const { hasAllowedDuration } = require("./music-utils");
const FAVOURITES_LIMIT = 25;
function savedTrack(track) {
  const url = new URL(track.url);
  if (!["http:", "https:"].includes(url.protocol) || url.href.length > 2048 || typeof track.title !== "string"
    || !track.title.trim() || !hasAllowedDuration(track.duration)) throw new Error("Invalid favourite track.");
  return { url: url.href, title: track.title.slice(0, 500), author: String(track.author || "Unknown artist").slice(0, 300),
    duration: track.duration, thumbnail: typeof track.thumbnail === "string" ? track.thumbnail.slice(0, 4096) : null };
}
const favouriteId = track => createHash("sha256").update(track.url).digest("hex").slice(0, 20);
class FavouritesStore {
  constructor(file = path.resolve("data/favourites.json"), log = console.error) {
    this.file = file; this.log = log; this.users = new Map(); this.loaded = false; this.chain = Promise.resolve();
  }
  async load() {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      try {
        const data = JSON.parse(await fs.readFile(this.file, "utf8"));
        if (data?.version !== 1 || !data.users || typeof data.users !== "object" || Array.isArray(data.users)) throw new Error("Invalid favourites file.");
        const users = new Map();
        for (const [id, tracks] of Object.entries(data.users)) {
          if (!Array.isArray(tracks) || tracks.length > FAVOURITES_LIMIT) throw new Error("Invalid favourites list.");
          users.set(id, tracks.map(savedTrack));
        }
        this.users = users; this.loaded = true;
      } catch (error) {
        if (error.code === "ENOENT") this.loaded = true;
        else this.log(`[favourites] Load failed; saving is disabled: ${error.message}`);
      }
      return this.loaded;
    })();
    return this.loadPromise;
  }
  list(userId) {
    if (!this.loaded) throw new Error("Favourites storage is unavailable.");
    return (this.users.get(userId) || []).map(track => ({ ...track, id: favouriteId(track) }));
  }
  toggle(userId, source) {
    const operation = this.chain.then(async () => {
      if (!this.loaded) throw new Error("Favourites storage is unavailable.");
      const track = savedTrack(source);
      const tracks = [...(this.users.get(userId) || [])];
      const index = tracks.findIndex(item => item.url === track.url);
      if (index < 0 && tracks.length >= FAVOURITES_LIMIT) return "limit";
      if (index >= 0) tracks.splice(index, 1); else tracks.push(track);
      const users = new Map(this.users);
      if (tracks.length) users.set(userId, tracks); else users.delete(userId);
      const temporary = `${this.file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
      try {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        await fs.writeFile(temporary, JSON.stringify({ version: 1, users: Object.fromEntries(users) }, null, 2), { encoding: "utf8", mode: 0o600 });
        await fs.rename(temporary, this.file);
      } catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
      this.users = users;
      return index >= 0 ? "removed" : "added";
    });
    this.chain = operation.catch(() => {});
    return operation;
  }
  flush() { return this.chain; }
}
module.exports = { FavouritesStore, FAVOURITES_LIMIT };
