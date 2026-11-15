function createMentionHandler(getBotId, now = Date.now) {
  const cooldowns = new Map();
  return async message => {
    if (message.author.bot || !message.guild) return;
    const id = getBotId();
    if (!id || !new RegExp(`^<@!?${id}>(?:\\s|$)`).test(message.content)) return;
    const time = now();
    for (const [channel, until] of cooldowns) if (until <= time) cooldowns.delete(channel);
    if (cooldowns.has(message.channelId)) return;
    cooldowns.set(message.channelId, time + 10000);
    await message.reply({
      content: "hey! all my commands are slash commands — type / to see them, or use /help",
      allowedMentions: { parse: [], repliedUser: false }
    }).catch(() => {});
  };
}
module.exports = { createMentionHandler };
