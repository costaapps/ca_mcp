#!/usr/bin/env bash
set -Eeuo pipefail

readonly image_repository='eduardomatuellacostaapps/ca'
readonly deploy_root='/docker/containers/msg4/ca-mcp'

usage() {
  echo 'Usage: deploy-vps.sh <run-number> <vX.Y.Z> <commit-sha> <sha256:digest>' >&2
  exit 2
}

[[ $# -eq 4 ]] || usage
run_number=$1
version_tag=$2
commit_sha=$3
image_digest=$4

[[ $run_number =~ ^[1-9][0-9]*$ ]] || usage
[[ $version_tag =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || usage
[[ $commit_sha =~ ^[a-f0-9]{40}$ ]] || usage
[[ $image_digest =~ ^sha256:[a-f0-9]{64}$ ]] || usage

deploy_host=${MCP_DEPLOY_HOST:-}
deploy_user=${MCP_DEPLOY_USER:-}
deploy_port=${MCP_DEPLOY_PORT:-22}
ssh_private_key=${MCP_DEPLOY_SSH_KEY:-}
ssh_known_hosts=${MCP_DEPLOY_KNOWN_HOSTS:-}

[[ $deploy_host =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || { echo 'MCP_DEPLOY_HOST is missing or invalid.' >&2; exit 2; }
[[ $deploy_user =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || { echo 'MCP_DEPLOY_USER is missing or invalid.' >&2; exit 2; }
[[ $deploy_port =~ ^[0-9]{1,5}$ ]] && (( deploy_port >= 1 && deploy_port <= 65535 )) || { echo 'MCP_DEPLOY_PORT is invalid.' >&2; exit 2; }
[[ -n $ssh_private_key ]] || { echo 'MCP_DEPLOY_SSH_KEY is required.' >&2; exit 2; }
[[ -n $ssh_known_hosts ]] || { echo 'MCP_DEPLOY_KNOWN_HOSTS is required.' >&2; exit 2; }

work_dir=$(mktemp -d)
key_file="$work_dir/deploy_key"
known_hosts_file="$work_dir/known_hosts"
bundle_file="$work_dir/release.tar.gz"
remote_bundle="$deploy_root/incoming/release-${run_number}-${GITHUB_RUN_ATTEMPT:-1}.tar.gz"
target="$deploy_user@$deploy_host"

cleanup() {
  rm -rf -- "$work_dir"
}
trap cleanup EXIT

umask 077
printf '%s\n' "$ssh_private_key" > "$key_file"
printf '%s\n' "$ssh_known_hosts" > "$known_hosts_file"
unset ssh_private_key ssh_known_hosts

mkdir -p "$work_dir/bundle"
cp compose.yaml "$work_dir/bundle/compose.yaml"
printf 'MCP_IMAGE=%s@%s\nMCP_RUN_NUMBER=%s\n' "$image_repository" "$image_digest" "$run_number" \
  > "$work_dir/bundle/release.env"
tar -czf "$bundle_file" -C "$work_dir/bundle" compose.yaml release.env

ssh_options=(
  -i "$key_file"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$known_hosts_file"
  -o ConnectTimeout=15
  -o ServerAliveInterval=10
  -o ServerAliveCountMax=6
)

ssh "${ssh_options[@]}" -p "$deploy_port" "$target" "install -d -m 0750 '$deploy_root/incoming'"
scp "${ssh_options[@]}" -P "$deploy_port" "$bundle_file" "$target:$remote_bundle"
ssh "${ssh_options[@]}" -p "$deploy_port" "$target" \
  "bash -s -- '$run_number' '$version_tag' '$commit_sha' '$image_digest' '$remote_bundle'" \
  < ops/deploy/remote-deploy.sh
