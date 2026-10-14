#!/usr/bin/env bash
set -Eeuo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/ca-mcp-deploy-test.XXXXXX")
trap 'rm -rf -- "$test_root"' EXIT

readonly run_one=101
readonly run_two=102
readonly run_three=103
readonly run_four=104
readonly version_one='v0.2.0'
readonly commit_one='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
readonly digest_one='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
readonly version_two='v0.2.1'
readonly commit_two='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
readonly digest_two='sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
readonly version_three='v0.2.2'
readonly commit_three='cccccccccccccccccccccccccccccccccccccccc'
readonly digest_three='sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
readonly version_four='v0.2.3'
readonly commit_four='dddddddddddddddddddddddddddddddddddddddd'
readonly digest_four='sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
}

setup_sandbox() {
  local label=$1
  SANDBOX="$test_root/$label"
  DEPLOY_ROOT="$SANDBOX/remote/ca-mcp"
  MOCK_STATE="$SANDBOX/docker-state"
  MOCK_BIN="$SANDBOX/bin"
  mkdir -p "$DEPLOY_ROOT/shared" "$DEPLOY_ROOT/incoming" "$MOCK_STATE" "$MOCK_BIN"
  chmod 0700 "$SANDBOX" "$DEPLOY_ROOT" "$DEPLOY_ROOT/shared" "$DEPLOY_ROOT/incoming"
  cat > "$DEPLOY_ROOT/shared/runtime.env" <<'EOF'
CENTRAL_DB_HOST=registry.test
CENTRAL_DB_PORT=3306
CENTRAL_DB_NAME=registry
CENTRAL_DB_USER=readonly
CENTRAL_DB_PASS=test-only-value
MCP_TENANT_ALLOWLIST=550e8400-e29b-41d4-a716-446655440000
EOF
  chmod 0600 "$DEPLOY_ROOT/shared/runtime.env"
  cp "$repo_root/ops/deploy/remote-deploy.sh" "$SANDBOX/remote-deploy.sh"
  cp "$repo_root/ops/deploy/remote-rollback.sh" "$SANDBOX/remote-rollback.sh"
  # Isolate the scripts' fixed production path in a disposable copy. The
  # checked-in production scripts are never executed against the host path.
  sed -i "s|readonly deploy_root='/docker/containers/msg4/ca-mcp'|readonly deploy_root='$DEPLOY_ROOT'|" \
    "$SANDBOX/remote-deploy.sh" "$SANDBOX/remote-rollback.sh"
  sed -i "s|\\^/docker/containers/msg4/ca-mcp/incoming|^$DEPLOY_ROOT/incoming|" \
    "$SANDBOX/remote-deploy.sh"
  cat > "$MOCK_BIN/docker" <<'MOCK_DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$MOCK_DOCKER_LOG"

active_dir_file="$MOCK_DOCKER_STATE/active-directory"
active_image_file="$MOCK_DOCKER_STATE/active-image"
active_run_file="$MOCK_DOCKER_STATE/active-run"
local_images_file="$MOCK_DOCKER_STATE/local-images"
touch "$local_images_file"

if [[ ${1:-} == info ]]; then exit 0; fi
if [[ ${1:-} == pull ]]; then
  image=${2:-}
  if [[ -n ${MOCK_FAIL_PULL_IMAGE:-} && $image == "$MOCK_FAIL_PULL_IMAGE" ]]; then exit 23; fi
  if ! grep -Fxq -- "$image" "$local_images_file"; then printf '%s\n' "$image" >> "$local_images_file"; fi
  exit 0
fi
if [[ ${1:-} == image && ${2:-} == inspect ]]; then
  image=${3:-}
  if [[ ${MOCK_BAD_DIGEST_IMAGE:-} == "$image" ]]; then exit 1; fi
  if ! grep -Fxq -- "$image" "$local_images_file"; then exit 1; fi
  printf '%s\n' "$image"
  exit 0
fi
if [[ ${1:-} == inspect ]]; then
  format=${3:-}
  [[ -f $active_dir_file ]] || exit 1
  current_dir=$(<"$active_dir_file")
  current_run=$(<"$active_run_file")
  case "$format" in
    '{{.State.Status}}')
      if [[ ${MOCK_FAIL_HEALTH_RUN:-} == "$current_run" ]]; then printf 'exited\n'; else printf 'running\n'; fi
      ;;
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}')
      if [[ ${MOCK_FAIL_HEALTH_RUN:-} == "$current_run" ]]; then printf 'unhealthy\n'; else printf 'healthy\n'; fi
      ;;
    '{{.Config.Image}}')
      cat "$active_image_file"
      ;;
    *) exit 2 ;;
  esac
  exit 0
