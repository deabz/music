const { randomBytes } = require("node:crypto");
const { resolveSuggestedTracks, searchYouTube } = require("./music-utils");
const trackKey = track => track ? JSON.stringify([track.url, track.title, track.author]) : null;

class PanelSuggestions {
  constructor(state, { search, changed = () => {}, log = console.error } = {}) {
    this.state = state; this.changed = changed; this.log = log;
    this.search = search || ((track, signal) => resolveSuggestedTracks(track, new Set(state.autoplayTriedUrls),
      (query, options) => searchYouTube(query, options.limit, undefined, signal),
      thumbnails => [...(thumbnails || [])].reverse().find(item => item?.url)?.url));
    this.cache = new Map();
  }
  entry(track) {
    const key = trackKey(track);
    if (this.cache.has(key)) return this.cache.get(key);
    const entry = { key, items: null, abort: new AbortController() };
    const prefix = randomBytes(5).toString("hex");
    entry.promise = Promise.resolve().then(() => this.search(track, entry.abort.signal)).then(items => {
      if (entry.abort.signal.aborted) return [];
      entry.items = items.slice(0, 10).map((item, index) => ({ ...item, id: `${prefix}_${index}` }));
      this.publish(entry);
      return entry.items;
    }).catch(error => {
      if (!entry.abort.signal.aborted) this.log(`[suggestions:${this.state.guild?.id}] ${error.message}`);
      entry.items = []; this.publish(entry); return [];
    });
    this.cache.set(key, entry);
    while (this.cache.size > 20) {
      const oldest = this.cache.keys().next().value;
      this.cache.get(oldest).abort.abort(); this.cache.delete(oldest);
    }
    return entry;
  }
  publish(entry) {
    if (entry.abort.signal.aborted || entry.key !== this.activeKey || trackKey(this.state.current) !== entry.key) return;
    this.state.panelSuggestions = entry.items;
    this.changed();
  }
  load(track) {
    const entry = this.entry(track);
    this.activeKey = entry.key;
    this.state.panelSuggestions = entry.items;
    if (entry.items) this.changed();
    return entry.promise;
  }
  candidates(track) { const entry = this.entry(track); return entry.items ? Promise.resolve(entry.items) : entry.promise; }
  take(id) {
    const entry = this.cache.get(this.activeKey);
    const index = entry?.items?.findIndex(item => item.id === id) ?? -1;
    if (index < 0 || trackKey(this.state.current) !== entry.key) return null;
    const [item] = entry.items.splice(index, 1);
    this.publish(entry);
    return item;
  }
  restore(item) {
    const entry = this.cache.get(this.activeKey);
    if (entry?.items && trackKey(this.state.current) === entry.key && !entry.items.some(other => other.id === item.id)) {
      entry.items.push(item); this.publish(entry);
    }
  }
  removeUrl(url) {
    const entry = this.cache.get(this.activeKey);
    if (entry?.items) { entry.items = entry.items.filter(item => item.url !== url); this.publish(entry); }
  }
  clearActive() {
    const entry = this.cache.get(this.activeKey);
    if (entry && !entry.items) { entry.abort.abort(); this.cache.delete(entry.key); }
    this.activeKey = null; this.state.panelSuggestions = [];
  }
  dispose() { for (const entry of this.cache.values()) entry.abort.abort(); this.clearActive(); this.cache.clear(); }
}
module.exports = { PanelSuggestions };
