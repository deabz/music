
const PANEL_PREFIX = "panel:";
const PANEL_SUGGESTION_COUNT = 5;
const short = (value, limit) => {
  const text = String(value || "Unknown track").replace(/[\u0000-\u001f\u007f]+/g, " ");
  if (text.length <= limit) return text;
  let result = "";
  for (const character of text) { if (result.length + character.length > limit - 1) break; result += character; }
  return result + "\u2026";
};
const markdown = value => String(value).replace(/[\\[\]()*_~`|]/g, "\\$&");
const escapePanelText = value => markdown(value).replace(/@(?=everyone\b|here\b|[!&]?\d+)/gi, "@\u200b");
function trackLink(track) {
  const title = escapePanelText(short(track.title, 50));
  try {
    const url = new URL(track.url);
    if (!["http:", "https:"].includes(url.protocol) || url.href.length > 600) return title;
    const href = url.href.replace(/[()[\]\\<>]/g, character => "%" + character.charCodeAt(0).toString(16));
    return `[${title}](${href})`;
  } catch { return title; }
}
function duration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
function requester(track) {
  if (track.autoSuggested || !track.requestedById || track.requestedById === "system") return "Autoplay";
  if (track.requestedById === "dashboard") return "Dashboard";
  return /^\d{17,20}$/.test(track.requestedById) ? `<@${track.requestedById}>` : "Discord user";
}
const BUTTONS = [
  [["play", "Play", "\u25B6\uFE0F"], ["previous", "Previous", "\u23EE\uFE0F"], ["pause", "Pause", "\u23F8\uFE0F"], ["next", "Next", "\u23ED\uFE0F"], ["loop", "Loop", "\uD83D\uDD01"]],
  [["vol-down", "Volume down", "\uD83D\uDD09"], ["rewind", "Rewind 10s", "\u23EA"], ["favourite", "Favourite", "\u2764\uFE0F"], ["forward", "Forward 10s", "\u23E9"], ["vol-up", "Volume up", "\uD83D\uDD0A"]],
  [["lyrics", "Lyrics", "\uD83C\uDFA4"], ["shuffle", "Shuffle", "\uD83D\uDD00"], ["stop", "Stop", "\u23F9\uFE0F"], ["effects", "Effects", "\uD83D\uDD3D"], ["favourites", "My favourites", "\uD83E\uDDD1\u200D\uD83C\uDFA4"]]
];

// Pure Discord API payload: no message fetches, timers, or mutation.
function buildPlayerPanel(state, { avatarUrl } = {}) {
  const queue = state.queue || [];
  const tracks = [...(state.current ? [state.current] : []), ...queue];
  const lines = state.current
    ? [`${trackLink(state.current)} - [\`${duration(state.current.duration)}\`],`, `*Requested by -* ${requester(state.current)}`]
    : ["Nothing is playing."];
  let shown = 0;
  if (queue.length) {
    lines.push("", "**Up Next:**");
    for (const track of queue.slice(0, 10)) {
      const title = escapePanelText(short(track.title, 40));
      const line = `\`${shown + 1}.\` **${title}** \u2014 [\`${duration(track.duration)}\`] \u2014 ${requester(track)}`;
      if ([...lines, line].join("\n").length > 3900) break;
      lines.push(line); shown++;
    }
    if (queue.length > shown) lines.push(`...and ${queue.length - shown} more`);
  }
  const embed = { title: `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"} in queue`,
    description: lines.join("\n"), color: 0xE6B655,
    footer: { text: `Volume: ${state.volume ?? 80}`, ...(avatarUrl ? { icon_url: avatarUrl } : {}) } };
  const suggestions = (state.panelSuggestions || []).slice(0, Math.min(25, PANEL_SUGGESTION_COUNT));
  const options = suggestions.length ? suggestions.map(item => ({ label: short(item.title, 100),
    description: short(item.channel?.name || item.author || "Unknown channel", 100 - ` - youtube - ${duration(item.duration)}`.length)
      + ` - youtube - ${duration(item.duration)}`, value: item.id }))
    : [{ label: !state.current ? "Nothing is playing" : state.panelSuggestions == null ? "Loading suggestions..." : "No suggestions available", value: "none" }];
  const components = [{ type: 1, components: [{ type: 3, custom_id: "panel:suggest", placeholder: "Select a suggested song",
    min_values: 1, max_values: 1, disabled: !state.current || !suggestions.length, options }] }];
  const status = state.player?.state?.status;
  for (const row of BUTTONS) components.push({ type: 1, components: row.map(([action, label, emoji]) => {
    let disabled = !state.current;
    if (action === "play") disabled = !state.current || status !== "paused";
    if (action === "pause") disabled = !state.current || status !== "playing";
    if (["vol-down", "vol-up", "favourites", "lyrics"].includes(action)) disabled = false;
    if (action === "shuffle") disabled = queue.length < 2;
    if (["stop", "loop"].includes(action)) disabled = !tracks.length;
    return { type: 2, custom_id: PANEL_PREFIX + action, label, style: action === "loop" && (state.loop || "off") !== "off" ? 3 : 2,
      emoji: { name: action === "loop" && state.loop === "track" ? "\uD83D\uDD02" : emoji }, disabled };
  }) });
  return { embeds: [embed], components, allowedMentions: { parse: [], users: [], roles: [], repliedUser: false } };
}

class PlayerPanel {
  constructor(state, { getChannel, avatarUrl, onIdentity = () => {}, log = console.error,
    setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    Object.assign(this, { state, getChannel, avatarUrl, onIdentity, log, setTimer, clearTimer });
    this.chain = Promise.resolve();
    this.blocked = false;
    this.disposed = false;
  }
  identity(channelId, messageId) {
    if (this.state.panelChannelId === channelId && this.state.panelMessageId === messageId) return;
    this.state.panelChannelId = channelId;
    this.state.panelMessageId = messageId;
    this.onIdentity();
  }
  wake() { if (this.blocked) this.signature = null; this.blocked = false; this.scheduleUpdate(); }
  scheduleUpdate() {
    if (this.disposed || this.blocked || !this.state.panelChannelId) return;
    if (JSON.stringify(buildPlayerPanel(this.state, { avatarUrl: this.avatarUrl?.() })) === this.signature) return;
    this.clearTimer(this.timer);
    this.timer = this.setTimer(() => { this.timer = null; void this.flush(); }, 800);
    this.timer?.unref?.();
  }
  serialize(operation) {
    this.chain = this.chain.then(async () => {
      if (this.disposed || this.blocked) return null;
      try { return await operation(); }
      catch (error) {
        this.blocked = true;
        this.log(`[panel:${this.state.guild?.id}] Update failed; waiting for an explicit command: ${error.stack || error.message}`);
        return null;
      }
    });
    return this.chain;
  }
  flush(create = true) {
    this.clearTimer(this.timer); this.timer = null;
    return this.serialize(() => this.update(create));
  }
  async update(create) {
    const channelId = this.state.panelChannelId;
    if (!channelId) return null;
    const channel = await this.getChannel(channelId);
    if (this.disposed) return null;
    if (!channel?.send || !channel.messages?.fetch) throw new Error("Panel channel is unavailable.");
    let message = null;
    if (this.state.panelMessageId) {
      try { message = await channel.messages.fetch(this.state.panelMessageId); }
      catch (error) { if (error.code !== 10008) throw error; }
      if (message && message.author?.id && message.author.id !== this.state.guild?.client?.user?.id) throw new Error("Stored panel is not owned by this bot.");
      if (!message) {
        this.signature = create ? null : JSON.stringify(buildPlayerPanel(this.state, { avatarUrl: this.avatarUrl?.() }));
        this.identity(channelId, null);
      }
    }
    if (this.disposed) return null;
    const payload = buildPlayerPanel(this.state, { avatarUrl: this.avatarUrl?.() });
    const signature = JSON.stringify(payload);
    if (message) {
      if (signature === this.signature) return message;
      try { await message.edit(payload); }
      catch (error) {
        if (error.code !== 10008) throw error;
        this.signature = create ? null : signature;
        this.identity(channelId, null);
        return create ? this.send(channel, payload, signature) : null;
      }
      this.signature = signature;
      return message;
    }
    return create ? this.send(channel, payload, signature) : null;
  }
  async send(channel, payload, signature) {
    if (this.disposed) return null;
    const message = await channel.send(payload);
    if (this.disposed) { await message.delete().catch(() => {}); return null; }
    this.signature = signature;
    this.identity(channel.id, message.id);
    return message;
  }
  ensure(channelId) {
    this.blocked = false;
    return this.serialize(async () => {
      if (!this.state.panelChannelId) this.identity(channelId, null);
      return this.update(true);
    });
  }
  move(channelId) {
    this.blocked = false;
    this.clearTimer(this.timer);
    return this.serialize(async () => {
      if (this.state.panelChannelId && this.state.panelMessageId) {
        const oldChannel = await this.getChannel(this.state.panelChannelId);
        try { await (await oldChannel.messages.fetch(this.state.panelMessageId)).delete(); }
        catch (error) { if (error.code !== 10008) throw error; }
      }
      this.identity(channelId, null); this.signature = null;
      return this.update(true);
    });
  }
  reattach() { this.signature = null; return this.flush(false); }
  dispose() { this.disposed = true; this.clearTimer(this.timer); }
}
function createPlayerPanel(state, onIdentity) {
  return new PlayerPanel(state, { getChannel: id => state.guild.channels.fetch(id),
    avatarUrl: () => state.guild.client.user?.displayAvatarURL(), onIdentity });
}
function buildEffectsMenu(state, userId) {
  return [{ type: 1, components: [{ type: 3, custom_id: `panel:effects-apply:${userId}`,
    placeholder: "Choose audio effects", min_values: 0, max_values: 4,
    options: [["bassboost", "Bass boost"], ["eightd", "8D"], ["nightcore", "Nightcore"], ["echo", "Echo"]]
      .map(([value, label]) => ({ label, value, default: Boolean(state.audioFilters?.[value]) })) }] }];
}
function buildFavouritesMenu(tracks, userId) {
  return [{ type: 1, components: [{ type: 3, custom_id: `panel:favourites-select:${userId}`,
    placeholder: "Choose a favourite", min_values: 1, max_values: 1,
    options: tracks.slice(0, 25).map(track => ({ value: track.id, label: short(track.title, 100),
      description: short(`${track.author} - ${duration(track.duration)}`, 100) })) }] }];
}
function buildPlayConfirmation(tracks) {
  return { content: tracks.length === 1 ? `**${escapePanelText(short(tracks[0].title, 100))}** added to the queue`
    : `**${tracks.length} tracks** added to the queue`,
  ephemeral: false, allowedMentions: { parse: [], users: [], roles: [], repliedUser: false } };
}
module.exports = { buildPlayerPanel, PlayerPanel, createPlayerPanel, buildEffectsMenu, buildFavouritesMenu, buildPlayConfirmation, PANEL_PREFIX, PANEL_SUGGESTION_COUNT, short, escapePanelText };
