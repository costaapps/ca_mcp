#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

readonly deploy_root='/docker/containers/msg4/ca-mcp'
readonly image_repository='eduardomatuellacostaapps/ca'

if [[ $# -ne 5 ]]; then
  echo 'Invalid remote deploy arguments.' >&2
  exit 2
fi

run_number=$1
version_tag=$2
commit_sha=$3
image_digest=$4
bundle_path=$5

[[ $run_number =~ ^[1-9][0-9]*$ ]] || { echo 'Invalid run number.' >&2; exit 2; }
[[ $version_tag =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo 'Invalid release tag.' >&2; exit 2; }
[[ $commit_sha =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid commit identifier.' >&2; exit 2; }
[[ $image_digest =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Invalid image digest.' >&2; exit 2; }
[[ $bundle_path =~ ^/docker/containers/msg4/ca-mcp/incoming/release-[1-9][0-9]*-[1-9][0-9]*\.tar\.gz$ ]] || {
  echo 'Invalid release bundle path.' >&2
  exit 2
}

mkdir -p "$deploy_root/releases" "$deploy_root/incoming"
exec 9>"$deploy_root/deploy.lock"
flock -x 9

release_dir="$deploy_root/releases/$run_number"
stage_dir="$deploy_root/releases/.${run_number}.stage.$$"
deployment_started=0
deployment_succeeded=0
failure_code='deploy_failed'
active_run_number=0
last_applied_run_number=0
active_tag=''
active_commit=''
active_digest=''

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
  printf '{"runNumber":%s,"versionTag":"%s","commit":"%s","digest":"%s","code":"%s","time":"%s"}\n' \
    "$run_number" "$version_tag" "$commit_sha" "$image_digest" "$code" "$(date -u +%FT%TZ)" > "$temp_file"
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
      if [[ $state == running && $health == healthy ]]; then
        return 0
      fi
      if [[ $state == exited || $state == dead ]]; then
        return 1
      fi
    fi
    sleep 2
  done
  return 1
}

recover_previous_release() {
  if (( active_run_number == 0 )); then
    compose "$release_dir" stop mcp >/dev/null 2>&1 || true
    compose "$release_dir" rm --force --stop mcp >/dev/null 2>&1 || true
    return 0
  fi

  local previous_dir="$deploy_root/releases/$active_run_number"
  [[ -f $previous_dir/compose.yaml && -f $previous_dir/release.env ]] || return 1
  local previous_image
  previous_image=$(sed -n 's/^MCP_IMAGE=//p' "$previous_dir/release.env" | head -n 1)
  [[ $previous_image == "$image_repository@$active_digest" && -f $previous_dir/installed.json ]] || return 1
  docker pull "$previous_image" >/dev/null || return 1
  compose "$previous_dir" up -d --no-build --pull never mcp >/dev/null || return 1
  wait_until_ready "$previous_dir"
}

on_exit() {
  local exit_code=$?
  trap - EXIT
  if (( exit_code != 0 && deployment_started == 1 && deployment_succeeded == 0 )); then
    if ! recover_previous_release; then
      failure_code='deploy_and_rollback_failed'
    fi
    write_failure "$failure_code" || true
  fi
  rm -rf -- "$stage_dir"
  rm -f -- "$bundle_path"
  exit "$exit_code"
}
trap on_exit EXIT

if [[ -f $deploy_root/current.json ]]; then
  active_run_number=$(json_int activeRunNumber "$deploy_root/current.json")
  last_applied_run_number=$(json_int lastAppliedRunNumber "$deploy_root/current.json")
  active_tag=$(json_string versionTag "$deploy_root/current.json")
  active_commit=$(json_string commit "$deploy_root/current.json")
  active_digest=$(json_string digest "$deploy_root/current.json")
  [[ $active_run_number =~ ^[0-9]+$ && $last_applied_run_number =~ ^[0-9]+$ ]] || {
    echo 'Current deployment state is malformed; refusing to update.' >&2
    exit 1
  }
  if (( active_run_number > 0 )); then
    [[ $active_tag =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || {
      echo 'Current deployment tag is malformed; refusing to update.' >&2
      exit 1
    }
    [[ $active_commit =~ ^[a-f0-9]{40}$ && $active_digest =~ ^sha256:[a-f0-9]{64}$ ]] || {
      echo 'Current deployment identity is malformed; refusing to update.' >&2
      exit 1
    }
  fi
fi

if (( run_number < last_applied_run_number )) || \
  (( run_number == last_applied_run_number && active_run_number != run_number )); then
  write_failure 'stale_release_rejected'
  echo 'A later deployment or rollback already superseded this workflow run.' >&2
  exit 1
fi

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

if [[ ! -f $bundle_path ]]; then
  write_failure 'release_bundle_missing'
  echo 'The uploaded release bundle is missing.' >&2
  exit 1
fi

if ! bundle_names=$(tar --quoting-style=c -tzf "$bundle_path") || \
  ! bundle_details=$(tar --quoting-style=c -tvzf "$bundle_path"); then
  write_failure 'release_bundle_invalid'
  echo 'The release bundle must contain only compose.yaml and release.env.' >&2
  exit 1
fi
mapfile -t bundle_members <<< "$bundle_names"
mapfile -t bundle_entries <<< "$bundle_details"
declare -A seen_bundle_members=()
if (( ${#bundle_members[@]} != 2 || ${#bundle_entries[@]} != 2 )); then
  write_failure 'release_bundle_invalid'
  echo 'The release bundle must contain only compose.yaml and release.env.' >&2
  exit 1
fi
for index in 0 1; do
  member=${bundle_members[$index]}
  entry=${bundle_entries[$index]}
  if [[ ( $member != '"compose.yaml"' && $member != '"release.env"' ) ||
        -n ${seen_bundle_members[$member]+present} || ${entry:0:1} != '-' ]]; then
    write_failure 'release_bundle_invalid'
    echo 'The release bundle must contain two unique regular files: compose.yaml and release.env.' >&2
    exit 1
  fi
  seen_bundle_members[$member]=1
done

mkdir -m 0750 "$stage_dir"
tar -xzf "$bundle_path" --no-same-owner --no-same-permissions -C "$stage_dir"
expected_image="$image_repository@$image_digest"
printf 'MCP_IMAGE=%s\nMCP_RUN_NUMBER=%s\n' "$expected_image" "$run_number" > "$stage_dir/release.env"
printf '{"runNumber":%s,"versionTag":"%s","commit":"%s","digest":"%s"}\n' \
  "$run_number" "$version_tag" "$commit_sha" "$image_digest" > "$stage_dir/release.json"
chmod 0640 "$stage_dir/release.env" "$stage_dir/release.json"

if [[ -e $release_dir ]]; then
  if [[ ! -f $release_dir/release.json || ! -f $release_dir/compose.yaml || ! -f $release_dir/release.env ]] || \
    ! cmp -s "$stage_dir/release.json" "$release_dir/release.json" || \
    ! cmp -s "$stage_dir/compose.yaml" "$release_dir/compose.yaml" || \
    ! cmp -s "$stage_dir/release.env" "$release_dir/release.env"; then
    write_failure 'release_run_collision'
    echo 'This workflow run already has a different release bundle on the VPS.' >&2
    exit 1
  fi
  rm -rf -- "$stage_dir"
else
  mv -- "$stage_dir" "$release_dir"
fi

if ! docker compose version >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  write_failure 'docker_unavailable'
  echo 'Docker Engine and Docker Compose must be available to the deploy user.' >&2
  exit 1
fi

if ! compose "$release_dir" config --quiet; then
  write_failure 'compose_config_invalid'
  echo 'The release Compose configuration is invalid.' >&2
  exit 1
fi
compose_services=$(compose "$release_dir" config --services)
if [[ $compose_services != 'mcp' ]]; then
  write_failure 'compose_service_scope_invalid'
  echo 'The release must define only the MCP service.' >&2
  exit 1
fi

if ! docker pull "$expected_image" >/dev/null; then
  write_failure 'image_pull_failed'
  echo 'The published image digest could not be pulled.' >&2
  exit 1
fi

if ! docker image inspect "$expected_image" --format '{{range .RepoDigests}}{{println .}}{{end}}' | grep -Fxq "$expected_image"; then
  write_failure 'image_digest_mismatch'
  echo 'The pulled image does not contain the requested repository digest.' >&2
  exit 1
fi

deployment_started=1
if ! compose "$release_dir" up -d --no-build --pull never mcp >/dev/null || \
  ! wait_until_ready "$release_dir"; then
  echo 'The new MCP release did not become ready; restoring the previous release.' >&2
  exit 1
fi

container_id=$(compose "$release_dir" ps -q mcp)
installed_image=$(docker inspect --format '{{.Config.Image}}' "$container_id")
if [[ $installed_image != "$expected_image" ]]; then
  failure_code='installed_image_mismatch'
  echo 'The running MCP container does not use the published digest.' >&2
  exit 1
fi

state_temp=$(mktemp "$deploy_root/.current.XXXXXX")
installed_temp=$(mktemp "$release_dir/.installed.XXXXXX")
printf '{"runNumber":%s,"versionTag":"%s","commit":"%s","digest":"%s","installedAt":"%s"}\n' \
  "$run_number" "$version_tag" "$commit_sha" "$image_digest" "$(date -u +%FT%TZ)" > "$installed_temp"
chmod 0640 "$installed_temp"
mv -f -- "$installed_temp" "$release_dir/installed.json"
printf '{"activeRunNumber":%s,"versionTag":"%s","commit":"%s","digest":"%s","lastAppliedRunNumber":%s,"updatedAt":"%s"}\n' \
  "$run_number" "$version_tag" "$commit_sha" "$image_digest" "$run_number" "$(date -u +%FT%TZ)" > "$state_temp"
chmod 0640 "$state_temp"
mv -f -- "$state_temp" "$deploy_root/current.json"
deployment_succeeded=1
rm -f -- "$deploy_root/last-failure.json"
echo "MCP release $version_tag (run $run_number, $image_digest) is ready."
