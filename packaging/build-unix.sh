#!/usr/bin/env bash
set -euo pipefail

node_version="${NODE_VERSION:-24.22.1}"
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="${OUTPUT_DIR:-${repo_dir}/build}"
os_name="$(uname -s)"
arch_name="$(uname -m)"
case "${os_name}:${arch_name}" in
  Linux:x86_64) platform="linux-x64"; extension="tar.xz" ;;
  Linux:aarch64) platform="linux-arm64"; extension="tar.xz" ;;
  Darwin:x86_64) platform="darwin-x64"; extension="tar.gz" ;;
  Darwin:arm64) platform="darwin-arm64"; extension="tar.gz" ;;
  *) echo "Unsupported platform: ${os_name} ${arch_name}" >&2; exit 2 ;;
esac

stamp="$(date -u +%Y%m%d%H%M%S)"
package_name="pnb-pilot-${platform}-${stamp}"
stage_dir="${output_dir}/${package_name}"
runtime_dir="${output_dir}/_runtime-${platform}-${stamp}"
downloads_dir="${output_dir}/downloads"
runtime_file="node-v${node_version}-${platform}.${extension}"
runtime_archive="${downloads_dir}/${runtime_file}"
checksum_file="${downloads_dir}/SHASUMS256-${node_version}.txt"
mkdir -p "${downloads_dir}" "${stage_dir}/pnb/examples" "${runtime_dir}"
if [[ ! -f "${runtime_archive}" ]]; then
  curl --fail --location --silent --show-error "https://nodejs.org/dist/v${node_version}/${runtime_file}" --output "${runtime_archive}"
fi
curl --fail --location --silent --show-error "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" --output "${checksum_file}"
expected="$(awk -v file="${runtime_file}" '$2 == file { print $1 }' "${checksum_file}")"
if [[ ! "${expected}" =~ ^[a-f0-9]{64}$ ]]; then echo "Official Node checksum missing" >&2; exit 1; fi
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${runtime_archive}" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "${runtime_archive}" | awk '{print $1}')"
fi
if [[ "${actual}" != "${expected}" ]]; then echo "Node runtime SHA-256 mismatch" >&2; exit 1; fi

tar -xf "${runtime_archive}" -C "${runtime_dir}"
runtime_root="${runtime_dir}/node-v${node_version}-${platform}"
cp "${runtime_root}/bin/node" "${stage_dir}/node"
cp "${runtime_root}/LICENSE" "${stage_dir}/NODE-LICENSE.txt"
cp "${repo_dir}/README.md" "${repo_dir}/PLAN.md" "${stage_dir}/"
cp "${repo_dir}/packaging/Start-PNB.sh" "${repo_dir}/packaging/Start-TEST-Trade.sh" "${stage_dir}/"
for file in app.mjs cli.mjs demo.mjs evm.html evm.mjs evm-ui.mjs index.html ledger.mjs node.mjs peer.mjs sample-ledger.json server.mjs trade.mjs; do
  cp "${repo_dir}/pnb/${file}" "${stage_dir}/pnb/${file}"
done
cp "${repo_dir}/pnb/examples/test-contract.txt" "${repo_dir}/pnb/examples/second-audit-finding.json" "${stage_dir}/pnb/examples/"
chmod 755 "${stage_dir}/node" "${stage_dir}/Start-PNB.sh" "${stage_dir}/Start-TEST-Trade.sh"
archive_path="${output_dir}/${package_name}.tar.gz"
tar -czf "${archive_path}" -C "${output_dir}" "${package_name}"
if command -v sha256sum >/dev/null 2>&1; then
  archive_hash="$(sha256sum "${archive_path}" | awk '{print $1}')"
else
  archive_hash="$(shasum -a 256 "${archive_path}" | awk '{print $1}')"
fi
printf 'PACKAGE=%s\nSHA256=%s\nNODE_SHA256=%s\n' "${archive_path}" "${archive_hash}" "${actual}"
