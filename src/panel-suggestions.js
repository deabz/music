const { randomBytes } = require("node:crypto");
const { AutoplayCandidates, rankAutoplayCandidates, limitSuggestionArtists, MIX_CACHE_TTL_MS } = require("./autoplay-candidates");
const trackKey = track => track ? JSON.stringify([track.url, track.title, track.author]) : null;

class PanelSuggestions {
  constructor(state, { search, provider, changed = () => {}, log = console.error } = {}) {
    this.state = state; this.changed = changed; this.log = log;
    this.provider = provider || (!search ? new AutoplayCandidates(state, { log }) : null);
    this.search = search || ((track, signal) => this.provider.list(track, signal));
    this.cache = new Map();
  }
  entry(track) {
    const key = trackKey(track);
    if (this.cache.has(key) && Date.now() - this.cache.get(key).createdAt < MIX_CACHE_TTL_MS) return this.cache.get(key);
    this.cache.get(key)?.abort.abort(); this.cache.delete(key);
    const entry = { key, track, createdAt: Date.now(), items: null, abort: new AbortController() };
    const prefix = randomBytes(5).toString("hex");
    entry.promise = Promise.resolve().then(() => this.search(track, entry.abort.signal)).then(items => {
      if (entry.abort.signal.aborted) return [];
      entry.items = items.slice(0, 50).map((item, index) => ({ ...item, id: `${prefix}_${index}` }));
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
    const filtered = entry.items && this.filtered(entry.items, entry.track);
    if (JSON.stringify(this.state.panelSuggestions) === JSON.stringify(filtered)) return;
    this.state.panelSuggestions = filtered;
    this.changed();
  }
  load(track) {
    if (this.activeKey !== trackKey(track)) {
      const previous = this.cache.get(this.activeKey);
      if (previous && !previous.items) { previous.abort.abort(); this.cache.delete(previous.key); }
    }
    const entry = this.entry(track);
    this.activeKey = entry.key;
    this.publish(entry);
    return entry.promise;
  }
  filtered(items, track) { return limitSuggestionArtists(rankAutoplayCandidates(items, this.state, track)); }
  async candidates(track) { const entry = this.entry(track); return this.filtered(entry.items || await entry.promise, track); }
  refresh() { const entry = this.cache.get(this.activeKey); if (entry) this.publish(entry); }
  take(id) {
    const entry = this.cache.get(this.activeKey);
    const eligible = entry?.items && this.filtered(entry.items, entry.track).some(item => item.id === id);
    const index = eligible ? entry.items.findIndex(item => item.id === id) : -1;
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
    for (const entry of this.cache.values()) if (!entry.items) { entry.abort.abort(); this.cache.delete(entry.key); }
    this.provider?.cancel();
    this.activeKey = null; this.state.panelSuggestions = [];
  }
  dispose() { for (const entry of this.cache.values()) entry.abort.abort(); this.clearActive(); this.cache.clear(); this.provider?.dispose(); }
}
module.exports = { PanelSuggestions };
