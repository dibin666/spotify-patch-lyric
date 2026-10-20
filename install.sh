#!/usr/bin/env bash
# Spot-Lyric for Spotify — install and update (macOS / Linux). Windows: install.ps1.
#
#   curl -fsSL https://lyric.564616.xyz | bash                 install; update when installed
#   curl -fsSL https://lyric.564616.xyz | bash -s -- setup     any command below
#
# Fetches the latest release into the data directory (app/) and installs this script as the
# `spot-lyric` command (~/.local/bin). patch.sh of that release does the actual work.
#
#   spot-lyric [update]   update to the latest release, keeping the settings (install when new)
#   spot-lyric setup      choose the usage mode again
#   spot-lyric status | restore | uninstall | help
#
# Portable to the bash 3.2 that ships with macOS.
set -Eeuo pipefail

REPO=dibin666/spotify-patch-lyric
SITE="${SPOT_LYRIC_SITE:-https://lyric.564616.xyz}"
SITE="${SITE%/}"
GITHUB="https://github.com/$REPO"

COLOR=0; [[ -t 1 && -z ${NO_COLOR:-} ]] && COLOR=1
paint() { if [[ $COLOR == 1 ]]; then printf '\033[%sm%s\033[0m' "$1" "$2"; else printf '%s' "$2"; fi; }
say()  { printf '%s %s\n' "$(paint '1;32' '[spot-lyric]')" "$*"; }
warn() { printf '%s %s\n' "$(paint '1;33' '[spot-lyric]')" "$*" >&2; }
die()  { printf '%s %s\n' "$(paint '1;31' '[spot-lyric]')" "$*" >&2; exit 1; }

case "${SPOT_LYRIC_PLATFORM:-$(uname -s)}" in
  Darwin|macos) DATA="$HOME/Library/Application Support/SpotLyric" ;;
  Linux|linux)  DATA="${XDG_DATA_HOME:-$HOME/.local/share}/spot-lyric" ;;
  *) die "不支持的系统：$(uname -s)。Windows 请在 PowerShell 中运行：irm $SITE | iex" ;;
esac
[[ -n ${SPOT_LYRIC_DATA:-} ]] && DATA="$SPOT_LYRIC_DATA"
APP="$DATA/app"
BIN_DIR="${SPOT_LYRIC_BIN:-$HOME/.local/bin}"
BIN="$BIN_DIR/spot-lyric"
RC_MARK='# added by spot-lyric'

# patch.sh asks for sudo itself when a step needs it; the command and the data belong to the user.
if [[ $(id -u) == 0 && -n ${SUDO_USER:-} ]]; then die "请不要用 sudo 运行；需要管理员权限时脚本会自己询问"; fi

usage() {
  cat <<USAGE
Spot-Lyric for Spotify$(installed_version >/dev/null 2>&1 && printf ' v%s' "$(installed_version)")

用法: spot-lyric [命令] [选项]

  spot-lyric             更新到最新版本，沿用当前设置（未安装时进入安装向导）
  spot-lyric update      同上
  spot-lyric setup       重新设置：选择使用方式、歌词服务器等
  spot-lyric status      查看安装状态
  spot-lyric restore     还原 Spotify 原始文件（保留设置）
  spot-lyric uninstall   卸载，并移除 spot-lyric 命令
  spot-lyric version     查看已安装和最新的版本

安装向导的选项（如 --mode local -y）同 patch.sh，见 spot-lyric help-patch。
没有 spot-lyric 命令时可以直接运行：curl -fsSL $SITE | bash
USAGE
}

# ------------------------------------------------------------- download ---
http() {  # http URL [OUT_FILE] -> body on stdout or into OUT_FILE
  if command -v curl >/dev/null 2>&1; then
    if [[ -n ${2:-} ]]; then curl -fsSL --connect-timeout 15 --retry 2 -o "$2" "$1"; else curl -fsSL --connect-timeout 15 -m 30 "$1"; fi
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 30 -O "${2:--}" "$1"
  else die "需要 curl 或 wget"; fi
}
# GitHub answers /releases/latest with a redirect to /releases/tag/<tag>.
github_latest() {
  if command -v curl >/dev/null 2>&1; then curl -fsSI --connect-timeout 15 -m 30 "$GITHUB/releases/latest" 2>/dev/null
  else wget -q -S --max-redirect=0 -O /dev/null "$GITHUB/releases/latest" 2>&1; fi |
    tr -d '\r' | sed -n 's#^ *[Ll]ocation: .*/releases/tag/\(v[0-9][0-9.]*\)$#\1#p' | head -n1
}
latest_tag() {
  local tag
  tag="$( (http "$SITE/latest" 2>/dev/null || true) | sed -n 's/.*"tag" *: *"\(v[0-9][0-9.]*\)".*/\1/p' | head -n1)"
  [[ -n $tag ]] || tag="$(github_latest || true)"
  [[ -n $tag ]] || return 1
  printf '%s' "$tag"
}
installed_version() { [[ -f $APP/VERSION && -f $APP/patch.sh ]] && tr -d ' \r\n' < "$APP/VERSION"; }

