#!/usr/bin/env bash
# install.sh end to end (the `spot-lyric` command): a local stand-in for the update site
# (worker/: /latest, /archive/<tag>.tar.gz, /install.sh) serving the working tree as releases,
# a synthetic Spotify and a throw-away HOME. Needs python3 (http.server), zip / unzip.
#   install through the pipe -> update when up to date -> update to a new release -> offline
#   -> the old one-liner (patch.sh through the pipe) -> uninstall
set -uo pipefail
REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
T="$(mktemp -d)"; mkdir -p "$T"/{site/archive,home,spotify,src}
export SPOT_LYRIC_PLATFORM=linux
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -c1-16; }
mkdir -p "$T/aptconf"; export SPOT_LYRIC_APT_HOOK_DIR="$T/hookdir" SPOT_LYRIC_APT_HOOK_FILE="$T/aptconf/99spot-lyric-patch"
export HOME="$T/home" SPOT_LYRIC_DATA="$T/data" SPOT_LYRIC_BIN="$T/home/.local/bin" SPOTIFY_PATH="$T/spotify" NO_COLOR=1
touch "$HOME/.bashrc"
PATH="/usr/bin:/bin"   # ~/.local/bin of the fake HOME not on PATH

# synthetic xpui.spa
( cd "$T/src" && printf '<html><body><div id="main"></div></body></html>' > index.html && printf 'x' > xpui.js && zip -q -X "$T/spotify/xpui.spa" index.html xpui.js )
mkdir -p "$T/spotify/Apps" && mv "$T/spotify/xpui.spa" "$T/spotify/Apps/"
orig_sha=$(sha "$T/spotify/Apps/xpui.spa")

release() {  # release VERSION : archive of the working tree as tag vVERSION, /latest points to it
  local v=$1; local d="$T/build/spotify-patch-lyric-$v"
  rm -rf "$T/build"; mkdir -p "$d"
  (cd "$REPO_DIR" && git ls-files -co --exclude-standard | grep -v '^docs/' | tar cf - -T - ) | tar xf - -C "$d"
  echo "$v" > "$d/VERSION"
  tar czf "$T/site/archive/v$v.tar.gz" -C "$T/build" "spotify-patch-lyric-$v"
  printf '{"tag":"v%s","version":"%s","notes":"- 测试","url":"x"}' "$v" "$v" > "$T/site/latest"
}
release 1.5.0
cp "$REPO_DIR/install.sh" "$T/site/install.sh"
port=$((20000 + RANDOM % 20000))
( cd "$T/site" && exec python3 -m http.server "$port" --bind 127.0.0.1 >/dev/null 2>&1 ) & srv=$!
trap 'kill $srv 2>/dev/null; rm -rf "$T"' EXIT
sleep 1
export SPOT_LYRIC_SITE="http://127.0.0.1:$port"
pass=0 fail=0
check() { if eval "$2"; then echo "  ✔ $1"; pass=$((pass+1)); else echo "  ✘ $1"; fail=$((fail+1)); fi; }
marker() { unzip -p "$T/spotify/Apps/xpui.spa" index.html | sed -n 's/.*spot-lyric:start v\([^ ]*\) .*/\1/p'; }

echo "== 1. fresh install through the pipe, options only"
out=$(curl -fsSL "$SPOT_LYRIC_SITE/install.sh" | bash -s -- --mode cloud --request server --no-hook --no-restart -y 2>&1); echo "$out" | sed 's/^/     /' | tail -6
check "release downloaded" '[[ $(cat "$T/data/app/VERSION") == 1.5.0 && -f $T/data/app/patch.sh ]]'
check "spot-lyric command installed" '[[ -x $HOME/.local/bin/spot-lyric ]] && cmp -s "$HOME/.local/bin/spot-lyric" "$T/data/app/install.sh"'
check "PATH line added to .bashrc once" '[[ $(grep -c "added by spot-lyric" "$HOME/.bashrc") == 1 ]]'
check "config recorded" 'grep -q "^mode=cloud" "$T/data/config"'
check "plugin v1.5.0 injected" '[[ $(marker) == 1.5.0 ]]'
check "update site baked into the plugin" 'unzip -p "$T/spotify/Apps/xpui.spa" spot-lyric/spot-lyric.js | grep -c "SITE_BAKED = .http://127.0.0.1:$port." >/dev/null'

echo "== 2. spot-lyric (no arguments) when already up to date: update, no questions"
out=$("$HOME/.local/bin/spot-lyric" --no-restart 2>&1 </dev/null); rc=$?; echo "$out" | sed 's/^/     /' | tail -5
check "exit 0" '[[ $rc == 0 ]]'
check "says already latest" '[[ $out == *"已是最新版本 v1.5.0"* && $out == *"插件已是最新"* ]]'
check "no wizard questions" '[[ $out != *"选择使用方式"* ]]'

echo "== 3. new release v1.5.1: spot-lyric updates and re-patches with the same settings"
release 1.5.1
out=$("$HOME/.local/bin/spot-lyric" update --no-restart 2>&1 </dev/null); rc=$?; echo "$out" | sed 's/^/     /' | tail -6
check "exit 0" '[[ $rc == 0 ]]'
check "downloaded v1.5.1" '[[ $out == *"v1.5.0 → v1.5.1"* && $(cat "$T/data/app/VERSION") == 1.5.1 ]]'
check "plugin v1.5.1 injected" '[[ $(marker) == 1.5.1 ]]'
check "settings kept" 'grep -q "^mode=cloud" "$T/data/config" && grep -q "^request=server" "$T/data/config"'
check "no leftovers" '[[ ! -e $T/data/app.old ]]'
check "still one PATH line" '[[ $(grep -c "added by spot-lyric" "$HOME/.bashrc") == 1 ]]'

echo "== 4. update site down: keeps working with the installed copy"
kill $srv; sleep 0.5
out=$(SPOT_LYRIC_SITE=http://127.0.0.1:1 "$HOME/.local/bin/spot-lyric" status 2>&1 </dev/null); rc=$?
check "status runs offline" '[[ $rc == 0 && $out == *"插件版本：v1.5.1"* ]]'
( cd "$T/site" && exec python3 -m http.server "$port" --bind 127.0.0.1 >/dev/null 2>&1 ) & srv=$!; sleep 1

echo "== 5. the old one-liner (curl .../patch.sh | bash) hands over to install.sh"
cp "$REPO_DIR/patch.sh" "$T/site/patch.sh"
out=$(curl -fsSL "$SPOT_LYRIC_SITE/patch.sh" | bash -s -- status 2>&1); rc=$?
check "runs the installed release" '[[ $rc == 0 && $out == *"获取安装程序"* && $out == *"插件版本：v1.5.1"* ]]'

echo "== 6. spot-lyric uninstall"
out=$("$HOME/.local/bin/spot-lyric" uninstall --no-restart -y 2>&1 </dev/null); rc=$?; echo "$out" | sed 's/^/     /' | tail -4
check "exit 0" '[[ $rc == 0 ]]'
check "Spotify restored byte-identical" '[[ $(sha "$T/spotify/Apps/xpui.spa") == "$orig_sha" ]]'
check "command and app removed" '[[ ! -e $HOME/.local/bin/spot-lyric && ! -e $T/data/app ]]'
check "PATH line removed" '! grep -q "added by spot-lyric" "$HOME/.bashrc"'

echo "passed $pass, failed $fail"
[[ $fail == 0 ]]
