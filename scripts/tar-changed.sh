#!/usr/bin/env bash
# Tar only the files that `git status` reports as changed
# (modified, added, renamed, untracked). Deleted files are skipped.
# Usage: scripts/tar-changed.sh [output.tar.gz]
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
out="${1:-changed-$(date +%Y%m%d-%H%M%S).tar.gz}"

files=()
while IFS= read -r -d '' entry; do
  status="${entry:0:2}"
  path="${entry:3}"
  # Rename/copy entries are followed by the original path as a separate field.
  if [[ "$status" == R* || "$status" == C* ]]; then
    IFS= read -r -d '' _orig || true
  fi
  [[ "$status" == *D* ]] && continue
  [[ -e "$path" ]] && files+=("$path")
done < <(git status --porcelain -z --untracked-files=all)

if [[ ${#files[@]} -eq 0 ]]; then
  echo "No changed files." >&2
  exit 0
fi

# Skip macOS xattrs / ._* AppleDouble files so Linux tar extracts cleanly.
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$out" "${files[@]}" 2>/dev/null || COPYFILE_DISABLE=1 tar -czf "$out" "${files[@]}"
echo "Wrote $out (${#files[@]} files):"
printf '  %s\n' "${files[@]}"