fi
if [[ ${1:-} != compose ]]; then exit 2; fi
if [[ ${2:-} == version ]]; then exit 0; fi

args=("$@")
index=1
directory=''
while (( index < ${#args[@]} )); do
  case ${args[$index]} in
    --project-name|--env-file|--file)
      index=$((index + 2))
      ;;
    --project-directory)
      directory=${args[$((index + 1))]}
      index=$((index + 2))
      ;;
    *) break ;;
  esac
done
operation=${args[$index]:-}
next=${args[$((index + 1))]:-}
[[ -n $directory ]] || exit 2
release_run=$(sed -n 's/^MCP_RUN_NUMBER=//p' "$directory/release.env" | head -n 1)
release_image=$(sed -n 's/^MCP_IMAGE=//p' "$directory/release.env" | head -n 1)

case "$operation" in
  config)
    if [[ ${MOCK_FAIL_CONFIG_RUN:-} == "$release_run" ]]; then exit 24; fi
    if [[ $next == --services ]]; then printf '%s\n' "${MOCK_COMPOSE_SERVICES:-mcp}"; fi
    ;;
  ps)
    if [[ -f $active_dir_file && $(<"$active_dir_file") == "$directory" ]]; then printf 'mock-mcp-container\n'; fi
    ;;
  up)
    [[ $next == -d ]] || exit 2
    if [[ ${MOCK_FAIL_UP_RUN:-} == "$release_run" ]]; then exit 25; fi
    printf '%s' "$directory" > "$active_dir_file"
    printf '%s' "$release_image" > "$active_image_file"
    printf '%s' "$release_run" > "$active_run_file"
    if [[ ${MOCK_EVICT_IMAGE_ON_RUN:-} == "$release_run" && -n ${MOCK_EVICT_IMAGE:-} ]]; then
      grep -Fxv -- "$MOCK_EVICT_IMAGE" "$local_images_file" > "$local_images_file.tmp" || true
      mv -f -- "$local_images_file.tmp" "$local_images_file"
    fi
    ;;
  stop|rm)
    if [[ -f $active_dir_file && $(<"$active_dir_file") == "$directory" ]]; then
      rm -f -- "$active_dir_file" "$active_image_file" "$active_run_file"
    fi
    ;;
  *) exit 2 ;;
esac
MOCK_DOCKER
  chmod 0700 "$MOCK_BIN/docker"
  export MOCK_DOCKER_STATE="$MOCK_STATE"
  export MOCK_DOCKER_LOG="$SANDBOX/docker.log"
  export PATH="$MOCK_BIN:$PATH"
  : > "$MOCK_DOCKER_LOG"
  unset MOCK_FAIL_PULL_IMAGE MOCK_BAD_DIGEST_IMAGE MOCK_FAIL_HEALTH_RUN MOCK_FAIL_UP_RUN MOCK_FAIL_CONFIG_RUN MOCK_COMPOSE_SERVICES MOCK_EVICT_IMAGE MOCK_EVICT_IMAGE_ON_RUN || true
}

make_regular_bundle() {
  local run_number=$1 attempt=$2
  local source_dir="$SANDBOX/bundle-$run_number-$attempt"
  mkdir -p "$source_dir"
  cat > "$source_dir/compose.yaml" <<'EOF'
services:
  mcp:
    image: ${MCP_IMAGE:?MCP_IMAGE is required}
EOF
  printf 'MCP_IMAGE=eduardomatuellacostaapps/ca@sha256:%064d\nMCP_RUN_NUMBER=%s\n' 0 "$run_number" > "$source_dir/release.env"
  local bundle="$DEPLOY_ROOT/incoming/release-$run_number-$attempt.tar.gz"
  tar -czf "$bundle" -C "$source_dir" compose.yaml release.env
  printf '%s' "$bundle"
}

