#!/usr/bin/env bash
set -euo pipefail

script_dir="${BASH_SOURCE[0]%/*}"
repo_root="$(git -C "$script_dir/.." rev-parse --show-toplevel)"
probe_dir="$repo_root/scripts/herdr-probe"

if [[ ! -f "$repo_root/dist/index.mjs" ]]; then
  echo "missing $repo_root/dist/index.mjs; run pnpm run build first" >&2
  exit 1
fi

arch="$(uname -m)"
case "$arch" in
  arm64 | aarch64) herdr_arch="aarch64" ;;
  x86_64 | amd64) herdr_arch="x86_64" ;;
  *)
    echo "unsupported arch: $arch" >&2
    exit 1
    ;;
esac

rows=(
  "17|v0.7.5|"
  "18|preview-2026-07-29-44b3adb12552|"
  "19|v0.8.0|"
  "20|v0.8.2|"
  "21|preview-2026-08-31-b1ff4582e968|"
  "16|v0.7.4|1"
)

failed=0
for row in "${rows[@]}"; do
  IFS='|' read -r protocol tag expect_failure <<<"$row"
  url="https://github.com/herdrdev/herdr/releases/download/${tag}/herdr-linux-${herdr_arch}"
  image="herdr-sdk-probe:${tag}"
  echo "=== protocol ${protocol}  ${tag} ==="
  docker build \
    --build-arg "HERDR_DOWNLOAD_URL=$url" \
    -t "$image" \
    "$probe_dir"
  if docker run --rm --network none \
    -v "$repo_root:/sdk:ro" \
    -e "EXPECT_PROTOCOL=$protocol" \
    -e "EXPECT_FAILURE=${expect_failure}" \
    "$image"; then
    echo "PASS protocol ${protocol}"
  else
    echo "FAIL protocol ${protocol}" >&2
    failed=1
  fi
done

exit "$failed"
