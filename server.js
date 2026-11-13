const express = require("express");
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const db = require("./db");
const APP_VERSION = require("./package.json").version;
const { getFixtures } = require("./fixtures");
const { publicTeams, getTeam, DEFAULT_TEAM } = require("./teams");
const { getLiveMatch } = require("./live-match");
const { getTable } = require("./table");
const { getSquad } = require("./squad");
const { getHistory } = require("./history");
const { httpsFetch } = require("./lib/https-fetch");
const { findNearbyFootballTeams } = require("./lib/nearby-football-teams");

const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 3000;
const PING_HOST = "www.fotmob.com";
const BACKGROUND_PING_MS = Number(process.env.PING_INTERVAL_MS) || 60_000;
const LOGIN_USER = process.env.LOGIN_USER || "admin";
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || "haifa";
const AUTH_COOKIE = "uptime_auth";
const USER_COOKIE = "uptime_user";
const AUTH_TOKEN = crypto.randomBytes(32).toString("hex");

let currentSessionId = null;

function formatUptime(totalSeconds) {
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor((totalSeconds / 3600) % 24);
  const days = Math.floor(totalSeconds / 86400);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

function buildMonthUptime(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const bootTime = new Date(Date.now() - os.uptime() * 1000);
  const monthName = now.toLocaleString("en-US", { month: "long", year: "numeric" });

  const days = [];
  let daysUp = 0;
  let daysPartial = 0;
  let daysDown = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const dayStart = new Date(year, month, day, 0, 0, 0, 0);
    const dayEnd = new Date(year, month, day + 1, 0, 0, 0, 0);

    if (day > today) {
      days.push({
        day,
        label: String(day),
        hoursUp: null,
        status: "future",
      });
      continue;
    }

    const rangeEnd = day === today ? now : dayEnd;
    const overlapStart = Math.max(dayStart.getTime(), bootTime.getTime());
    const overlapEnd = Math.min(rangeEnd.getTime(), now.getTime());
    const hoursUp =
      overlapEnd > overlapStart
        ? Math.round(((overlapEnd - overlapStart) / 3_600_000) * 10) / 10
        : 0;

    const fullDayHours =
      day === today
        ? Math.round(((now.getTime() - dayStart.getTime()) / 3_600_000) * 10) / 10
        : 24;

    let status = "down";
    if (hoursUp >= Math.min(fullDayHours, 23.5)) {
      status = "up";
      daysUp += 1;
    } else if (hoursUp > 0) {
      status = "partial";
      daysPartial += 1;
    } else {
      daysDown += 1;
    }

    days.push({
      day,
      label: String(day),
      hoursUp,
      status,
    });
  }

  return {
    month: monthName,
    bootTime: bootTime.toISOString(),
    hostname: os.hostname(),
    summary: {
      daysUp,
      daysPartial,
      daysDown,
      daysElapsed: today,
      daysInMonth,
    },
    days,
  };
}

