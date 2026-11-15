const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require("discord.js");

const QUEUE_PAGE_SIZE = 10;

const commands = [
  new SlashCommandBuilder().setName("bassboost").setDescription("Toggle bass boost for the current track."),
  new SlashCommandBuilder().setName("eightd").setDescription("Toggle 8D audio for the current track."),
  new SlashCommandBuilder().setName("nightcore").setDescription("Toggle nightcore mode for the current track."),
  new SlashCommandBuilder().setName("echo").setDescription("Toggle echo for the current track."),
  new SlashCommandBuilder().setName("play").setDescription("Play YouTube searches and YouTube or Spotify tracks, albums, and playlists.")
    .addStringOption(o => o.setName("query").setDescription("YouTube or Spotify link, or search terms").setRequired(true)),
  new SlashCommandBuilder().setName("ping").setDescription("Check the bot's gateway latency."),
  new SlashCommandBuilder().setName("uptime").setDescription("Show how long the bot has been running."),
  new SlashCommandBuilder().setName("pause").setDescription("Pause the track currently playing."),
  new SlashCommandBuilder().setName("resume").setDescription("Resume paused playback."),
  new SlashCommandBuilder().setName("skip").setDescription("Skip the current track and play the next one."),
  new SlashCommandBuilder().setName("stop").setDescription("Stop playback and clear the queue."),
  new SlashCommandBuilder().setName("leave").setDescription("Stop playback and disconnect from voice."),
  new SlashCommandBuilder().setName("queue").setDescription("View the current track and upcoming queue."),
  new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle the tracks waiting in the queue."),
  new SlashCommandBuilder().setName("nowplaying").setDescription("Show the track currently playing."),
  new SlashCommandBuilder().setName("volume").setDescription("Set playback volume from 0 to 200 percent.")
    .addIntegerOption(o => o.setName("percent").setDescription("Playback volume percentage").setRequired(true).setMinValue(0).setMaxValue(200)),
  new SlashCommandBuilder().setName("volup").setDescription("Increase volume by 10%."),
  new SlashCommandBuilder().setName("voldown").setDescription("Decrease volume by 10%."),
  new SlashCommandBuilder().setName("loop").setDescription("Choose whether to repeat a track or the queue.")
    .addStringOption(o => o.setName("mode").setDescription("Playback repeat mode").setRequired(true)
      .addChoices({ name: "Off", value: "off" }, { name: "Track", value: "track" }, { name: "Queue", value: "queue" })),
  new SlashCommandBuilder().setName("remove").setDescription("Remove a song from the queue.")
    .addIntegerOption(o => o.setName("position").setDescription("The position of the song to remove").setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName("forward").setDescription("Fast forward the current track.")
    .addStringOption(o => o.setName("time").setDescription("Time to forward (e.g. 10 or 1:30)").setRequired(false)),
  new SlashCommandBuilder().setName("lyrics").setDescription("Show the currently playing song's lyrics link."),
  new SlashCommandBuilder().setName("move").setDescription("Move a track in the queue.")
    .addIntegerOption(o => o.setName("from").setDescription("Current position").setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName("to").setDescription("New position").setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName("clear").setDescription("Clear the entire queue."),
  new SlashCommandBuilder().setName("search").setDescription("Search for a song and pick the result.")
    .addStringOption(o => o.setName("query").setDescription("Song name").setRequired(true)),
  new SlashCommandBuilder().setName("stats").setDescription("Show bot statistics."),
  new SlashCommandBuilder().setName("set-notification-channel").setDescription("Set the channel for music notifications.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .addChannelOption(o => o.setName("channel").setDescription("Channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)),
  new SlashCommandBuilder().setName("join").setDescription("Connect to the voice channel you are currently in."),
  new SlashCommandBuilder().setName("247").setDescription("Connect to the configured voice channel and stay connected.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString()),
  new SlashCommandBuilder().setName("help").setDescription("Browse the command guide by category.")
    .addStringOption(o => o.setName("category").setDescription("Choose a command category")
      .addChoices(
        { name: "All commands", value: "all" },
        { name: "Info", value: "info" },
        { name: "Playback", value: "playback" },
        { name: "Queue", value: "queue" },
        { name: "Audio effects", value: "effects" }
      ))
].map(command => command.toJSON());

const helpCategories = [
  { name: "Playback", value: "playback", description: "Play music and manage voice and volume.", commands: ["play", "pause", "resume", "skip", "stop", "nowplaying", "lyrics", "forward", "volume", "volup", "voldown", "join", "leave", "247"] },
  { name: "Queue", value: "queue", description: "Build your shared queue.", commands: ["queue", "shuffle", "loop", "remove", "move", "clear", "search"] },
  { name: "Audio effects", value: "effects", description: "Shape your sound.", commands: ["bassboost", "eightd", "nightcore", "echo"] },
  { name: "Info", value: "info", description: "Bot information and notifications.", commands: ["help", "ping", "uptime", "stats", "set-notification-channel"] }
];

// Website groups are derived from the registered slash definitions and help metadata.
const websiteCommandGroups = [
  ["playback", "Playback"], ["queue", "Queue"], ["effects", "Audio effects"],
  ["info", "Info and utility"], ["settings", "Settings"]
].map(([id, label]) => ({
  id, label,
  commands: commands.filter(command => {
    const name = command.name;
    const category = ["volume", "volup", "voldown", "set-notification-channel"].includes(name)
      ? "settings"
      : ["join", "leave", "247"].includes(name) ? "info"
        : helpCategories.find(group => group.commands.includes(name))?.value || "info";
    return category === id;
  })
}));

const buildHelpEmbed = category => {
  const selectedCategories = category === "all"
    ? helpCategories
    : helpCategories.filter(item => item.value === category);
  const commandByName = new Map(commands.map(command => [command.name, command]));
  const fields = selectedCategories.map(item => ({
    name: item.name,
    value: item.commands.map(name => {
      const command = commandByName.get(name);
      if (!command) return `\`/${name}\` — Command not found`;

      const options = command.options?.map(option => option.required ? `<${option.name}>` : `[${option.name}]`).join(" ") || "";
      return `\`/${command.name}${options ? ` ${options}` : ""}\` — ${command.description}`;
    }).join("\n"),
    inline: false
  }));

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(category === "all" ? "Music | Command guide" : `Music | ${selectedCategories[0].name}`)
    .setDescription(category === "all"
      ? "Use slash commands in Discord. Choose a category with `/help category:<category>`."
      : selectedCategories[0].description)
    .addFields(fields)
    .setFooter({ text: "Command options shown in angle brackets are required." })
    .setTimestamp();
};

const buildPlaybackEmbed = ({ user, title, track, queuedCount }) => {
  const embed = new EmbedBuilder()
    .setColor(0x000000)
    .setTitle(title)
    .setAuthor({
      name: user.globalName || user.username,
      iconURL: user.displayAvatarURL({ size: 128 })
    })
    .addFields(
      { name: "Track", value: (track?.title || "No track is currently playing.").slice(0, 1024) },
      { name: "Artist", value: (track?.author || "Not available").slice(0, 1024), inline: true },
      { name: "When", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
    )
    .setTimestamp();

  if (queuedCount > 1) {
    embed.addFields({ name: "Added", value: `${queuedCount} tracks`, inline: true });
  }
  if (user.displayAvatarURL) {
    embed.setThumbnail(user.displayAvatarURL({ size: 256 }));
  }
  return embed;
};

const requesterLabel = track => {
  const requesterId = track?.requestedById;
  if (requesterId === "dashboard") return "Dashboard";
  if (!requesterId || requesterId === "system") return "Autoplay";
  return `<@${requesterId}>`;
};

const buildQueueEmbed = ({ current, queue, playbackStatus, page = 0 }) => {
  const tracks = queue;
  const pageCount = Math.max(1, Math.ceil(tracks.length / QUEUE_PAGE_SIZE));
  const currentPage = Math.max(0, Math.min(page, pageCount - 1));
  const pageTracks = tracks.slice(currentPage * QUEUE_PAGE_SIZE, (currentPage + 1) * QUEUE_PAGE_SIZE);
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle("Music queue")
    .setTimestamp()
    .setFooter({
      text: `${tracks.length} track${tracks.length === 1 ? "" : "s"} • Page ${currentPage + 1}/${pageCount}`
    });

  if (current) {
    embed.addFields({ name: "Now playing", value: `**${(current.title || "Unknown track").slice(0, 180)}**\n${(current.author || "Unknown artist").slice(0, 120)} · ${playbackStatus} · Played by ${requesterLabel(current)}` });
  }
  if (!pageTracks.length) {
    embed.setDescription("The queue is empty. Add a song with `/play`.");
  } else {
    embed.setDescription(pageTracks.map((track, index) => {
      const number = currentPage * QUEUE_PAGE_SIZE + index + 1;
      const title = (track.title || "Unknown track").replace(/[\r\n]+/g, " ").slice(0, 180);
      const artist = (track.author || "Unknown artist").replace(/[\r\n]+/g, " ").slice(0, 120);
      const label = track.isCurrent ? "NOW PLAYING" : `#${number}`;
      const status = track.isCurrent ? ` · ${track.playbackStatus}` : "";
      return `**${label}**${status}\n**${title}**\n${artist} · Played by ${requesterLabel(track)}`;
    }).join("\n\n"));
  }

  if (current?.thumbnail) embed.setThumbnail(current.thumbnail);
  return embed;
};

const buildQueueComponents = ({ current, queue, page = 0 }) => {
  const pageCount = Math.max(1, Math.ceil(queue.length / QUEUE_PAGE_SIZE));
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("queue:previous")
      .setLabel("◀")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId("queue:next")
      .setLabel("▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pageCount - 1)
  )];
};

const formatDuration = seconds => {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
};

const buildNowPlayingEmbed = ({
  track,
  elapsedSeconds = 0,
  status = "idle",
  title = "Now playing",
  queuedCount,
  queuedSummary,
  requester
}) => {
  const duration = Number.isFinite(track?.duration) && track.duration > 0
    ? `${formatDuration(elapsedSeconds)} / ${formatDuration(track.duration)}`
    : `${formatDuration(elapsedSeconds)} elapsed`;
  const progress = track?.duration > 0
    ? ` (${Math.min(100, Math.floor(elapsedSeconds / track.duration * 100))}%)`
    : "";

  const embed = new EmbedBuilder()
    .setColor(0x000000)
    .setTitle(title)
    .setAuthor({ name: "Music bot" })
    .addFields(
      { name: "Track", value: track?.title?.slice(0, 1024) || "Nothing is playing." },
      { name: "Artist", value: track?.author?.slice(0, 1024) || "Not available", inline: true },
      { name: "Position", value: `${duration}${progress}`, inline: true },
      { name: "Playback", value: status },
      { name: "Requested by", value: requester || "Unknown", inline: true }
    )
    .setTimestamp(track ? new Date(Date.now() - elapsedSeconds * 1000) : new Date());

  if (queuedSummary) {
    embed.addFields({ name: "Added to queue", value: queuedSummary.slice(0, 1024), inline: true });
  } else if (queuedCount > 1) {
    embed.addFields({ name: "Added to queue", value: `${queuedCount} tracks`, inline: true });
  }
  if (track?.thumbnail) {
    embed.setThumbnail(track.thumbnail);
  }
  return embed;
};

const buildStatsEmbed = (state, uptime) => {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle("Bot Statistics")
    .addFields(
      { name: "Queue Length", value: `${state.queue.length} tracks`, inline: true },
      { name: "Total Played", value: `${state.totalTracksPlayed} tracks`, inline: true },
      { name: "Uptime", value: uptime, inline: true }
    )
    .setTimestamp();
};

module.exports = {
  websiteCommandGroups,
  buildHelpEmbed,
  buildNowPlayingEmbed,
  buildPlaybackEmbed,
  buildQueueComponents,
  buildQueueEmbed,
  buildStatsEmbed,
  formatDuration,
  QUEUE_PAGE_SIZE,
  commands,
  requesterLabel
};
