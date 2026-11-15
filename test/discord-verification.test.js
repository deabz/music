const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { verifyDiscord, REQUIRED_PERMISSIONS } = require("../src/discord-verification");
const { PermissionFlagsBits, GatewayIntentBits, IntentsBitField } = require("discord.js");
const applicationId = "1552484084243234848", guildId = "1114203697619152926";
function fixture({ permission = true, commands = true, failure = false } = {}) {
  const token = randomBytes(32).toString("hex"), calls = [];
  const options = { token, applicationId, guildId, fetchImpl: async (url, request) => {
    calls.push(url); assert.equal(request.headers.Authorization, "Bot " + token);
    assert.equal(request.redirect, "error");
    if (failure) return { ok: false, status: 403, body: { cancel: async () => {} }, json: () => assert.fail("Do not read potentially sensitive error response") };
    const route = new URL(url).pathname.replace("/api/v10", "");
    let body;
    if (route === "/users/@me") body = { id: applicationId, bot: true };
    else if (route === "/applications/@me") body = { id: applicationId };
    else if (route.endsWith("/roles")) body = [{ id: guildId, permissions: String(permission ? REQUIRED_PERMISSIONS.reduce((bits, name) => bits | PermissionFlagsBits[name], 0n) : 0n) }];
    else if (route.includes("/members/")) body = { roles: [] };
    else if (route.endsWith("/commands")) body = commands ? require("../src/commands").commands : [];
    else body = { id: guildId };
    return { ok: true, json: async () => body };
  } };
  return { options, token, calls };
}
test("Discord verification without credentials stays pending and makes no request", async () => {
  const checks = await verifyDiscord({ applicationId, guildId, fetchImpl: () => assert.fail() });
  assert.equal(checks[0].status, "pending");
});
test("read-only Discord verifier checks identity, installation, roles and registration without leaking credentials", async () => {
  const { options, token, calls } = fixture(); const checks = await verifyDiscord(options);
  assert.equal(checks.filter(check => check.status === "passed").length, 5);
  assert.ok(!checks.some(check => check.status === "failed"));
  assert.equal(calls.length, 7); assert.ok(!JSON.stringify(checks).includes(token));
  assert.equal(checks.filter(check => check.status === "pending").length, 2);
});
test("Discord verifier reports denied access without reading or logging the response body", async () => {
  const { options, token, calls } = fixture({ failure: true }); const checks = await verifyDiscord(options);
  assert.equal(calls.length, 1); assert.equal(checks[0].detail, "HTTP 403"); assert.ok(!JSON.stringify(checks).includes(token));
});
test("missing permissions and commands fail rather than claiming release readiness", async () => {
  const { options } = fixture({ permission: false, commands: false }); const checks = await verifyDiscord(options);
  assert.equal(checks.filter(check => check.status === "failed").length, 2);
});
test("real bot intents contain the voice and message requirements without privileged intents", () => {
  const source = require("node:fs").readFileSync(require.resolve("../src/index"), "utf8");
  const match = source.match(/const client = new Client\(\{\s*intents:\s*(\[[\s\S]*?\])/);
  assert.ok(match);
  const intents = new IntentsBitField(require("node:vm").runInNewContext(match[1], { GatewayIntentBits }));
  for (const flag of [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages]) assert.ok(intents.has(flag));
  assert.ok(!intents.has(GatewayIntentBits.MessageContent)); assert.ok(!intents.has(GatewayIntentBits.GuildMembers));
});