async function pingHost() {
  const at = new Date().toISOString();

  try {
    const { stdout } = await execFileAsync(
      "ping",
      ["-c", "1", "-W", "3000", PING_HOST],
      { timeout: 6000 }
    );
    const match = stdout.match(/time=([\d.]+)\s*ms/i);
    if (match) {
      return {
        ok: true,
        host: PING_HOST,
        latencyMs: Math.round(parseFloat(match[1]) * 10) / 10,
        method: "icmp",
        at,
      };
    }
  } catch {
    // Fall through to HTTP timing if ICMP is unavailable.
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const started = performance.now();

  try {
    const response = await httpsFetch(`https://${PING_HOST}`, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    const latencyMs = Math.round((performance.now() - started) * 10) / 10;
    return {
      ok: response.status < 500,
      host: PING_HOST,
      latencyMs,
      method: "http",
      status: response.status,
      at,
    };
  } catch (err) {
    return {
      ok: false,
      host: PING_HOST,
      latencyMs: null,
      method: "http",
      error: err.name === "AbortError" ? "timeout" : "unreachable",
      at,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function recordLatency(sample, sessionId = currentSessionId) {
  await db.insertLatencySample(sample, sessionId);
}

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function isAuthenticated(req) {
  return getCookie(req, AUTH_COOKIE) === AUTH_TOKEN;
}

function isAdminUser(username) {
  if (!username) return false;
  return String(username).trim() === String(LOGIN_USER).trim();
}

function requireAdmin(req, res, next) {
  const username = getCookie(req, USER_COOKIE);
  if (isAdminUser(username)) return next();
  return res.status(403).json({ ok: false, error: "Admin access required." });
}

function blockProtectedPages(req, res, next) {
  if (isAuthenticated(req)) return next();

  if (req.path === "/index.html") {
    return res.redirect("/login");
  }

  next();
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ ok: false, error: "Authentication required." });
  }

  if (req.path === "/") {
    return res.redirect("/login");
  }

  next();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderUsersTable(users) {
  if (!users.length) {
    return '<p class="users-loading">No users found in TimescaleDB.</p>';
  }

  const rows = users
    .map(
      (user) => `
        <tr>
          <td>${escapeHtml(user.id)}</td>
          <td class="users-table__username">${escapeHtml(user.username)}</td>
          <td class="users-table__hash"><code>${escapeHtml(user.password_hash)}</code></td>
          <td><code>${escapeHtml(user.created_at)}</code></td>
          <td><code>${escapeHtml(user.updated_at)}</code></td>
        </tr>`
    )
    .join("");

  const rawJson = escapeHtml(JSON.stringify(users, null, 2));

  return `
    <div class="league-table-wrap">
      <table class="league-table users-table">
        <thead>
          <tr>
            <th scope="col">id</th>
            <th scope="col">username</th>
            <th scope="col">password_hash</th>
            <th scope="col">created_at</th>
            <th scope="col">updated_at</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <pre class="users-raw" aria-label="Raw users table JSON">${rawJson}</pre>
  `;
}

async function renderIndexHtml(req) {
  const templatePath = path.join(__dirname, "public", "index.html");
  let html = fs.readFileSync(templatePath, "utf8");
  html = html.replace("__APP_VERSION__", APP_VERSION);
  const username = getCookie(req, USER_COOKIE);
  const isAdmin = isAdminUser(username);

  if (isAdmin) {
    const users = await db.listUsers();
    html = html.replace("<!-- USERS_TABLE -->", renderUsersTable(users));
    html = html.replace('id="users-nav-link" hidden', 'id="users-nav-link"');
    html = html.replace(
      'id="users" class="charts-section users-section app-view" data-app-view="more" hidden',
      'id="users" class="charts-section users-section app-view" data-app-view="more"'
    );
  } else {
    html = html.replace("<!-- USERS_TABLE -->", "");
  }

  return html;
}

app.use(express.json());
app.use(blockProtectedPages);
app.use(express.static(path.join(__dirname, "public"), { index: false }));

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ ok: false, error: "Username and password are required." });
  }

  try {
    const user = await db.verifyUserCredentials(String(username).trim(), password);
    if (!user) {
      return res.status(401).json({ ok: false, error: "Invalid username or password." });
    }

    res.cookie(AUTH_COOKIE, AUTH_TOKEN, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.cookie(USER_COOKIE, user.username, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return res.json({ ok: true, username: user.username });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/logout", (_req, res) => {
  res.clearCookie(AUTH_COOKIE);
  res.clearCookie(USER_COOKIE);
  res.json({ ok: true });
});

app.post("/api/register", async (req, res) => {
  const { username, password } = req.body || {};
  const trimmedUsername = String(username || "").trim();

  if (!trimmedUsername || !password) {
    return res.status(400).json({ ok: false, error: "Username and password are required." });
  }

  if (trimmedUsername.length < 3) {
    return res.status(400).json({ ok: false, error: "Username must be at least 3 characters." });
  }

  if (String(password).length < 4) {
    return res.status(400).json({ ok: false, error: "Password must be at least 4 characters." });
  }

  try {
    const user = await db.createUser(trimmedUsername, password);
    res.status(201).json({ ok: true, user });
  } catch (err) {
    if (err.code === "USER_EXISTS" || err.code === "23505") {
      return res.status(409).json({ ok: false, error: "Username already exists." });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/login", (req, res) => {
  if (isAuthenticated(req)) {
    return res.redirect("/");
  }

  const html = fs
    .readFileSync(path.join(__dirname, "public", "login.html"), "utf8")
    .replace("__APP_VERSION__", APP_VERSION);
  res.type("html").send(html);
});

app.get("/register", (req, res) => {
  if (isAuthenticated(req)) {
    return res.redirect("/");
  }

  res.sendFile(path.join(__dirname, "public", "register.html"));
});

app.use(requireAuth);

app.get("/api/me", (req, res) => {
  const username = getCookie(req, USER_COOKIE);
  res.json({
    username: username || null,
    isAdmin: isAdminUser(username),
  });
});

app.get("/api/uptime", (_req, res) => {
  const seconds = Math.floor(os.uptime());
  res.json({
    seconds,
    formatted: formatUptime(seconds),
    hostname: os.hostname(),
    sessionId: currentSessionId,
  });
});

app.get("/api/uptime/month", (_req, res) => {
  res.json(buildMonthUptime());
});

app.get("/api/ping/fotmob", async (_req, res) => {
  try {
    const result = await pingHost();
    await recordLatency(result);
    res.status(result.ok ? 200 : 503).json({
      ...result,
      sessionId: currentSessionId,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/ping/fotmob/history", async (req, res) => {
  try {
    const all = req.query.all === "1" || req.query.all === "true";
    const history = await db.getLatencyHistory({
      host: PING_HOST,
      hours: req.query.hours,
      maxPoints: req.query.maxPoints,
      all,
    });
    res.json(history);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/ping/fotmob/history", async (_req, res) => {
  try {
    await db.clearLatencyHistory(PING_HOST);
    res.json({ ok: true, cleared: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/sessions", async (req, res) => {
  try {
    const sessions = await db.listSessions(req.query.limit);
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/sessions", async (req, res) => {
  try {
    const session = await db.createBrowserSession({
      hostname: os.hostname(),
      userAgent: req.get("user-agent"),
      metadata: {
        path: req.body?.path || "/",
        timezone: req.body?.timezone || null,
      },
    });
    res.status(201).json(session);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/teams", (_req, res) => {
  res.json({ default: DEFAULT_TEAM, teams: publicTeams() });
});

function requireTeam(req, res, next) {
  if (!getTeam(req.params.team)) {
    return res.status(404).json({ ok: false, error: "Unknown team" });
  }
  next();
}

app.get("/api/fixtures/:team", requireTeam, async (req, res) => {
  try {
    const data = await getFixtures(req.params.team);
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const LAST_PLAYED_FILES = {
  "maccabi-haifa": "haifa-last-played-game.json",
  "aek-athens": "aek-last-played-game.json",
};

app.get("/api/matches/last-played", (req, res) => {
  try {
    const slug = LAST_PLAYED_FILES[req.query.team] ? req.query.team : "maccabi-haifa";
    const file = path.join(__dirname, "data", LAST_PLAYED_FILES[slug]);
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!payload?.match || !payload?.fixture) {
      return res.status(500).json({ ok: false, error: "Last played mock is incomplete" });
    }
    res.json(payload);
  } catch (err) {
    const missing = err && err.code === "ENOENT";
    res.status(missing ? 404 : 500).json({
      ok: false,
      error: missing ? "Last played mock unavailable" : "Last played mock could not be read",
    });
  }
});

app.get("/api/matches/:matchId/live", async (req, res) => {
  try {
    res.json(await getLiveMatch(req.params.matchId));
  } catch (err) {
    res.status(err.status || 502).json({
      ok: false,
      error: err.message || "Live score unavailable",
    });
  }
});

app.get("/api/table/:team", requireTeam, async (req, res) => {
  try {
    const data = await getTable(req.params.team);
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/history/:team", requireTeam, async (req, res) => {
  try {
    res.json(await getHistory(req.params.team));
  } catch (err) {
    res.status(502).json({ error: err.message || "History unavailable" });
  }
});

app.get("/api/squad/:team", requireTeam, async (req, res) => {
  try {
    const data = await getSquad(req.params.team);
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

function parseNominatimAddress(address = {}) {
  const city =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.suburb ||
    null;
  const area =
    address.state ||
    address.state_district ||
    address.region ||
    address.county ||
    null;
  const country = address.country || null;
  const countryCode = address.country_code || null;
  return { city, area, country, countryCode };
}

app.get("/api/geocode/reverse", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: "lat and lng are required" });
    return;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    res.status(400).json({ error: "lat and lng out of range" });
    return;
  }

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("zoom", "10");

    const response = await httpsFetch(url.toString(), {
      headers: {
        "User-Agent": "uptime-app/1.0 (league map location legend)",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      res.status(502).json({ error: "Reverse geocoding unavailable" });
      return;
    }

    const data = await response.json();
    const place = parseNominatimAddress(data.address);
    res.json({
      lat,
      lng,
      displayName: data.display_name || null,
      ...place,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Reverse geocoding failed" });
  }
});

app.get("/api/location/nearby-teams", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const city = req.query.city ? String(req.query.city) : null;
  const area = req.query.area ? String(req.query.area) : null;
  const country = req.query.country ? String(req.query.country) : null;
  const countryCode = req.query.countryCode ? String(req.query.countryCode) : null;

  if (!city && !area && !country && !Number.isFinite(lat)) {
    res.status(400).json({ error: "Provide city, area, country, or lat/lng" });
    return;
  }

  try {
    const result = await findNearbyFootballTeams({
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      city,
      area,
      country,
      countryCode,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Nearby teams lookup failed" });
  }
});

app.get("/api/users", requireAdmin, async (_req, res) => {
  try {
    const users = await db.listUsers();
    res.json({ users });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/", async (req, res) => {
  try {
    const html = await renderIndexHtml(req);
    res.type("html").send(html);
  } catch (err) {
    res.status(500).send(`Failed to load homepage: ${escapeHtml(err.message)}`);
  }
});

setInterval(async () => {
  try {
    const result = await pingHost();
    await recordLatency(result);
  } catch {
    // Keep the collector alive even if a single ping fails.
  }
}, BACKGROUND_PING_MS);

async function shutdown(signal) {
  console.log(`Received ${signal}, closing session…`);
  try {
    await db.endServerSession(currentSessionId);
  } catch (err) {
    console.error("Failed to end session:", err.message);
  }
  try {
    await db.closeDb();
  } catch {
    // ignore
  }
  process.exit(0);
}

async function start() {
  try {
    await db.initDb();
    const seeded = await db.seedDefaultUser(LOGIN_USER, LOGIN_PASSWORD);
    if (seeded) {
      console.log(`Default user created: ${seeded.username}`);
    }
    const session = await db.startServerSession({
      hostname: os.hostname(),
      pid: process.pid,
    });
    currentSessionId = session.id;
    console.log(`TimescaleDB ready (${db.DATABASE_URL.replace(/:[^:@/]+@/, ":***@")})`);
    console.log(`Server session #${currentSessionId} started`);
  } catch (err) {
    console.error("Failed to connect to TimescaleDB.");
    console.error(err.message);
    console.error("Start it with: npm run db:up");
    console.error("Default URL: postgres://uptime:uptime@localhost:5432/uptime");
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Uptime listening on http://localhost:${PORT}`);
  });

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start();
