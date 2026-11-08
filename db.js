const { Pool } = require("pg");
const bcrypt = require("bcrypt");

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://uptime:uptime@localhost:5432/uptime";

const BCRYPT_ROUNDS = 10;

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
});

async function query(text, params) {
  return pool.query(text, params);
}

async function initDb() {
  await query(`CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;`);

  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id BIGSERIAL PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      hostname TEXT,
      pid INTEGER,
      source TEXT NOT NULL DEFAULT 'server',
      user_agent TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS latency_samples (
      time TIMESTAMPTZ NOT NULL,
      host TEXT NOT NULL,
      latency_ms DOUBLE PRECISION,
      ok BOOLEAN NOT NULL DEFAULT false,
      method TEXT,
      status INTEGER,
      error TEXT,
      session_id BIGINT REFERENCES sessions(id) ON DELETE SET NULL
    );
  `);

  await query(`
    SELECT create_hypertable(
      'latency_samples',
      'time',
      if_not_exists => TRUE,
      migrate_data => TRUE
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS latency_samples_host_time_idx
      ON latency_samples (host, time DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS latency_samples_session_time_idx
      ON latency_samples (session_id, time DESC);
  `);

  await query(`
    SELECT add_retention_policy(
      'latency_samples',
      INTERVAL '7 days',
      if_not_exists => TRUE
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function seedDefaultUser(username, password) {
  const existing = await query(`SELECT id FROM users LIMIT 1`);
  if (existing.rows.length > 0) {
    return null;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const result = await query(
    `
      INSERT INTO users (username, password_hash)
      VALUES ($1, $2)
      RETURNING id, username, created_at
    `,
    [username, passwordHash]
  );
  return result.rows[0];
}

async function findUserByUsername(username) {
  const result = await query(
    `
      SELECT id, username, password_hash
      FROM users
      WHERE username = $1
    `,
    [username]
  );
  return result.rows[0] || null;
}

async function verifyUserCredentials(username, password) {
  const user = await findUserByUsername(username);
  if (!user) return null;

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;

  return {
    id: user.id,
    username: user.username,
  };
}

async function createUser(username, password) {
  const existing = await findUserByUsername(username);
  if (existing) {
    const error = new Error("Username already exists.");
    error.code = "USER_EXISTS";
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const result = await query(
    `
      INSERT INTO users (username, password_hash)
      VALUES ($1, $2)
      RETURNING id, username, created_at::text AS created_at
    `,
    [username, passwordHash]
  );
  return result.rows[0];
}

async function listUsers() {
  const result = await query(
    `
      SELECT
        id,
        username,
        password_hash,
        created_at::text AS created_at,
        updated_at::text AS updated_at
      FROM users
      ORDER BY id ASC
    `
  );
  return result.rows;
}

async function startServerSession({ hostname, pid }) {
  const result = await query(
    `
      INSERT INTO sessions (hostname, pid, source, metadata)
      VALUES ($1, $2, 'server', $3::jsonb)
      RETURNING id, started_at
    `,
    [hostname, pid, JSON.stringify({ node: process.version })]
  );
  return result.rows[0];
}

async function endServerSession(sessionId) {
  if (!sessionId) return;
  await query(
    `UPDATE sessions SET ended_at = NOW() WHERE id = $1 AND ended_at IS NULL`,
    [sessionId]
  );
}

async function createBrowserSession({ hostname, userAgent, metadata = {} }) {
  const result = await query(
    `
      INSERT INTO sessions (hostname, source, user_agent, metadata)
      VALUES ($1, 'browser', $2, $3::jsonb)
      RETURNING id, started_at, source, hostname
    `,
    [hostname || null, userAgent || null, JSON.stringify(metadata)]
  );
  return result.rows[0];
}

async function listSessions(limit = 50) {
  const result = await query(
    `
      SELECT
        s.id,
        s.started_at,
        s.ended_at,
        s.hostname,
        s.source,
        s.user_agent,
        s.metadata,
        COUNT(l.time)::int AS sample_count,
        ROUND(AVG(l.latency_ms)::numeric, 1)::float AS avg_latency_ms
      FROM sessions s
      LEFT JOIN latency_samples l ON l.session_id = s.id
      GROUP BY s.id
      ORDER BY s.started_at DESC
      LIMIT $1
    `,
    [Math.min(Math.max(Number(limit) || 50, 1), 200)]
  );
  return result.rows;
}

async function insertLatencySample(sample, sessionId) {
  await query(
    `
      INSERT INTO latency_samples
        (time, host, latency_ms, ok, method, status, error, session_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      sample.at || new Date().toISOString(),
      sample.host,
      sample.latencyMs,
      Boolean(sample.ok),
      sample.method || null,
      sample.status ?? null,
      sample.error || null,
      sessionId || null,
    ]
  );
}

async function getLatencyHistory({ host, hours = 24, maxPoints = 240, all = false }) {
  const pointLimit = Math.min(Math.max(Number(maxPoints) || 240, 20), 500);
  const useAll =
    all === true || all === "1" || all === "true" || hours === "all";

  if (useAll) {
    const metaResult = await query(
      `
        SELECT MIN(time) AS started_at, COUNT(*)::int AS total
        FROM latency_samples
        WHERE host = $1
      `,
      [host]
    );
    const startedAt = metaResult.rows[0]?.started_at;
    const total = metaResult.rows[0]?.total || 0;

    if (!total || !startedAt) {
      return { all: true, hours: null, total: 0, samples: [], startedAt: null };
    }

    const startedMs = new Date(startedAt).getTime();
    const spanSeconds = Math.max(1, (Date.now() - startedMs) / 1000);
    const bucketSeconds = Math.max(1, Math.ceil(spanSeconds / pointLimit));

    const result = await query(
      `
        SELECT
          time_bucket(make_interval(secs => $1), time) AS bucket,
          AVG(latency_ms) AS latency_ms,
          BOOL_OR(ok) AS ok
        FROM latency_samples
        WHERE host = $2
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
      [bucketSeconds, host]
    );

    const samples = result.rows.map((row) => ({
      at: new Date(row.bucket).toISOString(),
      latencyMs:
        row.latency_ms == null ? null : Math.round(Number(row.latency_ms) * 10) / 10,
      ok: Boolean(row.ok),
    }));

    return {
      all: true,
      hours: null,
      total,
      samples,
      startedAt: new Date(startedAt).toISOString(),
    };
  }

  const clampedHours = Math.min(Math.max(Number(hours) || 24, 1), 168);

  const countResult = await query(
    `
      SELECT COUNT(*)::int AS total
      FROM latency_samples
      WHERE host = $1
        AND time >= NOW() - make_interval(hours => $2)
    `,
    [host, clampedHours]
  );
  const total = countResult.rows[0]?.total || 0;

  if (total === 0) {
    return { all: false, hours: clampedHours, total: 0, samples: [], startedAt: null };
  }

  const bucketSeconds = Math.max(1, Math.ceil((clampedHours * 3600) / pointLimit));

  const result = await query(
    `
      SELECT
        time_bucket(make_interval(secs => $1), time) AS bucket,
        AVG(latency_ms) AS latency_ms,
        BOOL_OR(ok) AS ok
      FROM latency_samples
      WHERE host = $2
        AND time >= NOW() - make_interval(hours => $3)
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
    [bucketSeconds, host, clampedHours]
  );

  const samples = result.rows.map((row) => ({
    at: new Date(row.bucket).toISOString(),
    latencyMs:
      row.latency_ms == null ? null : Math.round(Number(row.latency_ms) * 10) / 10,
    ok: Boolean(row.ok),
  }));

  const startResult = await query(
    `
      SELECT MIN(time) AS started_at
      FROM latency_samples
      WHERE host = $1
        AND time >= NOW() - make_interval(hours => $2)
    `,
    [host, clampedHours]
  );
  const rangeStarted = startResult.rows[0]?.started_at;
  const startedAt = rangeStarted ? new Date(rangeStarted).toISOString() : null;

  return { all: false, hours: clampedHours, total, samples, startedAt };
}

async function clearLatencyHistory(host) {
  await query(`DELETE FROM latency_samples WHERE host = $1`, [host]);
}

async function closeDb() {
  await pool.end();
}

module.exports = {
  DATABASE_URL,
  initDb,
  seedDefaultUser,
  findUserByUsername,
  verifyUserCredentials,
  createUser,
  listUsers,
  startServerSession,
  endServerSession,
  createBrowserSession,
  listSessions,
  insertLatencySample,
  getLatencyHistory,
  clearLatencyHistory,
  closeDb,
};