deploy() {
  local run_number=$1 tag=$2 commit=$3 digest=$4 attempt=$5 bundle result
  bundle=$(make_regular_bundle "$run_number" "$attempt")
  if bash "$SANDBOX/remote-deploy.sh" "$run_number" "$tag" "$commit" "$digest" "$bundle"; then
    result=0
  else
    result=$?
  fi
  return "$result"
}

rollback() {
  bash "$SANDBOX/remote-rollback.sh" "$1"
}

state_field() {
  local field=$1
  sed -n "s/.*\"$field\":\([0-9][0-9]*\).*/\1/p" "$DEPLOY_ROOT/current.json"
}

assert_mock_release_ready() {
  local expected_run=$1 expected_image=$2
  [[ $(<"$MOCK_STATE/active-run") == "$expected_run" ]] || fail "mock service is not on run $expected_run"
  [[ $(docker inspect --format '{{.State.Status}}' mock-mcp-container) == running ]] || fail "run $expected_run is not running"
  [[ $(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' mock-mcp-container) == healthy ]] || fail "run $expected_run is not healthy"
  [[ $(docker inspect --format '{{.Config.Image}}' mock-mcp-container) == "$expected_image" ]] || fail "run $expected_run uses the wrong image digest"
}

expect_failure() {
  if "$@"; then fail "expected failure: $*"; fi
}

setup_sandbox "transactions"
deploy "$run_one" "$version_one" "$commit_one" "$digest_one" 1 || fail 'first installation failed'
[[ $(state_field activeRunNumber) == "$run_one" ]] || fail 'first installation did not become active'
[[ -f $DEPLOY_ROOT/releases/$run_one/installed.json ]] || fail 'first release was not registered as installed'
[[ $(<"$MOCK_STATE/active-run") == "$run_one" ]] || fail 'first release is not the isolated mock Docker service'
[[ $(grep -c 'up -d --no-build --pull never mcp' "$MOCK_DOCKER_LOG") == 1 ]] || fail 'deployment did not target exactly the mcp service'
pass 'first install records release and updates only the mcp service'

deploy "$run_one" "$version_one" "$commit_one" "$digest_one" 2 || fail 'same-run retry was not idempotent'
[[ $(state_field activeRunNumber) == "$run_one" ]] || fail 'same-run retry changed the active release'
pass 're-executing an identical workflow run reuses its registered release'

deploy "$run_two" "$version_two" "$commit_two" "$digest_two" 1 || fail 'second install failed'
[[ $(state_field activeRunNumber) == "$run_two" ]] || fail 'second release did not become active'
pass 'healthy update advances active release state'

calls_before=$(wc -l < "$MOCK_DOCKER_LOG")
expect_failure deploy "$run_one" "$version_one" "$commit_one" "$digest_one" 3
calls_after=$(wc -l < "$MOCK_DOCKER_LOG")
[[ $calls_before == "$calls_after" ]] || fail 'older run reached Docker after rejection'
[[ $(state_field activeRunNumber) == "$run_two" ]] || fail 'older run replaced the newer active release'
pass 'older workflow run cannot replace a newer deployment'

export MOCK_FAIL_HEALTH_RUN="$run_one"
export MOCK_FAIL_PULL_IMAGE="eduardomatuellacostaapps/ca@$digest_two"
expect_failure rollback "$run_one"
unset MOCK_FAIL_HEALTH_RUN MOCK_FAIL_PULL_IMAGE
[[ $(state_field activeRunNumber) == "$run_two" ]] || fail 'failed rollback did not preserve the active release'
assert_mock_release_ready "$run_two" "eduardomatuellacostaapps/ca@$digest_two"
[[ $(grep -Fx "pull eduardomatuellacostaapps/ca@$digest_two" "$MOCK_DOCKER_LOG" | wc -l) == 1 ]] || fail 'failed rollback pulled the already available previous digest'
[[ $(grep -o '"code":"[^"]*"' "$DEPLOY_ROOT/last-failure.json") == '"code":"rollback_failed"' ]] || fail 'rollback failure code was not recorded'
pass 'failed rollback restores the cached previous digest without pulling it and records failure'

rollback "$run_one" || fail 'rollback to registered release failed'
[[ $(state_field activeRunNumber) == "$run_one" ]] || fail 'rollback target was not recorded as active'
[[ $(state_field lastAppliedRunNumber) == "$run_two" ]] || fail 'rollback lost the high-water run number'
[[ $(<"$MOCK_STATE/active-run") == "$run_one" ]] || fail 'rollback did not switch the isolated mock container'
pass 'successful rollback preserves the stale-run high-water mark'

calls_before=$(wc -l < "$MOCK_DOCKER_LOG")
expect_failure deploy "$run_two" "$version_two" "$commit_two" "$digest_two" 2
calls_after=$(wc -l < "$MOCK_DOCKER_LOG")
[[ $calls_before == "$calls_after" ]] || fail 'stale run reached Docker after rejection'
[[ $(state_field activeRunNumber) == "$run_one" ]] || fail 'stale run changed active state'
pass 'stale workflow run is rejected before invoking Docker'

export MOCK_FAIL_HEALTH_RUN="$run_three"
export MOCK_FAIL_PULL_IMAGE="eduardomatuellacostaapps/ca@$digest_one"
previous_digest_pulls=$(grep -Fx "pull eduardomatuellacostaapps/ca@$digest_one" "$MOCK_DOCKER_LOG" | wc -l)
expect_failure deploy "$run_three" "$version_three" "$commit_three" "$digest_three" 1
unset MOCK_FAIL_HEALTH_RUN MOCK_FAIL_PULL_IMAGE
[[ $(state_field activeRunNumber) == "$run_one" ]] || fail 'failed startup changed recorded active release'
assert_mock_release_ready "$run_one" "eduardomatuellacostaapps/ca@$digest_one"
[[ $(grep -Fx "pull eduardomatuellacostaapps/ca@$digest_one" "$MOCK_DOCKER_LOG" | wc -l) == "$previous_digest_pulls" ]] || fail 'unhealthy update pulled the already available previous digest'
[[ $(grep -o '"code":"[^"]*"' "$DEPLOY_ROOT/last-failure.json") == '"code":"deploy_failed"' ]] || fail 'unhealthy update did not record its failure code'
pass 'unhealthy update restores the cached previous digest without pulling it and records failure'

export MOCK_FAIL_PULL_IMAGE="eduardomatuellacostaapps/ca@$digest_four"
expect_failure deploy "$run_four" "$version_four" "$commit_four" "$digest_four" 1
unset MOCK_FAIL_PULL_IMAGE
[[ $(state_field activeRunNumber) == "$run_one" ]] || fail 'pull failure changed recorded active release'
[[ $(<"$MOCK_STATE/active-run") == "$run_one" ]] || fail 'pull failure changed the active mock container'
[[ $(grep -o '"code":"[^"]*"' "$DEPLOY_ROOT/last-failure.json") == '"code":"image_pull_failed"' ]] || fail 'pull failure code was not recorded'
pass 'image pull failure leaves the active service and state untouched'

setup_sandbox "cache-recovery-pull"
deploy "$run_one" "$version_one" "$commit_one" "$digest_one" 1 || fail 'cache recovery fixture install failed'
export MOCK_FAIL_HEALTH_RUN="$run_two"
export MOCK_EVICT_IMAGE="eduardomatuellacostaapps/ca@$digest_one"
export MOCK_EVICT_IMAGE_ON_RUN="$run_two"
expect_failure deploy "$run_two" "$version_two" "$commit_two" "$digest_two" 1
unset MOCK_FAIL_HEALTH_RUN MOCK_EVICT_IMAGE MOCK_EVICT_IMAGE_ON_RUN
[[ $(<"$MOCK_STATE/active-run") == "$run_one" ]] || fail 'missing cached image was not pulled to restore the previous release'
[[ $(grep -Fx "pull eduardomatuellacostaapps/ca@$digest_one" "$MOCK_DOCKER_LOG" | wc -l) == 2 ]] || fail 'recovery did not pull the absent previous image digest'
[[ $(grep -o '"code":"[^"]*"' "$DEPLOY_ROOT/last-failure.json") == '"code":"deploy_failed"' ]] || fail 'successful recovery did not record the original deploy failure'
pass 'recovery pulls a verified previous digest when it is absent locally'

setup_sandbox "cache-recovery-failure"
deploy "$run_one" "$version_one" "$commit_one" "$digest_one" 1 || fail 'failed-recovery fixture install failed'
export MOCK_FAIL_HEALTH_RUN="$run_two"
export MOCK_EVICT_IMAGE="eduardomatuellacostaapps/ca@$digest_one"
export MOCK_EVICT_IMAGE_ON_RUN="$run_two"
export MOCK_FAIL_PULL_IMAGE="eduardomatuellacostaapps/ca@$digest_one"
expect_failure deploy "$run_two" "$version_two" "$commit_two" "$digest_two" 1
unset MOCK_FAIL_HEALTH_RUN MOCK_EVICT_IMAGE MOCK_EVICT_IMAGE_ON_RUN MOCK_FAIL_PULL_IMAGE
[[ $(state_field activeRunNumber) == "$run_one" ]] || fail 'failed recovery changed the last confirmed release state'
[[ $(<"$MOCK_STATE/active-run") == "$run_two" ]] || fail 'failed recovery mock did not remain on the unready candidate'
[[ $(grep -o '"code":"[^"]*"' "$DEPLOY_ROOT/last-failure.json") == '"code":"deploy_and_rollback_failed"' ]] || fail 'failed recovery was not recorded in failure JSON'
pass 'failed recovery preserves current.json and records deploy_and_rollback_failed'

setup_sandbox "rollback-recovery-failure"
deploy "$run_one" "$version_one" "$commit_one" "$digest_one" 1 || fail 'rollback recovery fixture install failed'
deploy "$run_two" "$version_two" "$commit_two" "$digest_two" 1 || fail 'rollback recovery fixture update failed'
export MOCK_FAIL_HEALTH_RUN="$run_one"
export MOCK_EVICT_IMAGE="eduardomatuellacostaapps/ca@$digest_two"
export MOCK_EVICT_IMAGE_ON_RUN="$run_one"
export MOCK_FAIL_PULL_IMAGE="eduardomatuellacostaapps/ca@$digest_two"
expect_failure rollback "$run_one"
[[ $(state_field activeRunNumber) == "$run_two" ]] || fail 'failed rollback recovery advanced confirmed current.json'
[[ $(state_field lastAppliedRunNumber) == "$run_two" ]] || fail 'failed rollback recovery changed the high-water run number'
[[ $(<"$MOCK_STATE/active-run") == "$run_one" ]] || fail 'failed rollback recovery mock did not remain on the unhealthy rollback target'
[[ $(docker inspect --format '{{.State.Status}}' mock-mcp-container) == exited ]] || fail 'rollback target should remain stopped/unhealthy after recovery failure'
[[ $(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' mock-mcp-container) == unhealthy ]] || fail 'rollback target health should remain unhealthy after recovery failure'
[[ $(grep -o '"code":"[^"]*"' "$DEPLOY_ROOT/last-failure.json") == '"code":"rollback_and_recovery_failed"' ]] || fail 'rollback recovery failure was not recorded in failure JSON'
[[ $(grep -Fx "pull eduardomatuellacostaapps/ca@$digest_two" "$MOCK_DOCKER_LOG" | wc -l) == 2 ]] || fail 'rollback recovery did not make exactly one pull attempt after cache eviction'
unset MOCK_FAIL_HEALTH_RUN MOCK_EVICT_IMAGE MOCK_EVICT_IMAGE_ON_RUN MOCK_FAIL_PULL_IMAGE
pass 'evicted rollback recovery digest fails safely and records rollback_and_recovery_failed'

setup_sandbox "first-install-failure"
export MOCK_FAIL_HEALTH_RUN="$run_one"
expect_failure deploy "$run_one" "$version_one" "$commit_one" "$digest_one" 1
unset MOCK_FAIL_HEALTH_RUN
[[ ! -f $DEPLOY_ROOT/current.json ]] || fail 'failed first install wrote a successful current state'
[[ ! -f $MOCK_STATE/active-run ]] || fail 'failed first install left a container running'
[[ $(grep -o '"code":"[^"]*"' "$DEPLOY_ROOT/last-failure.json") == '"code":"deploy_failed"' ]] || fail 'first install failure was not recorded'
pass 'failed first install removes the failed container and records failure'

test_invalid_bundle() {
  local case_name=$1 maker=$2 original_config checksum bundle rc
  setup_sandbox "bundle-$case_name"
  original_config=$(sha256sum "$DEPLOY_ROOT/shared/runtime.env" | cut -d ' ' -f 1)
  bundle="$DEPLOY_ROOT/incoming/release-$run_one-1.tar.gz"
  "$maker" "$bundle"
  if bash "$SANDBOX/remote-deploy.sh" "$run_one" "$version_one" "$commit_one" "$digest_one" "$bundle"; then
    rc=0
  else
    rc=$?
  fi
  (( rc != 0 )) || fail "$case_name bundle unexpectedly accepted"
  checksum=$(sha256sum "$DEPLOY_ROOT/shared/runtime.env" | cut -d ' ' -f 1)
  [[ $checksum == "$original_config" ]] || fail "$case_name bundle changed external runtime configuration"
  [[ ! -f $DEPLOY_ROOT/current.json ]] || fail "$case_name bundle created current state"
  [[ $(grep -o '"code":"[^"]*"' "$DEPLOY_ROOT/last-failure.json") == '"code":"release_bundle_invalid"' ]] || fail "$case_name bundle failure code is wrong"
  pass "$case_name bundle rejected before extraction or deployment"
}

make_symlink_bundle() {
  local bundle=$1 source_dir="$SANDBOX/malicious-symlink"
  mkdir -p "$source_dir"
  printf 'services: {}\n' > "$source_dir/compose.yaml"
  ln -s ../../shared/runtime.env "$source_dir/release.env"
  tar -czf "$bundle" -C "$source_dir" compose.yaml release.env
}

make_hardlink_bundle() {
  local bundle=$1 source_dir="$SANDBOX/malicious-hardlink"
  mkdir -p "$source_dir"
  printf 'services: {}\n' > "$source_dir/compose.yaml"
  ln "$source_dir/compose.yaml" "$source_dir/release.env"
  tar -czf "$bundle" -C "$source_dir" compose.yaml release.env
}

make_traversal_bundle() {
  local bundle=$1 source_dir="$SANDBOX/malicious-traversal"
  mkdir -p "$source_dir"
  printf 'services: {}\n' > "$source_dir/compose.yaml"
  printf 'sentinel\n' > "$SANDBOX/escape.env"
  tar --absolute-names --transform='s|escape.env|../../shared/runtime.env|' -czf "$bundle" \
    -C "$SANDBOX" escape.env -C "$source_dir" compose.yaml
}

make_duplicate_bundle() {
  local bundle=$1 source_dir="$SANDBOX/malicious-duplicate"
  mkdir -p "$source_dir/first" "$source_dir/second"
  printf 'services: {}\n' > "$source_dir/first/compose.yaml"
  printf 'MCP_IMAGE=bad\n' > "$source_dir/first/release.env"
  printf 'services: {other: {}}\n' > "$source_dir/second/compose.yaml"
  tar -czf "$bundle" -C "$source_dir/first" compose.yaml release.env \
    -C "$source_dir/second" compose.yaml
}

make_fifo_bundle() {
  local bundle=$1 source_dir="$SANDBOX/malicious-fifo"
  mkdir -p "$source_dir"
  printf 'services: {}\n' > "$source_dir/compose.yaml"
  mkfifo "$source_dir/release.env"
  tar -czf "$bundle" -C "$source_dir" compose.yaml release.env
}

test_invalid_bundle symlink make_symlink_bundle
test_invalid_bundle hardlink make_hardlink_bundle
test_invalid_bundle traversal make_traversal_bundle
test_invalid_bundle duplicate make_duplicate_bundle
test_invalid_bundle fifo make_fifo_bundle

setup_sandbox "port-omitted"
sed -i '/^CENTRAL_DB_PORT=/d' "$DEPLOY_ROOT/shared/runtime.env"
deploy "$run_one" "$version_one" "$commit_one" "$digest_one" 1 || fail 'omitted CENTRAL_DB_PORT should use the application default'
[[ $(state_field activeRunNumber) == "$run_one" ]] || fail 'omitted port configuration did not deploy'
pass 'omitted CENTRAL_DB_PORT is accepted'

for invalid_port in 0 65536 abc; do
  setup_sandbox "port-invalid-$invalid_port"
  sed -i '/^CENTRAL_DB_PORT=/d' "$DEPLOY_ROOT/shared/runtime.env"
  printf 'CENTRAL_DB_PORT=%s\n' "$invalid_port" >> "$DEPLOY_ROOT/shared/runtime.env"
  bundle=$(make_regular_bundle "$run_one" 1)
  expect_failure bash "$SANDBOX/remote-deploy.sh" "$run_one" "$version_one" "$commit_one" "$digest_one" "$bundle"
  [[ $(grep -o '"code":"[^"]*"' "$DEPLOY_ROOT/last-failure.json") == '"code":"runtime_config_invalid"' ]] || fail "invalid port $invalid_port was not recorded"
  [[ ! -s $MOCK_DOCKER_LOG ]] || fail "invalid port $invalid_port reached Docker"
done
pass 'provided CENTRAL_DB_PORT values are range and type validated'

setup_sandbox "rollback-port-omitted"
deploy "$run_one" "$version_one" "$commit_one" "$digest_one" 1 || fail 'rollback port fixture install failed'
deploy "$run_two" "$version_two" "$commit_two" "$digest_two" 1 || fail 'rollback port fixture update failed'
sed -i '/^CENTRAL_DB_PORT=/d' "$DEPLOY_ROOT/shared/runtime.env"
rollback "$run_one" || fail 'rollback should accept omitted CENTRAL_DB_PORT'
[[ $(state_field activeRunNumber) == "$run_one" ]] || fail 'rollback with omitted port did not activate its target'
pass 'rollback also accepts omitted CENTRAL_DB_PORT'

setup_sandbox "rollback-port-invalid"
deploy "$run_one" "$version_one" "$commit_one" "$digest_one" 1 || fail 'invalid rollback port fixture install failed'
deploy "$run_two" "$version_two" "$commit_two" "$digest_two" 1 || fail 'invalid rollback port fixture update failed'
sed -i '/^CENTRAL_DB_PORT=/d' "$DEPLOY_ROOT/shared/runtime.env"
printf 'CENTRAL_DB_PORT=65536\n' >> "$DEPLOY_ROOT/shared/runtime.env"
calls_before=$(wc -l < "$MOCK_DOCKER_LOG")
expect_failure rollback "$run_one"
calls_after=$(wc -l < "$MOCK_DOCKER_LOG")
[[ $calls_before == "$calls_after" ]] || fail 'invalid rollback port reached Docker'
[[ $(state_field activeRunNumber) == "$run_two" ]] || fail 'invalid rollback port changed the confirmed release'
[[ $(grep -o '"code":"[^"]*"' "$DEPLOY_ROOT/last-failure.json") == '"code":"runtime_config_invalid"' ]] || fail 'invalid rollback port was not recorded'
pass 'rollback rejects an out-of-range CENTRAL_DB_PORT before Docker'

setup_sandbox "compose-scope"
export MOCK_COMPOSE_SERVICES=$'mcp\nother-service'
expect_failure deploy "$run_one" "$version_one" "$commit_one" "$digest_one" 1
unset MOCK_COMPOSE_SERVICES
[[ ! -f $DEPLOY_ROOT/current.json ]] || fail 'multi-service Compose file created active state'
if grep -Eq 'pull | up ' "$MOCK_DOCKER_LOG"; then fail 'multi-service Compose config reached image pull or service update'; fi
pass 'Compose bundle containing another service is refused before update'

echo 'All isolated deploy-script checks passed.'
