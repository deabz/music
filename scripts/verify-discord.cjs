const { verifyDiscord } = require("../src/discord-verification");
const args = process.argv.slice(2);
const argument = name => args[args.indexOf(name) + 1];
verifyDiscord({ token: process.env.DISCORD_TOKEN,
  applicationId: args.includes("--application-id") ? argument("--application-id") : undefined,
  guildId: args.includes("--guild-id") ? argument("--guild-id") : process.env.GUILD_ID
}).then(checks => {
  console.log(JSON.stringify({ checks }, null, 2));
  if (checks.some(check => check.status !== "passed")) process.exitCode = 1;
}).catch(() => { console.error("Discord verification failed without diagnostic details; no credentials were logged."); process.exitCode = 1; });
