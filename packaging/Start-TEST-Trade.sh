#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "${PNB_HOME:-}" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    export PNB_HOME="${HOME}/Library/Application Support/PNB-Pilot"
  else
    export PNB_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}/PNB-Pilot"
  fi
fi
exec "${script_dir}/node" "${script_dir}/pnb/trade.mjs" "$@"
