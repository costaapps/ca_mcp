#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

readonly deploy_root='/docker/containers/msg4/ca-mcp'
readonly image_repository='eduardomatuellacostaapps/ca'

[[ $# -eq 1 && $1 =~ ^[1-9][0-9]*$ ]] || { echo 'Invalid rollback target.' >&2; exit 2; }
target_run_number=$1
current_file="$deploy_root/current.json"
target_dir="$deploy_root/releases/$target_run_number"
rollback_started=0
rollback_succeeded=0
failure_code='rollback_failed'

json_int() {
  local name=$1 file=$2
  sed -n "s/.*\"$name\":\([0-9][0-9]*\).*/\1/p" "$file" | head -n 1
}

json_string() {
  local name=$1 file=$2
  sed -n "s/.*\"$name\":\"\([^\"]*\)\".*/\1/p" "$file" | head -n 1
}

write_failure() {
  local code=$1 temp_file
  temp_file=$(mktemp "$deploy_root/.last-failure.XXXXXX")
  printf '{"operation":"rollback","targetRunNumber":%s,"code":"%s","time":"%s"}\n' \
    "$target_run_number" "$code" "$(date -u +%FT%TZ)" > "$temp_file"
  chmod 0640 "$temp_file"
  mv -f -- "$temp_file" "$deploy_root/last-failure.json"
}

compose() {
  local directory=$1
  shift
  docker compose --project-name ca-mcp --project-directory "$directory" \
    --env-file "$directory/release.env" --file "$directory/compose.yaml" "$@"
}

wait_until_ready() {
  local directory=$1 deadline=$((SECONDS + 120)) container_id state health
  while (( SECONDS < deadline )); do
    container_id=$(compose "$directory" ps -q mcp 2>/dev/null || true)
    if [[ -n $container_id ]]; then
      state=$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || true)
      health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id" 2>/dev/null || true)
      if [[ $state == running && $health == healthy ]]; then return 0; fi
      if [[ $state == exited || $state == dead ]]; then return 1; fi
    fi
    sleep 2
  done
  return 1
}

restore_current_release() {
  if (( active_run_number == 0 )); then
    compose "$target_dir" stop mcp >/dev/null 2>&1 || true
    compose "$target_dir" rm --force --stop mcp >/dev/null 2>&1 || true
    return 0
  fi
  local current_dir="$deploy_root/releases/$active_run_number"
  [[ -f $current_dir/compose.yaml && -f $current_dir/release.env && -f $current_dir/installed.json ]] || return 1
  local current_image
  current_image=$(sed -n 's/^MCP_IMAGE=//p' "$current_dir/release.env" | head -n 1)
  [[ $current_image == "$image_repository@$active_digest" ]] || return 1
  docker pull "$current_image" >/dev/null || return 1
  compose "$current_dir" up -d --no-build --pull never mcp >/dev/null || return 1
  wait_until_ready "$current_dir"
}

on_exit() {
  local exit_code=$?
  trap - EXIT
  if (( exit_code != 0 && rollback_started == 1 && rollback_succeeded == 0 )); then
    if ! restore_current_release; then failure_code='rollback_and_recovery_failed'; fi
    write_failure "$failure_code" || true
  fi
  exit "$exit_code"
}
trap on_exit EXIT

mkdir -p "$deploy_root/releases"
exec 9>"$deploy_root/deploy.lock"
flock -x 9

if [[ ! -f $current_file ]]; then
  write_failure 'no_active_release'
  echo 'There is no active release to roll back from.' >&2
  exit 1
fi
active_run_number=$(json_int activeRunNumber "$current_file")
last_applied_run_number=$(json_int lastAppliedRunNumber "$current_file")
active_tag=$(json_string versionTag "$current_file")
active_commit=$(json_string commit "$current_file")
active_digest=$(json_string digest "$current_file")
[[ $active_run_number =~ ^[0-9]+$ && $last_applied_run_number =~ ^[0-9]+$ ]] || {
  write_failure 'current_state_invalid'
  echo 'Current deployment state is malformed.' >&2
  exit 1
}
if (( active_run_number > 0 )); then
  [[ $active_tag =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ &&
     $active_commit =~ ^[a-f0-9]{40}$ && $active_digest =~ ^sha256:[a-f0-9]{64}$ ]] || {
    write_failure 'current_state_invalid'
    echo 'Current deployment identity is malformed.' >&2
    exit 1
  }
fi

[[ -f $target_dir/compose.yaml && -f $target_dir/release.env && -f $target_dir/release.json && -f $target_dir/installed.json ]] || {
  write_failure 'rollback_target_not_registered'
  echo 'Rollback target is not a previously installed release.' >&2
  exit 1
}
recorded_run_number=$(json_int runNumber "$target_dir/release.json")
installed_run_number=$(json_int runNumber "$target_dir/installed.json")
target_tag=$(json_string versionTag "$target_dir/release.json")
target_commit=$(json_string commit "$target_dir/release.json")
target_digest=$(json_string digest "$target_dir/release.json")
installed_digest=$(json_string digest "$target_dir/installed.json")
[[ $recorded_run_number == "$target_run_number" && $installed_run_number == "$target_run_number" &&
   $target_tag =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ &&
   $target_commit =~ ^[a-f0-9]{40}$ && $target_digest =~ ^sha256:[a-f0-9]{64}$ &&
   $installed_digest == "$target_digest" ]] || {
  write_failure 'rollback_target_invalid'
  echo 'Rollback target metadata is invalid.' >&2
  exit 1
}
target_image="$image_repository@$target_digest"
stored_image=$(sed -n 's/^MCP_IMAGE=//p' "$target_dir/release.env" | head -n 1)
[[ $stored_image == "$target_image" ]] || {
  write_failure 'rollback_image_mismatch'
  echo 'Rollback target image does not match its recorded digest.' >&2
  exit 1
}

if [[ ! -f $deploy_root/shared/runtime.env ]]; then
  write_failure 'runtime_config_missing'
  echo 'The external shared/runtime.env file is required.' >&2
  exit 1
fi
config_mode=$(stat -c '%a' "$deploy_root/shared/runtime.env")
if [[ $config_mode != 600 ]]; then
  write_failure 'runtime_config_permissions'
  echo 'shared/runtime.env must have mode 0600.' >&2
  exit 1
fi
for required_key in CENTRAL_DB_HOST CENTRAL_DB_PORT CENTRAL_DB_NAME CENTRAL_DB_USER CENTRAL_DB_PASS MCP_TENANT_ALLOWLIST; do
  if ! awk -F= -v key="$required_key" '$1 == key { value = substr($0, index($0, "=") + 1); gsub(/^[[:space:]]+|[[:space:]]+$/, "", value); if (value != "" && value != "\"\"" && value != "\047\047") found = 1 } END { exit !found }' \
    "$deploy_root/shared/runtime.env"; then
    write_failure 'runtime_config_incomplete'
    echo "shared/runtime.env is missing a non-empty $required_key setting." >&2
    exit 1
  fi
done
if awk -F= '/^DB_/ { found = 1 } $1 == "CORE_API_URL" { found = 1 } END { exit !found }' "$deploy_root/shared/runtime.env"; then
  write_failure 'legacy_global_database_config'
  echo 'Remove legacy DB_* and CORE_API_URL entries from shared/runtime.env.' >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1 || ! docker info >/dev/null 2>&1 || ! compose "$target_dir" config --quiet; then
  write_failure 'docker_or_compose_unavailable'
  echo 'Docker, Compose, or the stored release configuration is unavailable.' >&2
  exit 1
fi
compose_services=$(compose "$target_dir" config --services)
if [[ $compose_services != 'mcp' ]]; then
  write_failure 'compose_service_scope_invalid'
  echo 'The stored release must define only the MCP service.' >&2
  exit 1
fi
if ! docker pull "$target_image" >/dev/null; then
  write_failure 'rollback_image_pull_failed'
  echo 'The rollback image digest could not be pulled.' >&2
  exit 1
fi

rollback_started=1
if ! compose "$target_dir" up -d --no-build --pull never mcp >/dev/null || ! wait_until_ready "$target_dir"; then
  echo 'The rollback target did not become ready; restoring the previously active release.' >&2
  exit 1
fi
container_id=$(compose "$target_dir" ps -q mcp)
installed_image=$(docker inspect --format '{{.Config.Image}}' "$container_id")
if [[ $installed_image != "$target_image" ]]; then
  failure_code='rollback_installed_image_mismatch'
  echo 'The running MCP container does not use the rollback digest.' >&2
  exit 1
fi

state_temp=$(mktemp "$deploy_root/.current.XXXXXX")
printf '{"activeRunNumber":%s,"versionTag":"%s","commit":"%s","digest":"%s","lastAppliedRunNumber":%s,"updatedAt":"%s"}\n' \
  "$target_run_number" "$target_tag" "$target_commit" "$target_digest" "$last_applied_run_number" "$(date -u +%FT%TZ)" > "$state_temp"
chmod 0640 "$state_temp"
mv -f -- "$state_temp" "$current_file"
rollback_succeeded=1
rm -f -- "$deploy_root/last-failure.json"
echo "MCP rolled back to $target_tag (run $target_run_number, $target_digest)."
