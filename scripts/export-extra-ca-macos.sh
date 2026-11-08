#!/usr/bin/env bash
# Export a corporate root CA from macOS Keychain for Docker (NODE_EXTRA_CA_CERTS).
# Usage: ./scripts/export-extra-ca-macos.sh [certificate common name]
set -euo pipefail

NAME="${1:-Amdocs RSA Root CA}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/certs/extra-ca.pem"

mkdir -p "$(dirname "$OUT")"
security find-certificate -a -c "$NAME" -p /Library/Keychains/System.keychain >"$OUT"

echo "Wrote $OUT"
echo "Restart Docker: npm run docker:down && npm run docker:up"
