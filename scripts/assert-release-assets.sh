#!/usr/bin/env bash
# Fail if a GitHub Release is missing any required installer.
# Used by release.yml so a half-built Latest (e.g. mac+linux, no Windows)
# never looks "done".
#
# Usage:
#   bash scripts/assert-release-assets.sh v0.2.33
#   bash scripts/assert-release-assets.sh v0.2.33 --repo RongleCat/grok-app
set -euo pipefail

TAG="${1:-}"
REPO="${GITHUB_REPOSITORY:-}"
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO="${2:-}"
      shift 2
      ;;
    *)
      echo "usage: $0 <tag> [--repo owner/name]" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$TAG" ]]; then
  echo "usage: $0 <tag> [--repo owner/name]" >&2
  exit 2
fi
TAG="${TAG#v}"
TAG="v${TAG}"
VER="${TAG#v}"

if [[ -z "$REPO" ]]; then
  echo "error: set GITHUB_REPOSITORY or pass --repo owner/name" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI required" >&2
  exit 1
fi

# Portable across macOS bash 3.2 (no mapfile) and Ubuntu CI.
ASSETS_RAW="$(
  gh release view "$TAG" --repo "$REPO" --json assets \
    --jq '.assets[].name' 2>/dev/null | sort -u
)"
ASSETS=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" ]] && continue
  ASSETS+=("$line")
done <<<"$ASSETS_RAW"

if [[ ${#ASSETS[@]} -eq 0 ]]; then
  echo "error: no assets on $TAG ($REPO) — release missing or empty" >&2
  exit 1
fi

has() {
  local pat="$1"
  local a
  for a in "${ASSETS[@]}"; do
    # shellcheck disable=SC2053
    if [[ "$a" == $pat ]]; then
      return 0
    fi
  done
  return 1
}

# Patterns match versioned Tauri / portable names (see docs/llm-wiki/release.md).
REQUIRED=(
  "Grok_${VER}_aarch64.dmg"
  "Grok_${VER}_x64.dmg"
  "Grok_${VER}_x64-setup.exe"
  "Grok_${VER}_x64-portable.zip"
  "Grok_${VER}_amd64.AppImage"
  "Grok_${VER}_amd64.deb"
  "Grok-${VER}-1.x86_64.rpm|Grok-${VER}.x86_64.rpm|Grok_${VER}_x86_64.rpm|Grok_${VER}_amd64.rpm"
)

missing=()
for spec in "${REQUIRED[@]}"; do
  IFS='|' read -r -a alts <<<"$spec"
  ok=0
  for alt in "${alts[@]}"; do
    if has "$alt"; then
      ok=1
      break
    fi
  done
  if [[ $ok -eq 0 ]]; then
    missing+=("${alts[0]}")
  fi
done

echo "==> Assets on $TAG ($REPO):"
printf '  - %s\n' "${ASSETS[@]}"

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "::error::Release $TAG is incomplete — missing required installer(s):" >&2
  for m in "${missing[@]}"; do
    echo "  - $m" >&2
  done
  echo "All of macOS (arm+x64), Windows (setup+portable), and Linux (AppImage/deb/rpm) must upload before the release is done." >&2
  exit 1
fi

echo "==> All required installers present on $TAG"
