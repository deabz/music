const http = require("http");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, timingSafeEqual } = require("crypto");

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};
const MAX_REQUEST_BYTES = 16 * 1024;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(JSON.stringify(payload, null, 2) + "\n");
}

function isAuthorized(request, token) {
  const authorization = request.headers.authorization || "";
  if (!token || !authorization.startsWith("Bearer ")) return false;
  const hash = value => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(authorization.slice(7)), hash(token));
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
    const error = new Error("Content-Type must be application/json.");
    error.statusCode = 415;
    throw error;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      request.resume();
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    const error = new Error("Request body must be a JSON object.");
    error.statusCode = 400;
    throw error;
  }
}

function createHealthServer({ page, dashboardPage, getStatus, dashboardToken, getDashboard, controlDashboard }) {
  const { statusPage, notFoundPage } = require("./status-page");
  const assetCache = process.env.NODE_ENV === "production" ? "public, max-age=0, must-revalidate" : "no-cache";
  const website = require("./website");
  const decorate = html => html;
  const attempts = new Map();
  return http.createServer(async (request, response) => {
    response.setHeader("X-Robots-Tag", "noindex, nofollow");
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    if (request.method === "GET" && pathname === "/api/now-playing") {
      const { publicNowPlaying } = require("./public-artwork");
      let snapshot;
      try { snapshot = getStatus(); } catch { snapshot = { ready: false }; }
      sendJson(response, 200, publicNowPlaying(snapshot || {}));
      return;
    }
    if (request.method === "GET" && pathname === "/api/commands") {
      sendJson(response, 200, website.publicCommands);
      return;
    }
    const staticTypes = { "/site.css":"text/css; charset=utf-8", "/site.js":"text/javascript; charset=utf-8", "/changelog.json":"application/json; charset=utf-8", "/robots.txt":"text/plain; charset=utf-8", "/site.webmanifest":"application/manifest+json", "/favicon.svg":"image/svg+xml", "/favicon.ico":"image/x-icon", "/favicon-16x16.png":"image/png", "/favicon-32x32.png":"image/png", "/apple-touch-icon.png":"image/png", "/icon-192.png":"image/png", "/icon-512.png":"image/png", ...Object.fromEntries(["home","commands","changelog","status","dashboard","404"].map(key=>["/og-"+key+".png","image/png"])) };
    if (request.method === "GET" && staticTypes[pathname]) {
      response.writeHead(200, {"Content-Type":staticTypes[pathname], "Cache-Control":assetCache, "X-Content-Type-Options":"nosniff"});
      response.end(pathname==="/site.css" ? website.css : pathname==="/site.js" ? website.js : fs.readFileSync(path.join(__dirname,"../web",pathname.slice(1))));
      return;
    }
    if (request.method === "GET" && ["/commands","/changelog"].includes(pathname)) {
      response.writeHead(200, {"Content-Type":"text/html; charset=utf-8", "Cache-Control":"no-store"});
      response.end(pathname==="/commands" ? website.commandsPage : website.changelogPage);
      return;
    }
    if (request.method === "GET" && pathname === "/status") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(decorate(statusPage));
      return;
    }
    if (request.method === "GET" && (pathname === "/" || pathname === "/health")) {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(decorate(page));
      return;
    }

    if (request.method === "GET" && pathname === "/dashboard") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(decorate(website.styleDashboard(dashboardPage)));
      return;
    }

    if (request.method === "GET" && (pathname === "/api/health" || pathname === "/healthz")) {
      if ((request.headers.accept || "").includes("text/html")) {
        response.writeHead(302, { Location: "/status", "Cache-Control": "no-store" });
        response.end();
        return;
      }
      let snapshot;
      try { snapshot = getStatus(); } catch { snapshot = { ready: false }; }
      const ready = snapshot.ready === true;
      const track = ready && snapshot.track;
      sendJson(response, ready ? 200 : 503, {
        status: ready ? "online" : "offline",
        bot: ready ? "online" : "offline",
        serverCount: ready ? Number(snapshot.serverCount) || 0 : 0,
        uptimeSeconds: Math.max(0, Number(snapshot.uptimeSeconds) || 0),
        pingMs: ready && Number.isFinite(snapshot.pingMs) && snapshot.pingMs >= 0 ? Math.round(snapshot.pingMs) : null,
        version: require("../package.json").version,
        timestamp: new Date().toISOString(),
        ...(track ? { track: {
          title: track.title, artist: track.artist, thumbnail: track.thumbnail,
          positionSeconds: track.positionSeconds, durationSeconds: track.durationSeconds,
          status: track.status, server: track.server, playbackRate: track.playbackRate || 1
        } } : {})
      });
      return;
    }

    if (pathname === "/api/dashboard" || pathname === "/api/dashboard/actions") {
      if (!dashboardToken) {
        sendJson(response, 503, { error: "Website controls are not configured. Set MUSIC_DASHBOARD_TOKEN." });
        return;
      }
      const time = Date.now();
      for (const [ip, attempt] of attempts) if (attempt.until <= time) attempts.delete(ip);
      const ip = request.socket.remoteAddress;
      const attempt = attempts.get(ip);
      if (attempt?.count >= 5) {
        response.setHeader("Retry-After", String(Math.ceil((attempt.until - time) / 1000)));
        sendJson(response, 429, { error: "Too many access attempts. Try again in a minute." });
        return;
      }
      if (!isAuthorized(request, dashboardToken)) {
        attempts.set(ip, { count: (attempt?.count || 0) + 1, until: attempt?.until || time + 60000 });
        sendJson(response, 401, { error: "Enter a valid dashboard access token." });
        return;
      }

      attempts.delete(ip);
      try {
        if (pathname === "/api/dashboard" && request.method === "GET") {
          sendJson(response, 200, await getDashboard());
          return;
        }
        if (pathname === "/api/dashboard/actions" && request.method === "POST") {
          sendJson(response, 200, await controlDashboard(await readJson(request)));
          return;
        }
        response.writeHead(405, { ...JSON_HEADERS, Allow: pathname === "/api/dashboard" ? "GET" : "POST" });
        response.end(JSON.stringify({ error: "Method not allowed." }));
      } catch (error) {
        const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
        if (statusCode === 500) console.error("[dashboard] Request failed.");
        sendJson(response, statusCode, {
          error: statusCode === 500 ? "The dashboard request could not be completed." : error.message
        });
      }
      return;
    }

    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET", "Content-Type": "text/plain; charset=utf-8" });
      response.end("Method not allowed");
      return;
    }
    response.writeHead(404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(decorate(notFoundPage));
  });
}

module.exports = { createHealthServer };
