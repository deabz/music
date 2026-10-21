const healthPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#09090d">
  <meta name="description" content="A little more music, a lot less fuss. See live playback and explore the Discord music bot.">
  <title>Nyx — Music for your Discord</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #09090d;
      color: #f6f4fb;
      font-synthesis: none;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
      --muted: #9895a7;
      --line: #ffffff13;
      --purple: #b49aff;
      --green: #71e0b0;
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    html { min-width: 320px; scroll-behavior: smooth; }
    body {
      min-width: 320px;
      min-height: 100vh;
      margin: 0;
      background:
        radial-gradient(ellipse at 82% 8%, #6139a626 0, transparent 34rem),
        radial-gradient(ellipse at 12% 36%, #28387517 0, transparent 32rem),
        #09090d;
    }
    a { color: inherit; }
    button { font: inherit; }
    .shell { width: min(1120px, calc(100% - 48px)); margin: 0 auto; }
    .nav { height: 82px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); }
    .wordmark { display: inline-flex; align-items: center; gap: 11px; text-decoration: none; font-size: 1.08rem; font-weight: 750; letter-spacing: -.045em; }
    .logo { width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid #c1aaff44; border-radius: 11px; background: linear-gradient(145deg, #b49aff38, #7653d41a); color: #d3c2ff; font-size: 1.05rem; }
    .nav-right { display: flex; align-items: center; gap: 25px; color: #c5c1d0; font-size: .88rem; }
    .nav-right a { text-decoration: none; transition: color .2s ease; }
    .nav-right a:hover { color: white; }
    .status-pill { display: inline-flex; align-items: center; gap: 9px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 99px; background: #ffffff07; color: #d8d4e1; font-size: .78rem; }
    .status-dot { width: 7px; height: 7px; border-radius: 50%; background: #eac56d; box-shadow: 0 0 12px currentColor; }
    .status-dot.online { color: var(--green); background: var(--green); }
    .status-dot.offline { color: #ff7b87; background: #ff7b87; }
    .hero { display: grid; grid-template-columns: 1.02fr .98fr; align-items: center; gap: clamp(40px, 7vw, 92px); padding: 92px 0 96px; }
    .kicker { display: inline-flex; align-items: center; gap: 9px; margin: 0 0 23px; color: #c0aaff; font-size: .73rem; font-weight: 750; letter-spacing: .16em; text-transform: uppercase; }
    .kicker::before { width: 20px; height: 1px; background: currentColor; content: ""; }
    h1 { max-width: 620px; margin: 0; font-size: clamp(3.15rem, 7.3vw, 5.6rem); font-weight: 720; letter-spacing: -.075em; line-height: .99; }
    h1 span { color: #b49aff; }
    .intro { max-width: 470px; margin: 24px 0 0; color: #aaa6b7; font-size: 1.06rem; line-height: 1.75; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 32px; }
    .button { min-height: 46px; display: inline-flex; align-items: center; justify-content: center; gap: 9px; padding: 0 17px; border: 1px solid var(--line); border-radius: 12px; background: #ffffff08; color: #f4f1fa; font-size: .87rem; font-weight: 650; text-decoration: none; transition: transform .2s ease, background .2s ease, border-color .2s ease; }
    .button:hover { transform: translateY(-2px); border-color: #ffffff30; background: #ffffff10; }
    .button.primary { border-color: #c4adff55; background: linear-gradient(120deg, #9b7be8, #7555c8); box-shadow: 0 8px 28px #7453cb39; color: white; }
    .button.primary:hover { background: linear-gradient(120deg, #aa8cf4, #8262d7); }
    .button:focus-visible, a:focus-visible, button:focus-visible { outline: 2px solid #c3aaff; outline-offset: 3px; }
    .arrow { font-size: 1rem; }
    .player {
      position: relative;
      overflow: hidden;
      padding: 24px;
      border: 1px solid #ffffff1c;
      border-radius: 22px;
      background: linear-gradient(145deg, #211d2c 0%, #15141b 62%, #111116 100%);
      box-shadow: 0 28px 90px #0006, inset 0 1px #ffffff0b;
    }
    .player::before { position: absolute; top: -130px; right: -80px; width: 270px; height: 270px; border-radius: 50%; background: #9672e71a; filter: blur(35px); content: ""; pointer-events: none; }
    .player-top { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 22px; }
    .player-label { margin: 0; color: #c4bfce; font-size: .82rem; font-weight: 650; }
    .live-label { display: inline-flex; align-items: center; gap: 7px; color: var(--green); font-size: .69rem; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; }
    .live-label::before { width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 10px currentColor; content: ""; }
    .cover-wrap { position: relative; aspect-ratio: 1.82; overflow: hidden; border: 1px solid #ffffff12; border-radius: 15px; background: linear-gradient(135deg, #352b50, #171821 72%); }
    .cover { width: 100%; height: 100%; display: block; object-fit: cover; }
    .cover-placeholder { position: absolute; inset: 0; display: grid; place-items: center; color: #c0aaff; font-size: 2.8rem; }
    .track-info { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 20px; }
    .track-copy { min-width: 0; }
    .track-title { overflow: hidden; margin: 0; color: #fff; font-size: 1.08rem; font-weight: 680; letter-spacing: -.025em; text-overflow: ellipsis; white-space: nowrap; }
    .track-artist { overflow: hidden; margin: 5px 0 0; color: #aaa6b7; font-size: .86rem; text-overflow: ellipsis; white-space: nowrap; }
    .equalizer { height: 28px; display: flex; flex: 0 0 auto; align-items: center; gap: 3px; }
    .equalizer i { width: 3px; height: 9px; border-radius: 4px; background: #b49aff; animation: bounce .8s ease-in-out infinite alternate; }
    .equalizer i:nth-child(2) { height: 18px; animation-delay: -.45s; }
    .equalizer i:nth-child(3) { height: 13px; animation-delay: -.2s; }
    .equalizer i:nth-child(4) { height: 22px; animation-delay: -.6s; }
    .equalizer.paused i { animation-play-state: paused; }
    @keyframes bounce { to { transform: scaleY(.45); opacity: .55; } }
    .seek { height: 4px; overflow: hidden; margin-top: 19px; border-radius: 99px; background: #ffffff18; }
    .seek-bar { width: 0; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #b49aff, #e0d2ff); transition: width .8s linear; }
    .times { display: flex; justify-content: space-between; margin-top: 8px; color: #8d899a; font-size: .7rem; font-variant-numeric: tabular-nums; }
    .player-bottom { display: flex; justify-content: space-between; gap: 10px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--line); color: #aaa6b7; font-size: .75rem; }
    .player-bottom strong { color: #ede9f5; font-weight: 600; }
    .section { padding: 4px 0 86px; }
    .section-heading { display: flex; align-items: end; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
    .section-heading h2 { margin: 0; font-size: clamp(1.6rem, 4vw, 2.15rem); letter-spacing: -.055em; }
    .section-heading p { margin: 8px 0 0; color: var(--muted); font-size: .9rem; line-height: 1.6; }
    .server-count { flex: 0 0 auto; padding: 10px 13px; border: 1px solid var(--line); border-radius: 12px; background: #ffffff06; color: #c6c1d0; font-size: .8rem; }
    .server-count strong { color: white; }
    .features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .feature { min-height: 166px; padding: 21px; border: 1px solid var(--line); border-radius: 16px; background: linear-gradient(145deg, #ffffff09, #ffffff03); }
    .feature-icon { width: 34px; height: 34px; display: grid; place-items: center; margin-bottom: 18px; border: 1px solid #b49aff2b; border-radius: 10px; background: #b49aff0d; color: #c4adff; font-size: 1rem; }
    .feature h3 { margin: 0; font-size: .96rem; letter-spacing: -.02em; }
    .feature p { margin: 8px 0 0; color: var(--muted); font-size: .81rem; line-height: 1.6; }
    .commands { display: grid; grid-template-columns: .82fr 1.18fr; gap: 32px; align-items: start; padding: 26px; border: 1px solid var(--line); border-radius: 18px; background: #ffffff05; }
    .commands h3 { margin: 0; font-size: 1rem; }
    .commands-intro { margin: 9px 0 0; color: var(--muted); font-size: .84rem; line-height: 1.7; }
    .command-list { display: flex; flex-wrap: wrap; gap: 9px; }
    .command { padding: 8px 10px; border: 1px solid #ffffff14; border-radius: 9px; background: #0b0b10; color: #d1c1ff; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .78rem; }
    .footer { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 23px 0 30px; border-top: 1px solid var(--line); color: #827e90; font-size: .76rem; }
    .footer a { color: #bcb6ca; text-decoration: none; }
    .footer a:hover { color: white; }
    .refresh { padding: 0; border: 0; background: transparent; color: #aaa6b7; cursor: pointer; font-size: .76rem; }
    .refresh:hover { color: white; }
    .refresh:disabled { cursor: wait; opacity: .6; }
    @media (max-width: 800px) {
      .hero { grid-template-columns: 1fr; gap: 42px; padding: 72px 0; }
      .hero-copy { max-width: 640px; }
      .player { width: min(100%, 560px); }
      .features { grid-template-columns: 1fr; }
      .feature { min-height: auto; }
      .feature-icon { margin-bottom: 13px; }
    }
    @media (max-width: 520px) {
      .shell { width: min(100% - 32px, 1120px); }
      .nav { height: 70px; }
      .nav-right { gap: 14px; }
      .nav-right a { display: none; }
      .status-pill { padding: 8px 10px; }
      .hero { gap: 34px; padding: 61px 0 70px; }
      h1 { font-size: clamp(3rem, 16vw, 4.55rem); }
      .intro { font-size: .98rem; }
      .player { padding: 17px; border-radius: 18px; }
      .section { padding-bottom: 68px; }
      .section-heading { align-items: start; flex-direction: column; gap: 14px; }
      .commands { grid-template-columns: 1fr; gap: 20px; padding: 20px; }
      .footer { align-items: flex-start; flex-direction: column; gap: 10px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
    }
  </style>
</head>
<body>
  <header class="shell nav">
    <a class="wordmark" href="/" aria-label="Nyx home"><span class="logo" aria-hidden="true">✳</span><span>nyx<span style="color:#b49aff">.</span></span></a>
    <nav class="nav-right" aria-label="Main navigation">
      <a href="/dashboard">Music controls</a>
      <a href="#features">Features</a>
      <a href="#commands">Commands</a>
      <span class="status-pill"><span id="status-dot" class="status-dot" aria-hidden="true"></span><span id="status-text">Checking status</span></span>
    </nav>
  </header>
  <main class="shell">
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <p class="kicker">Your Discord, in rhythm</p>
        <h1 id="hero-title">Good music.<br><span>Good company.</span></h1>
        <p class="intro">Bring the soundtrack to your server. Play your favourites, share the queue, and keep the good vibes going.</p>
        <div class="actions">
          <a class="button primary" href="#commands">Explore commands <span class="arrow" aria-hidden="true">↗</span></a>
          <a class="button" href="#now-playing">See what's playing <span class="arrow" aria-hidden="true">↓</span></a>
        </div>
      </div>
      <article id="now-playing" class="player" aria-label="Live music playback" aria-live="polite">
        <div class="player-top"><p class="player-label">On the air</p><span id="track-status" class="live-label">Live status</span></div>
        <div class="cover-wrap">
          <div id="cover-placeholder" class="cover-placeholder" aria-hidden="true">✳</div>
          <img id="cover" class="cover" alt="" hidden>
        </div>
        <div class="track-info">
          <div class="track-copy">
            <h2 id="track-title" class="track-title">Finding the beat…</h2>
            <p id="track-artist" class="track-artist">Checking live playback</p>
          </div>
          <span id="equalizer" class="equalizer" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        </div>
        <div class="seek" aria-label="Track progress"><div id="seek-bar" class="seek-bar"></div></div>
        <div class="times"><span id="elapsed">0:00</span><span id="remaining">—</span></div>
        <div class="player-bottom"><span>Playing in <strong id="track-server">—</strong></span><span id="updated">Updating…</span></div>
      </article>
    </section>
    <section id="features" class="section" aria-labelledby="features-title">
      <div class="section-heading">
        <div><h2 id="features-title">Made for the moment</h2><p>The essentials for a great listening session, right in your server.</p></div>
        <div class="server-count"><strong id="server-count">—</strong> servers connected</div>
      </div>
      <div class="features">
        <article class="feature"><span class="feature-icon" aria-hidden="true">♫</span><h3>Your music, your way</h3><p>Play YouTube searches and links, plus Spotify tracks, albums, and playlists.</p></article>
        <article class="feature"><span class="feature-icon" aria-hidden="true">↗</span><h3>Queue up together</h3><p>Build a shared queue, shuffle the next tracks, and choose what plays again.</p></article>
        <article class="feature"><span class="feature-icon" aria-hidden="true">◉</span><h3>Stay in the groove</h3><p>Check live playback, adjust volume, and keep your server's music close at hand.</p></article>
      </div>
    </section>
    <section id="commands" class="section" aria-labelledby="commands-title">
      <div class="section-heading"><div><h2 id="commands-title">A command away</h2><p>Use slash commands in Discord, or try a quick apostrophe shortcut.</p></div></div>
      <div class="commands">
        <div><h3>Start listening</h3><p class="commands-intro">Pick a track, then let everyone add to the queue. For the full list, use <span class="command">/help</span> in your server.</p></div>
        <div class="command-list" aria-label="Popular commands">
          <span class="command">/play</span><span class="command">'p</span><span class="command">/queue</span><span class="command">'q</span>
          <span class="command">/pause</span><span class="command">/skip</span><span class="command">/shuffle</span><span class="command">/volume</span>
          <span class="command">/nowplaying</span><span class="command">'np</span><span class="command">/bassboost</span><span class="command">'bb</span>
          <span class="command">/eightd</span><span class="command">'8d</span><span class="command">/nightcore</span><span class="command">'nc</span>
          <span class="command">/echo</span><span class="command">'ec</span><span class="command">/remove</span><span class="command">'rm</span>
        </div>
      </div>
    </section>
  </main>
  <footer class="shell footer">
    <span>nyx. · A little more music for your Discord.</span>
    <span><a href="/dashboard">Music controls</a> · <button id="refresh" class="refresh" type="button">Refresh status</button> · <a href="/healthz">Status API</a></span>
  </footer>
  <script>
    const byId = id => document.getElementById(id);
    let refreshInProgress = false;
    let lastTrack = null;
    let trackReceivedAt = 0;
    const formatTime = seconds => {
      const value = Math.max(0, Math.floor(Number(seconds) || 0));
      return Math.floor(value / 60) + ":" + String(value % 60).padStart(2, "0");
    };
    function renderProgress() {
      if (!lastTrack) return;
      const position = Math.max(0, Number(lastTrack.positionSeconds) || 0)
        + (lastTrack.status === "playing" ? (Date.now() - trackReceivedAt) / 1000 : 0);
      const duration = Number(lastTrack.durationSeconds) || 0;
      byId("elapsed").textContent = formatTime(position);
      byId("remaining").textContent = duration ? "-" + formatTime(Math.max(0, duration - position)) : "—";
      byId("seek-bar").style.width = duration ? Math.min(100, position / duration * 100) + "%" : "0%";
    }
    function showIdle(online) {
      lastTrack = null;
      byId("track-title").textContent = online ? "Your next favourite" : "The bot is reconnecting";
      byId("track-artist").textContent = online ? "Nothing playing right now" : "Live playback will return when the bot is online";
      byId("track-server").textContent = "—";
      byId("track-status").textContent = online ? "Ready when you are" : "Reconnecting";
      byId("cover").hidden = true;
      byId("cover").removeAttribute("src");
      byId("cover-placeholder").hidden = false;
      byId("equalizer").classList.add("paused");
      byId("elapsed").textContent = "0:00";
      byId("remaining").textContent = "—";
      byId("seek-bar").style.width = "0%";
    }
    function showTrack(track) {
      lastTrack = track;
      trackReceivedAt = Date.now();
      byId("track-title").textContent = track.title || "Unknown track";
      byId("track-artist").textContent = track.artist || "Unknown artist";
      byId("track-server").textContent = track.server || "your server";
      byId("track-status").textContent = track.status === "paused" ? "Paused" : "Now playing";
      byId("equalizer").classList.toggle("paused", track.status === "paused");
      const cover = byId("cover");
      const thumbnail = typeof track.thumbnail === "string" && track.thumbnail.startsWith("https://")
        ? track.thumbnail
        : "";
      if (thumbnail) {
        cover.src = thumbnail;
        cover.hidden = false;
        byId("cover-placeholder").hidden = true;
      } else {
        cover.hidden = true;
        cover.removeAttribute("src");
        byId("cover-placeholder").hidden = false;
      }
      renderProgress();
    }
    async function refresh() {
      if (refreshInProgress) return;
      refreshInProgress = true;
      byId("refresh").disabled = true;
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        if (!response.ok) throw new Error("Status endpoint returned " + response.status);
        const data = await response.json();
        const online = data.status === "online";
        byId("status-dot").className = "status-dot " + (online ? "online" : "offline");
        byId("status-text").textContent = online ? "All systems go" : "Starting up";
        byId("server-count").textContent = Number(data.serverCount) || 0;
        if (data.track) showTrack(data.track);
        else showIdle(online);
        byId("updated").textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      } catch {
        byId("status-dot").className = "status-dot offline";
        byId("status-text").textContent = "Status unavailable";
        byId("server-count").textContent = "—";
        showIdle(false);
        byId("updated").textContent = "Retrying shortly";
      } finally {
        refreshInProgress = false;
        byId("refresh").disabled = false;
      }
    }
    byId("refresh").addEventListener("click", refresh);
    refresh();
    setInterval(refresh, 15000);
    setInterval(renderProgress, 1000);
  </script>
</body>
</html>`;

module.exports = { healthPage };
