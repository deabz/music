// Read-only REST verification. Never loads dotenv, logs credentials, registers
// commands, opens a gateway session, or joins a voice channel.
const { PermissionFlagsBits } = require("discord.js");
const REQUIRED_PERMISSIONS = ["ViewChannel", "SendMessages", "EmbedLinks", "ReadMessageHistory", "Connect", "Speak"];
async function verifyDiscord({ token, applicationId, guildId, fetchImpl = fetch } = {}) {
  const checks = [];
  const add = (check, status, detail) => checks.push({ check, status, detail });
  if (!token) { add("authentication", "pending", "DISCORD_TOKEN is not configured"); return checks; }
  if (![applicationId, guildId].every(id => /^\d{17,20}$/.test(id || ""))) {
    add("identifiers", "failed", "Supply numeric application and test guild IDs"); return checks;
  }
  async function get(route) {
    try {
      const response = await fetchImpl(`https://discord.com/api/v10${route}`, {
        headers: { Authorization: "Bot " + token }, signal: AbortSignal.timeout(10000), redirect: "error"
      });
      if (!response.ok) { add(route, "failed", `HTTP ${response.status}`); await response.body?.cancel(); return null; }
      return await response.json();
    } catch { add(route, "failed", "Network error or invalid response"); return null; }
  }
  const bot = await get("/users/@me");
  if (!bot) return checks;
  if (bot.bot !== true || bot.id !== applicationId) {
    add("authentication", "failed", "Authenticated bot does not match the requested application"); return checks;
  }
  add("authentication", "passed", "Bot identity matches requested application");
  const application = await get("/applications/@me");
  if (application) add("application", application.id === applicationId ? "passed" : "failed", "Application identity comparison");
  const guild = await get(`/guilds/${guildId}`);
  if (!guild) return checks;
  add("installation", guild.id === guildId ? "passed" : "failed", "Bot can access requested test guild");
  const member = await get(`/guilds/${guildId}/members/${bot.id}`);
  const roles = await get(`/guilds/${guildId}/roles`);
  if (member && Array.isArray(roles)) {
    try {
      const selected = new Set([guildId, ...(member.roles || [])]);
      const bits = roles.filter(role => selected.has(role.id)).reduce((sum, role) => sum | BigInt(role.permissions), 0n);
      const admin = Boolean(bits & PermissionFlagsBits.Administrator);
      const missing = REQUIRED_PERMISSIONS.filter(name => !admin && !(bits & PermissionFlagsBits[name]));
      add("guild permissions", missing.length ? "failed" : "passed", missing.length ? "Missing: " + missing.join(", ") : "Required guild-level permissions present");
    } catch { add("guild permissions", "failed", "Invalid permission response"); }
  }
  const globals = await get(`/applications/${applicationId}/commands`);
  const scoped = await get(`/applications/${applicationId}/guilds/${guildId}/commands`);
  if (Array.isArray(globals) && Array.isArray(scoped)) {
    const names = new Set([...globals, ...scoped].map(command => command.name));
    const missing = require("./commands").commands.map(command => command.name).filter(name => !names.has(name));
    add("registered commands", missing.length ? "failed" : "passed", `${missing.length} expected commands missing`);
  }
  add("channel overwrites and voice", "pending", "Requires specified text/voice channels and a live Discord session");
  add("gateway intents", "pending", "Offline tests check Guilds/GuildVoiceStates/GuildMessages; gateway identification not attempted");
  return checks;
}
module.exports = { verifyDiscord, REQUIRED_PERMISSIONS };
