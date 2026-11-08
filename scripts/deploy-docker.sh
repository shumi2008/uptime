#!/usr/bin/env bash
# Code-only deploy: build app image and start compose stack (fresh DB volume on first run).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Engine and retry." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required (docker compose)." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example — set LOGIN_PASSWORD and other secrets before production use."
fi

docker compose up -d --build

echo ""
docker compose ps
echo ""
echo "App: http://localhost:${PORT:-3000} (default login from .env / compose — change in production)."
