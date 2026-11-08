# uptime

Mac uptime, Maccabi Haifa fixtures, league table, map, and latency — Node/Express + TimescaleDB, with a PWA-style mobile shell.

## Code-only Docker deploy (new machine)

Use this when you **do not** need existing database data (users, latency history, sessions). A new Docker volume starts empty; the app runs migrations and seeds the default user if the DB has no users.

### On the new machine

1. Install [Docker Engine](https://docs.docker.com/engine/install/) with Compose v2 (`docker compose`).
2. Copy the project (git clone, `rsync`, or archive). Do **not** rely on copying `node_modules` — the image runs `npm ci` during build.
3. Optional (not in git): copy `data/haifa-league-positions.json` for offline club history, and `certs/*.pem` if you use `NODE_EXTRA_CA_CERTS`.
4. From the project root:

   ```bash
   chmod +x scripts/deploy-docker.sh
   ./scripts/deploy-docker.sh
   ```

   Or: `npm run docker:deploy`

5. Open `http://<host>:3000` (or the port in `.env` `PORT`).

### What to configure

Create or edit `.env` (see `.env.example`):

| Variable | Purpose |
|----------|---------|
| `LOGIN_USER` / `LOGIN_PASSWORD` | First login (seeded only when no users exist) |
| `PORT` | Host port mapped to the app (default `3000`) |
| `DISPLAY_TZ` | Fixture kickoff labels (default `America/New_York`) |
| `TLS_INSECURE` / `NODE_EXTRA_CA_CERTS` | FotMob HTTPS from behind corporate TLS inspection |

Compose sets `DATABASE_URL` to the `timescaledb` service; you normally do not change that for Docker.

### Requirements

- Free host port (default **3000**).
- Outbound HTTPS for FotMob and geocoding APIs.
- App container uses `NET_RAW` for ICMP ping; if unavailable, latency falls back to HTTP timing.

### Stop / logs

```bash
npm run docker:down    # stop containers
npm run docker:logs    # follow app logs
```

### Moving with database data

For pg_dump / volume backup, use a full DB migration — not covered by code-only deploy.
