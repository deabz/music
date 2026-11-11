const fs = require("fs/promises");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = Boolean(process.env.SUPABASE_URL && supabaseKey);
const musicStateFile = path.resolve(process.env.MUSIC_STATE_FILE || "data/music-state.json");
const savedSnapshots = new Map();
let supabase = null;
let fileGuilds = {};
let loaded = false;

console.log(`[persistence] Using ${useSupabase ? "Supabase music_state table" : `JSON file: ${musicStateFile}`}.`);

function getSupabase() {
  if (!supabase) {
    supabase = createClient(process.env.SUPABASE_URL, supabaseKey, {
      auth: { persistSession: false }
    });
  }
  return supabase;
}

async function loadAll() {
  loaded = false;
  if (useSupabase) {
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await getSupabase().from("music_state")
        .select("guild_id, state").order("guild_id").range(offset, offset + pageSize - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < pageSize) break;
    }
    const guilds = Object.fromEntries(rows.map(row => [row.guild_id, row.state]));
    savedSnapshots.clear();
    for (const [guildId, snapshot] of Object.entries(guilds)) {
      savedSnapshots.set(guildId, JSON.stringify(snapshot));
    }
    loaded = true;
    return guilds;
  }

  try {
    const parsed = JSON.parse(await fs.readFile(musicStateFile, "utf8"));
    if (parsed.version !== 1 || !parsed.guilds || typeof parsed.guilds !== "object" || Array.isArray(parsed.guilds)) {
      throw new Error("Unsupported or invalid music state file format.");
    }
    fileGuilds = parsed.guilds;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    fileGuilds = {};
  }
  loaded = true;
  return fileGuilds;
}

async function saveGuilds(snapshotsByGuildId) {
  if (!loaded) return;
  if (useSupabase) {
    try {
      const changed = Object.entries(snapshotsByGuildId)
        .map(([guildId, snapshot]) => [guildId, JSON.stringify(snapshot)])
        .filter(([guildId, serialized]) => savedSnapshots.get(guildId) !== serialized);
      if (!changed.length) return;
      const updatedAt = new Date().toISOString();
      const rows = changed.map(([guildId, serialized]) => ({
        guild_id: guildId,
        state: JSON.parse(serialized),
        updated_at: updatedAt
      }));
      const { error } = await getSupabase().from("music_state").upsert(rows, { onConflict: "guild_id" });
      if (error) throw error;
      for (const [guildId, serialized] of changed) savedSnapshots.set(guildId, serialized);
    } catch (error) {
      console.error(`[persistence] Could not save music state to Supabase: ${error.message}`);
    }
    return;
  }

  const content = JSON.stringify({ version: 1, guilds: snapshotsByGuildId }, null, 2);
  await fs.mkdir(path.dirname(musicStateFile), { recursive: true });
  const temporaryFile = `${musicStateFile}.${process.pid}.tmp`;
  await fs.writeFile(temporaryFile, content, "utf8");
  await fs.rename(temporaryFile, musicStateFile);
  fileGuilds = JSON.parse(content).guilds;
}

async function deleteGuild(guildId) {
  if (!loaded) return;
  if (useSupabase) {
    try {
      const { error } = await getSupabase().from("music_state").delete().eq("guild_id", guildId);
      if (error) throw error;
      savedSnapshots.delete(guildId);
    } catch (error) {
      console.error(`[persistence] Could not delete guild state from Supabase: ${error.message}`);
    }
    return;
  }
  const guilds = { ...fileGuilds };
  delete guilds[guildId];
  await saveGuilds(guilds);
}

module.exports = { loadAll, saveGuilds, deleteGuild };