# Release source archive -> $APP (the previous copy is replaced only after a complete download).
fetch_release() {  # fetch_release TAG
  local tag="$1" tmp url ok=0
  tmp="$(mktemp -d)"
  for url in "$SITE/archive/$tag.tar.gz" "$GITHUB/archive/refs/tags/$tag.tar.gz"; do
    rm -rf "$tmp/src"; mkdir -p "$tmp/src"
    if http "$url" "$tmp/src.tar.gz" 2>/dev/null && tar xzf "$tmp/src.tar.gz" -C "$tmp/src" --strip-components=1 2>/dev/null &&
       [[ -f $tmp/src/patch.sh && -f $tmp/src/src/app.js ]]; then ok=1; break; fi
  done
  if [[ $ok != 1 ]]; then rm -rf "$tmp"; die "下载 $tag 失败，请检查网络后重试"; fi
  mkdir -p "$DATA"
  rm -rf "$APP.old"
  [[ -d $APP ]] && mv "$APP" "$APP.old"
  mv "$tmp/src" "$APP"
  rm -rf "$APP.old" "$tmp"
}

# Latest release in $APP. Offline with a copy installed: keep using it.
ensure_latest() {
  local tag have
  have="$(installed_version || true)"
  if ! tag="$(latest_tag)"; then
    [[ -n $have ]] || die "无法获取最新版本（${SITE}、github.com 都连不上），请检查网络后重试"
    warn "无法检查新版本，继续使用已安装的 v$have"; return 0
  fi
  if [[ $have == "${tag#v}" ]]; then say "已是最新版本 $tag"; return 0; fi
  if [[ -n $have ]]; then say "发现新版本：v$have → ${tag}，正在下载…"; else say "下载 Spot-Lyric ${tag}…"; fi
  fetch_release "$tag"
}
ensure_app() { [[ -n $(installed_version || true) ]] || ensure_latest; }

# ------------------------------------------------------------- command ---
path_has_bin() { case ":$PATH:" in *":$BIN_DIR:"*) return 0 ;; esac; return 1; }
shell_rcs() {
  local rc
  for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do [[ -f $rc ]] && printf '%s\n' "$rc"; done
  # A fresh macOS account has no ~/.zshrc yet; zsh is its login shell.
  [[ $(uname -s) == Darwin && ! -f $HOME/.zshrc ]] && printf '%s\n' "$HOME/.zshrc"
  return 0
}
install_command() {
  local rc line
  mkdir -p "$BIN_DIR"
  cp "$APP/install.sh" "$BIN.tmp" && chmod 755 "$BIN.tmp" && mv -f "$BIN.tmp" "$BIN"
  path_has_bin && return 0
  line="export PATH=\"$BIN_DIR:\$PATH\" $RC_MARK"
  while IFS= read -r rc; do
    [[ -n $rc ]] || continue
    grep -qF "$RC_MARK" "$rc" 2>/dev/null || printf '\n%s\n' "$line" >> "$rc"
  done <<< "$(shell_rcs)"
  NEW_PATH=1
}
remove_command() {
  local rc
  rm -f "$BIN"
  for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
    [[ -f $rc ]] && grep -qF "$RC_MARK" "$rc" && { grep -vF "$RC_MARK" "$rc" > "$rc.spot-lyric.tmp" && cat "$rc.spot-lyric.tmp" > "$rc"; rm -f "$rc.spot-lyric.tmp"; }
  done
  return 0
}
command_hint() {
  if [[ ${NEW_PATH:-0} == 1 ]]; then say "以后更新：重新打开终端后运行 spot-lyric（或 ${BIN}）"
  else say "以后更新：运行 spot-lyric"; fi
}

# ---------------------------------------------------------------- main ---
NEW_PATH=0
cmd="${1:-}"
[[ $# -gt 0 ]] && shift
# Options without a command (curl ... | bash -s -- --mode local -y): the install wizard.
if [[ $cmd == -* && $cmd != -h && $cmd != --help ]]; then set -- "$cmd" "$@"; cmd=install; fi
# Run through a pipe (curl ... | bash): prompts read the terminal, never the rest of this script.
run_patch() {
  local rc
  set +e
  if [[ ! -t 0 ]] && { : < /dev/tty; } 2>/dev/null; then bash "$APP/patch.sh" "$@" < /dev/tty; else bash "$APP/patch.sh" "$@"; fi
  rc=$?
  set -e
  return $rc
}

case "$cmd" in
  ""|update|install)
    ensure_latest
    install_command
    # Installed before (settings recorded): update without any question.
    if [[ -z $cmd ]]; then if [[ -f $DATA/config ]]; then cmd=update; else cmd=install; fi; fi
    rc=0; run_patch "$cmd" "$@" || rc=$?
    [[ $rc == 0 ]] && command_hint
    exit $rc ;;
  setup)
    ensure_latest; install_command
    run_patch setup "$@" ;;
  uninstall)
    ensure_app
    run_patch uninstall "$@"
    remove_command
    rm -rf "$APP"
    rmdir "$DATA" 2>/dev/null || true
    say "已移除 spot-lyric 命令" ;;
  version|--version)
    have="$(installed_version || true)"
    printf '已安装：%s\n' "${have:+v$have}${have:-未安装}"
    printf '最新：%s\n' "$(latest_tag || echo 无法获取)" ;;
  help|-h|--help) usage ;;
  help-patch) ensure_app; run_patch --help ;;
  *) ensure_app; run_patch "$cmd" "$@" ;;
esac
