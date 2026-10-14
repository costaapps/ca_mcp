#!/usr/bin/env bash
set -Eeuo pipefail

[[ $# -eq 1 && $1 =~ ^[1-9][0-9]*$ ]] || {
  echo 'Usage: rollback-vps.sh <previously-deployed-run-number>' >&2
  exit 2
}
run_number=$1

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
trap 'rm -rf -- "$work_dir"' EXIT
umask 077
printf '%s\n' "$ssh_private_key" > "$key_file"
printf '%s\n' "$ssh_known_hosts" > "$known_hosts_file"
unset ssh_private_key ssh_known_hosts

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
target="$deploy_user@$deploy_host"
ssh "${ssh_options[@]}" -p "$deploy_port" "$target" "bash -s -- '$run_number'" < ops/deploy/remote-rollback.sh
