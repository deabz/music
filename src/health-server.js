const http = require("http");
const { timingSafeEqual } = require("crypto");

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};
const MAX_REQUEST_BYTES = 16 * 1024;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(JSON.stringify(payload));
}

function isAuthorized(request, token) {
  const authorization = request.headers.authorization || "";
  if (!token || !authorization.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
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
  return http.createServer(async (request, response) => {
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    if (request.method === "GET" && (pathname === "/" || pathname === "/health")) {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(page);
      return;
    }

    if (request.method === "GET" && pathname === "/dashboard") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(dashboardPage);
      return;
    }

    if (request.method === "GET" && (pathname === "/api/health" || pathname === "/healthz")) {
      if (pathname === "/api/health" && (request.headers.accept || "").includes("text/html")) {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        });
        response.end(page);
        return;
      }

      const snapshot = getStatus();
      const ready = snapshot.ready === true;
      const status = ready ? "online" : "starting";
      sendJson(response, ready ? 200 : 503, {
        status,
        bot: status,
        serverCount: ready ? snapshot.serverCount : 0,
        track: ready ? snapshot.track : null
      });
      return;
    }

    if (pathname === "/api/dashboard" || pathname === "/api/dashboard/actions") {
      if (!dashboardToken) {
        sendJson(response, 503, { error: "Website controls are not configured. Set MUSIC_DASHBOARD_TOKEN." });
        return;
      }
      if (!isAuthorized(request, dashboardToken)) {
        sendJson(response, 401, { error: "Enter a valid dashboard access token." });
        return;
      }

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
        if (statusCode === 500) console.error(`[dashboard] ${error.stack || error.message}`);
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
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });
}

module.exports = { createHealthServer };
