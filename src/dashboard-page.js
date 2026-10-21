const dashboardPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#09090d">
  <title>Nyx — Music controls</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; background: #09090d; color: #f6f4fb; --muted: #aaa6b7; --line: #ffffff18; --purple: #b49aff; }
    * { box-sizing: border-box; }
    body { min-width: 320px; min-height: 100vh; margin: 0; background: radial-gradient(ellipse at 80% 0, #6139a626, transparent 36rem), #09090d; }
    button, input, select { font: inherit; }
    button, select, input { color: inherit; }
    button, select, input[type="text"], input[type="password"], input[type="number"] { min-height: 42px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 10px; background: #111117; }
    button { cursor: pointer; font-weight: 650; }
    button:hover:not(:disabled) { border-color: #b49aff88; background: #b49aff16; }
    button:disabled { cursor: not-allowed; opacity: .45; }
    button.primary { border-color: #c4adff55; background: linear-gradient(120deg, #9b7be8, #7555c8); }
    button.danger { color: #ff9ba4; }
    input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--purple); outline-offset: 2px; }
    .shell { width: min(1050px, calc(100% - 36px)); margin: 0 auto; }
    header { min-height: 76px; display: flex; align-items: center; justify-content: space-between; gap: 18px; border-bottom: 1px solid var(--line); }
    .brand { color: white; font-size: 1.1rem; font-weight: 750; text-decoration: none; letter-spacing: -.04em; }
    .brand span { color: var(--purple); }
    header nav { display: flex; align-items: center; gap: 18px; }
    header a:not(.brand) { color: #c5c1d0; font-size: .88rem; text-decoration: none; }
    main { padding: 42px 0 68px; }
    h1 { margin: 0; font-size: clamp(2rem, 5vw, 3rem); letter-spacing: -.06em; }
    .intro { margin: 8px 0 26px; color: var(--muted); line-height: 1.6; }
    .panel { margin-top: 16px; padding: 22px; border: 1px solid var(--line); border-radius: 16px; background: linear-gradient(145deg, #ffffff09, #ffffff03); }
    .auth { max-width: 540px; }
    .auth-row, .toolbar, .row, .track-head, .queue-item { display: flex; align-items: center; gap: 10px; }
    .auth-row input { flex: 1; min-width: 0; }
    .toolbar { flex-wrap: wrap; justify-content: space-between; }
    .toolbar select { min-width: min(100%, 280px); flex: 1; }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, .75fr); align-items: start; gap: 16px; margin-top: 16px; }
    .grid .panel { margin-top: 0; }
    h2 { margin: 0 0 18px; font-size: 1.1rem; letter-spacing: -.025em; }
    h3 { overflow: hidden; margin: 0; font-size: 1rem; text-overflow: ellipsis; white-space: nowrap; }
    .muted { color: var(--muted); font-size: .85rem; }
    .track-head { align-items: flex-start; justify-content: space-between; }
    .track-main { min-width: 0; display: flex; align-items: center; gap: 14px; }
    .track-artwork { width: 88px; height: 88px; flex: 0 0 auto; border: 1px solid var(--line); border-radius: 12px; background: linear-gradient(135deg, #352b50, #171821); object-fit: cover; }
    .track-meta { min-width: 0; }
    .track-meta p { margin: 6px 0 0; color: var(--muted); font-size: .87rem; }
    .track-meta .requester { font-size: .78rem; }
    .time-row { display: flex; justify-content: space-between; margin: 19px 0 8px; color: var(--muted); font-size: .78rem; font-variant-numeric: tabular-nums; }
    input[type="range"] { width: 100%; accent-color: var(--purple); cursor: pointer; }
    .controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 15px; }
    .settings { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 19px; }
    label { display: grid; gap: 8px; color: #d6d2df; font-size: .82rem; }
    label select, label input { width: 100%; }
    .queue { display: grid; max-height: min(65vh, 640px); gap: 9px; overflow-y: auto; overscroll-behavior: contain; padding: 1px 5px 1px 1px; scrollbar-color: #65538c #111117; scrollbar-width: thin; }
    .queue-item { min-width: 0; justify-content: space-between; align-items: flex-start; gap: 8px; padding: 12px; border: 1px solid var(--line); border-radius: 11px; background: #0c0c11; }
    .queue-copy { min-width: 0; flex: 1; }
    .queue-copy strong { display: block; overflow-wrap: anywhere; font-size: .87rem; line-height: 1.4; }
    .queue-copy span { display: block; margin-top: 5px; color: var(--muted); font-size: .77rem; line-height: 1.45; overflow-wrap: anywhere; }
    .queue-actions { display: flex; flex: 0 0 auto; gap: 5px; }
    .queue-actions button { min-height: 33px; padding: 5px 8px; }
    .add-row { display: flex; gap: 8px; margin-top: 13px; }
    .add-row input { min-width: 0; flex: 1; }
    .notice { min-height: 22px; margin-top: 13px; color: #d0c1ff; font-size: .84rem; }
    .notice.error { color: #ff9ba4; }
    .footnote { margin: 20px 0 0; color: #817d8e; font-size: .77rem; line-height: 1.6; }
    [hidden] { display: none !important; }
    @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
    @media (max-width: 500px) { .shell { width: calc(100% - 28px); } main { padding-top: 30px; } .panel { padding: 17px; } .settings { grid-template-columns: 1fr; } .auth-row, .add-row { align-items: stretch; flex-direction: column; } .auth-row button, .add-row button { width: 100%; } header nav { gap: 11px; } }
  </style>
</head>
<body>
  <header class="shell">
    <a class="brand" href="/">nyx<span>.</span></a>
    <nav><a href="/">Home</a><a href="/api/health">Public status</a></nav>
  </header>
  <main class="shell">
    <h1>Music controls</h1>
    <p class="intro">Manage live playback and queues for your Discord servers.</p>
    <section id="login" class="panel auth">
      <h2>Dashboard access</h2>
      <p class="muted">Enter the access token configured by the bot owner. It is kept only for this browser tab.</p>
      <form id="login-form" class="auth-row">
        <input id="token" type="password" autocomplete="current-password" placeholder="Dashboard access token" required>
        <button class="primary" type="submit">Unlock</button>
      </form>
    </section>
    <p id="notice" class="notice" role="status" aria-live="polite"></p>
    <section id="controls" hidden>
      <div class="panel toolbar">
        <label for="guild">Discord server</label>
        <select id="guild" aria-label="Discord server"></select>
        <button id="refresh" type="button">Refresh</button>
        <button id="logout" type="button">Lock</button>
      </div>
      <div class="grid">
        <section class="panel" aria-labelledby="playback-title">
          <h2 id="playback-title">Now playing</h2>
          <div class="track-head"><div class="track-main"><img id="current-artwork" class="track-artwork" alt="" hidden><div class="track-meta"><h3 id="current-title">Nothing is playing</h3><p id="current-artist">Choose a server to inspect playback.</p><p id="current-requester" class="requester"></p></div></div><span id="playback-status" class="muted">—</span></div>
          <div class="time-row"><span id="position">0:00</span><span id="duration">0:00</span></div>
          <input id="seek" type="range" min="0" max="0" value="0" aria-label="Seek to a position in the current song">
          <div class="controls">
            <button id="play-pause" type="button">Pause</button>
            <button id="skip" type="button">Skip</button>
            <button id="stop" class="danger" type="button">Stop and clear queue</button>
          </div>
          <div class="settings">
            <label>Volume <span id="volume-label">80%</span><input id="volume" type="range" min="0" max="200" step="1" value="80"></label>
            <label>Repeat mode<select id="loop"><option value="off">Off</option><option value="track">Repeat track</option><option value="queue">Repeat queue</option></select></label>
          </div>
          <div class="controls">
            <button id="shuffle" type="button">Shuffle queue</button>
            <button id="clear" class="danger" type="button">Clear queue</button>
          </div>
          <div class="settings">
            <label>Voice channel<select id="voice-channel"></select></label>
            <div class="controls"><button id="connect" type="button">Connect</button><button id="disconnect" class="danger" type="button">Disconnect</button></div>
          </div>
          <p class="footnote">Seeking restarts the audio stream at the selected position. Song search and YouTube links are supported; YouTube tracks must be six minutes or shorter.</p>
        </section>
        <section class="panel" aria-labelledby="queue-title">
          <h2 id="queue-title">Up next <span id="queue-count" class="muted"></span></h2>
          <div id="queue" class="queue"></div>
          <form id="add-form" class="add-row">
            <input id="query" type="text" maxlength="500" placeholder="Song name or YouTube URL" aria-label="Song name or YouTube URL" required>
            <button class="primary" type="submit">Add song</button>
          </form>
        </section>
      </div>
    </section>
  </main>
  <script>
    const byId = id => document.getElementById(id);
    const formatTime = seconds => {
      const value = Math.max(0, Math.floor(Number(seconds) || 0));
      return Math.floor(value / 60) + ":" + String(value % 60).padStart(2, "0");
    };
    let token = sessionStorage.getItem("nyx-dashboard-token") || "";
    let snapshot = null;
    let refreshTimer = null;
    let busy = false;
    let failedArtwork = "";
    byId("current-artwork").addEventListener("error", event => {
      failedArtwork = event.currentTarget.src;
      event.currentTarget.hidden = true;
    });
    function notice(message, error = false) {
      byId("notice").textContent = message;
      byId("notice").classList.toggle("error", error);
    }
    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        cache: "no-store",
        headers: { Authorization: "Bearer " + token, ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Dashboard request failed (" + response.status + ").");
      return data;
    }
    function renderQueue(items) {
      const root = byId("queue");
      root.replaceChildren();
      byId("queue-count").textContent = "(" + items.length + ")";
      if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "No songs are queued.";
        root.append(empty);
        return;
      }
      items.forEach((track, index) => {
        const item = document.createElement("div");
        item.className = "queue-item";
        const copy = document.createElement("div");
        copy.className = "queue-copy";
        const title = document.createElement("strong");
        title.textContent = (index + 1) + ". " + track.title;
        const artist = document.createElement("span");
        artist.textContent = (track.artist || "Unknown artist") + " · " + formatTime(track.durationSeconds) + " · Requested by " + (track.requestedBy || "Unknown");
        copy.append(title, artist);
        const actions = document.createElement("div");
        actions.className = "queue-actions";
        const up = document.createElement("button");
        up.type = "button"; up.textContent = "↑"; up.title = "Move up"; up.disabled = index === 0;
        up.addEventListener("click", () => runAction("move", { from: index, to: index - 1 }, "Moved song up."));
        const down = document.createElement("button");
        down.type = "button"; down.textContent = "↓"; down.title = "Move down"; down.disabled = index === items.length - 1;
        down.addEventListener("click", () => runAction("move", { from: index, to: index + 1 }, "Moved song down."));
        const remove = document.createElement("button");
        remove.type = "button"; remove.textContent = "×"; remove.title = "Remove song"; remove.className = "danger";
        remove.addEventListener("click", () => runAction("remove", { position: index }, "Removed song."));
        actions.append(up, down, remove);
        item.append(copy, actions);
        root.append(item);
      });
    }
    function renderGuild(data) {
      snapshot = data;
      const current = data.current;
      byId("current-title").textContent = current ? current.title : "Nothing is playing";
      byId("current-artist").textContent = current ? (current.artist || "Unknown artist") : (data.connected ? "The bot is connected and ready." : "Connect to a voice channel to start.");
      byId("current-requester").textContent = current ? "Requested by " + (current.requestedBy || "Unknown") : "";
      const artwork = byId("current-artwork");
      const thumbnail = typeof current?.thumbnail === "string" && current.thumbnail.startsWith("https://")
        && current.thumbnail !== failedArtwork
        ? current.thumbnail
        : "";
      artwork.hidden = !thumbnail;
      if (thumbnail && artwork.src !== thumbnail) {
        failedArtwork = "";
        artwork.src = thumbnail;
      }
      if (!thumbnail) artwork.removeAttribute("src");
      byId("playback-status").textContent = data.connected ? (current ? current.status : "Connected") : "Disconnected";
      const duration = current ? Number(current.durationSeconds) || 0 : 0;
      const position = current ? Number(current.positionSeconds) || 0 : 0;
      byId("duration").textContent = formatTime(duration);
      byId("position").textContent = formatTime(position);
      byId("seek").max = String(Math.max(0, duration));
      byId("seek").value = String(Math.min(position, duration));
      byId("seek").disabled = !current || busy;
      byId("play-pause").textContent = current?.status === "paused" ? "Resume" : "Pause";
      byId("play-pause").disabled = !current || busy;
      byId("skip").disabled = !current || busy;
      byId("stop").disabled = !current && !data.queue.length || busy;
      byId("volume").value = String(data.volume);
      byId("volume-label").textContent = data.volume + "%";
      byId("loop").value = data.loop;
      const voice = byId("voice-channel");
      voice.replaceChildren();
      const none = document.createElement("option");
      none.value = ""; none.textContent = "Select voice channel";
      voice.append(none);
      data.voiceChannels.forEach(channel => {
        const option = document.createElement("option");
        option.value = channel.id; option.textContent = channel.name;
        voice.append(option);
      });
      if (data.voiceChannelId) voice.value = data.voiceChannelId;
      byId("disconnect").disabled = !data.connected || busy;
      byId("connect").disabled = busy;
      byId("shuffle").disabled = data.queue.length < 2 || busy;
      byId("clear").disabled = !data.queue.length || busy;
      byId("add-form").querySelector("button").disabled = busy || !data.voiceChannels.length;
      renderQueue(data.queue);
    }
    async function refresh() {
      if (!token || busy) return;
      try {
        const data = await api("/api/dashboard");
        const guildSelect = byId("guild");
        const selected = guildSelect.value;
        guildSelect.replaceChildren();
        data.guilds.forEach(guild => {
          const option = document.createElement("option");
          option.value = guild.id; option.textContent = guild.name;
          guildSelect.append(option);
        });
        if (!data.guilds.length) throw new Error("The bot has not joined any Discord servers.");
        guildSelect.value = data.guilds.some(guild => guild.id === selected) ? selected : data.guilds[0].id;
        renderGuild(data.guilds.find(guild => guild.id === guildSelect.value));
        byId("login").hidden = true;
        byId("controls").hidden = false;
      } catch (error) {
        if (/token|access/i.test(error.message)) {
          sessionStorage.removeItem("nyx-dashboard-token");
          token = "";
          byId("login").hidden = false;
          byId("controls").hidden = true;
        }
        notice(error.message, true);
      }
    }
    async function runAction(action, values = {}, success = "Updated.") {
      if (!snapshot || busy) return;
      busy = true;
      notice("Saving…");
      try {
        const result = await api("/api/dashboard/actions", {
          method: "POST",
          body: JSON.stringify({ guildId: snapshot.id, action, ...values })
        });
        renderGuild(result);
        notice(success);
      } catch (error) {
        notice(error.message, true);
      } finally {
        busy = false;
        if (snapshot) renderGuild(snapshot);
      }
    }
    byId("login-form").addEventListener("submit", async event => {
      event.preventDefault();
      token = byId("token").value;
      sessionStorage.setItem("nyx-dashboard-token", token);
      notice("Checking access…");
      await refresh();
    });
    byId("guild").addEventListener("change", refresh);
    byId("refresh").addEventListener("click", refresh);
    byId("logout").addEventListener("click", () => {
      sessionStorage.removeItem("nyx-dashboard-token");
      token = ""; snapshot = null;
      byId("controls").hidden = true; byId("login").hidden = false; byId("token").value = "";
      notice("Dashboard locked.");
    });
    byId("play-pause").addEventListener("click", () => runAction(snapshot?.current?.status === "paused" ? "resume" : "pause"));
    byId("skip").addEventListener("click", () => runAction("skip", {}, "Skipped current song."));
    byId("stop").addEventListener("click", () => runAction("stop", {}, "Playback stopped and queue cleared."));
    byId("seek").addEventListener("change", event => runAction("seek", { seconds: Number(event.target.value) }, "Playback position updated."));
    byId("volume").addEventListener("change", event => runAction("volume", { volume: Number(event.target.value) }, "Volume updated."));
    byId("loop").addEventListener("change", event => runAction("loop", { mode: event.target.value }, "Repeat mode updated."));
    byId("shuffle").addEventListener("click", () => runAction("shuffle", {}, "Queue shuffled."));
    byId("clear").addEventListener("click", () => runAction("clear", {}, "Queue cleared."));
    byId("connect").addEventListener("click", () => runAction("connect", { channelId: byId("voice-channel").value }, "Connected to voice channel."));
    byId("disconnect").addEventListener("click", () => runAction("disconnect", {}, "Disconnected from voice."));
    byId("add-form").addEventListener("submit", async event => {
      event.preventDefault();
      const query = byId("query").value.trim();
      const channelId = byId("voice-channel").value || snapshot?.voiceChannelId;
      if (!channelId) return notice("Select a voice channel before adding music.", true);
      await runAction("add", { query, channelId }, "Song added to queue.");
      byId("query").value = "";
    });
    if (token) {
      byId("token").value = token;
      refresh();
    }
    refreshTimer = setInterval(refresh, 5000);
  </script>
</body>
</html>`;

module.exports = { dashboardPage };
