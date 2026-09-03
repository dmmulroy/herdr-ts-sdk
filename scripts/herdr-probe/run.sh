#!/bin/sh
set -eu

if [ ! -f /sdk/dist/index.mjs ]; then
  echo "missing /sdk/dist/index.mjs; build the SDK on the host first" >&2
  exit 1
fi

export HOME=/tmp/herdr-home
export XDG_CONFIG_HOME="$HOME/.config"
mkdir -p "$XDG_CONFIG_HOME"

herdr --version
herdr --session sdkprobe server &
herdr_pid=$!

sock="$XDG_CONFIG_HOME/herdr/sessions/sdkprobe/herdr.sock"
i=0
while [ "$i" -lt 50 ]; do
  if [ -S "$sock" ]; then
    break
  fi
  i=$((i + 1))
  sleep 0.1
done

if [ ! -S "$sock" ]; then
  echo "herdr socket did not appear: $sock" >&2
  exit 1
fi

export HERDR_SOCKET_PATH="$sock"
set +e
node /sdk/scripts/herdr-probe/ping.mjs
status=$?
set -e

herdr --session sdkprobe server stop >/dev/null 2>&1 || true
kill "$herdr_pid" 2>/dev/null || true
wait "$herdr_pid" 2>/dev/null || true
exit "$status"
