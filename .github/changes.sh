#!/usr/bin/env bash
# CI change detection (used by .github/workflows/ci.yml, job "changes").
# Writes go / plugin / scripts / docker / version = true|false to $GITHUB_OUTPUT.
# version is true only when VERSION itself changed: it gates the release job so
# server-only pushes rebuild binaries / the image without touching the release.
#   EVENT  github.event_name     BEFORE  previous commit of a push     BASE  pull request base
# Also usable locally:  FILES="$(git diff --name-only A B)" .github/changes.sh
set -euo pipefail
out="${GITHUB_OUTPUT:-/dev/stdout}"
all() { for k in go plugin scripts docker version; do echo "$k=true" >> "$out"; done; echo "running everything: $1"; exit 0; }

if [[ -z ${FILES+x} ]]; then
  [[ ${EVENT:-} == workflow_dispatch ]] && all "manual run"
  [[ ${GITHUB_REF_TYPE:-} == tag ]] && all "tag"
  if [[ ${EVENT:-} == pull_request ]]; then range="$BASE...HEAD"; else range="${BEFORE:-}..${GITHUB_SHA:-HEAD}"; fi
  # New branch, force push or shallow history: nothing reliable to compare with.
  FILES="$(git diff --name-only "$range" 2>/dev/null)" || all "cannot diff $range"
fi
echo "changed files:"; printf '  %s\n' $FILES
has() { if printf '%s\n' "$FILES" | grep -Eq "$1"; then echo true; else echo false; fi; }
# Workflow edits still run every job, but only a real VERSION bump may release.
if [[ $(has '^\.github/') == true ]]; then
  {
    for k in go plugin scripts docker; do echo "$k=true"; done
    echo "version=$(has '^VERSION$')"
  } | tee -a "$out"
  echo "running everything: CI configuration changed"
  exit 0
fi
{
  echo "go=$(has '^(go\.(mod|sum)|[^/]+\.go|server/[^/]+\.go|cmd/|VERSION)$|^cmd/')"
  echo "plugin=$(has '^(src/|tests/[^/]+\.mjs$)')"
  echo "scripts=$(has '^(patch\.(sh|ps1|cmd)|install\.(sh|ps1)|tests/(patch|install)_test\.(sh|ps1)|VERSION)$|^src/')"
  echo "docker=$(has '^(go\.(mod|sum)|[^/]+\.go|VERSION)$|^(server|cmd)/')"
  echo "version=$(has '^VERSION$')"
} | tee -a "$out"
