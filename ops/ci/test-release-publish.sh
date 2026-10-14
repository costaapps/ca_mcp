#!/usr/bin/env bash
set -Eeuo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
readonly helper="$repo_root/ops/release/publish-tested-image.sh"
readonly release_workflow="$repo_root/.github/workflows/release.yml"
readonly ci_workflow="$repo_root/.github/workflows/ci.yml"
readonly test_root=$(mktemp -d "${TMPDIR:-/tmp}/ca-mcp-publish-test.XXXXXX")
trap 'rm -rf -- "$test_root"' EXIT

readonly repository='eduardomatuellacostaapps/ca'
readonly run_image="$repository:mcp-314"
readonly version_image="$repository:mcp-0.2.0"
readonly version='0.2.0'
readonly revision='0123456789abcdef0123456789abcdef01234567'
readonly run_number='314'
readonly image_id='sha256:1111111111111111111111111111111111111111111111111111111111111111'
readonly digest='sha256:abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'
readonly source='https://github.com/costaapps/ca_mcp'

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
}

tag_key() {
  case "$1" in
    "$run_image") printf 'RUN' ;;
    "$version_image") printf 'VERSION' ;;
    *) return 1 ;;
  esac
}

setup_case() {
  local name=$1 key
  CASE_ROOT="$test_root/$name"
  mkdir -p "$CASE_ROOT/bin" "$CASE_ROOT/state"
  MOCK_DOCKER_LOG="$CASE_ROOT/docker.log"
  MOCK_DOCKER_STATE="$CASE_ROOT/state"
  GITHUB_OUTPUT="$CASE_ROOT/github-output"
  : > "$MOCK_DOCKER_LOG"
  : > "$GITHUB_OUTPUT"
  export MOCK_DOCKER_LOG MOCK_DOCKER_STATE GITHUB_OUTPUT
  export IMAGE VERSION_IMAGE VERSION DOCKERHUB_IMAGE EXPECTED_REVISION EXPECTED_RUN MOCK_TESTED_IMAGE_ID
  export MOCK_REPOSITORY="$repository"
  IMAGE=$run_image
  VERSION_IMAGE=$version_image
  VERSION=$version
  DOCKERHUB_IMAGE=$repository
  EXPECTED_REVISION=$revision
  EXPECTED_RUN=$run_number
  MOCK_TESTED_IMAGE_ID=$image_id
  export MOCK_LOCAL_VERSION=$version MOCK_LOCAL_REVISION=$revision MOCK_LOCAL_RUN=$run_number
  export MOCK_LOCAL_SOURCE=$source MOCK_LOCAL_PLATFORM='linux/amd64'
  export MOCK_FAIL_PULL_REF='' MOCK_FAIL_PUSH_REF='' MOCK_PUSH_FAIL_ONCE=0

  for key in RUN VERSION; do
    printf -v "MOCK_TAG_STATE_$key" 'absent'
    printf -v "MOCK_REMOTE_DIGEST_$key" '%s' "$digest"
    printf -v "MOCK_REMOTE_IMAGE_ID_$key" '%s' "$image_id"
    printf -v "MOCK_REMOTE_VERSION_$key" '%s' "$version"
    printf -v "MOCK_REMOTE_REVISION_$key" '%s' "$revision"
    printf -v "MOCK_REMOTE_RUN_$key" '%s' "$run_number"
    printf -v "MOCK_REMOTE_SOURCE_$key" '%s' "$source"
    printf -v "MOCK_REMOTE_PLATFORM_$key" '%s' 'linux/amd64'
    export "MOCK_TAG_STATE_$key" "MOCK_REMOTE_DIGEST_$key" "MOCK_REMOTE_IMAGE_ID_$key"
    export "MOCK_REMOTE_VERSION_$key" "MOCK_REMOTE_REVISION_$key" "MOCK_REMOTE_RUN_$key"
    export "MOCK_REMOTE_SOURCE_$key" "MOCK_REMOTE_PLATFORM_$key"
  done

  cat > "$CASE_ROOT/bin/docker" <<'MOCK_DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$MOCK_DOCKER_LOG"

key_for() {
  case "$1" in
    "$IMAGE") printf RUN ;;
    "$VERSION_IMAGE") printf VERSION ;;
    *) echo "unexpected image reference: $1" >&2; exit 2 ;;
  esac
}

state_file() { printf '%s/%s-%s' "$MOCK_DOCKER_STATE" "$1" "$(key_for "$2")"; }

case ${1:-} in
  image)
    [[ ${2:-} == inspect ]] || exit 2
    format=${4:-}
    image_ref=${5:-}
    key=$(key_for "$image_ref")
    if [[ -f $(state_file pulled "$image_ref") ]]; then
      version_var="MOCK_REMOTE_VERSION_$key"
      revision_var="MOCK_REMOTE_REVISION_$key"
      run_var="MOCK_REMOTE_RUN_$key"
      source_var="MOCK_REMOTE_SOURCE_$key"
      platform_var="MOCK_REMOTE_PLATFORM_$key"
      digest_var="MOCK_REMOTE_DIGEST_$key"
      image_id_var="MOCK_REMOTE_IMAGE_ID_$key"
      version=${!version_var}
      revision=${!revision_var}
      run=${!run_var}
      source=${!source_var}
      platform=${!platform_var}
      image_digest=${!digest_var}
      actual_id=${!image_id_var}
    else
      version=$MOCK_LOCAL_VERSION
      revision=$MOCK_LOCAL_REVISION
      run=$MOCK_LOCAL_RUN
      source=$MOCK_LOCAL_SOURCE
      platform=$MOCK_LOCAL_PLATFORM
      image_digest=${MOCK_REMOTE_DIGEST_RUN}
      actual_id=$MOCK_TESTED_IMAGE_ID
    fi
    case $format in
      '{{ index .Config.Labels "org.opencontainers.image.version" }}') printf '%s\n' "$version" ;;
      '{{ index .Config.Labels "org.opencontainers.image.revision" }}') printf '%s\n' "$revision" ;;
      '{{ index .Config.Labels "com.costaapps.github.run" }}') printf '%s\n' "$run" ;;
      '{{ index .Config.Labels "org.opencontainers.image.source" }}') printf '%s\n' "$source" ;;
      '{{ .Os }}/{{ .Architecture }}') printf '%s\n' "$platform" ;;
      '{{.Id}}'|'{{ .Id }}') printf '%s\n' "$actual_id" ;;
      '{{range .RepoDigests}}{{println .}}{{end}}') printf '%s@%s\n' "$MOCK_REPOSITORY" "$image_digest" ;;
      *) exit 2 ;;
    esac
    ;;
  buildx)
    [[ ${2:-} == imagetools && ${3:-} == inspect ]] || exit 2
    image_ref=${4:-}
    key=$(key_for "$image_ref")
    state_var="MOCK_TAG_STATE_$key"
    digest_var="MOCK_REMOTE_DIGEST_$key"
    tag_state=${!state_var}
    if [[ $tag_state == error ]]; then
      echo 'unexpected Docker Hub inspection error' >&2
      exit 7
    fi
    if [[ $tag_state == unauthorized ]]; then
      echo 'ERROR: failed to authorize: authentication required' >&2
      exit 1
    fi
    if [[ $tag_state == network-error ]]; then
      echo 'ERROR: dial tcp: i/o timeout' >&2
      exit 1
    fi
    if [[ $tag_state == absent && ! -f $(state_file pushed "$image_ref") ]]; then
      echo "ERROR: docker.io/$image_ref: not found" >&2
      exit 1
    fi
    printf 'Name: docker.io/%s\nDigest: %s\n' "$image_ref" "${!digest_var}"
    ;;
  tag)
    [[ ${2:-} == "$MOCK_TESTED_IMAGE_ID" ]] || exit 2
    key=$(key_for "${3:-}")
    : > "$MOCK_DOCKER_STATE/tagged-$key"
    ;;
  push)
    image_ref=${2:-}
    key=$(key_for "$image_ref")
    fail_ref_var="MOCK_FAIL_PUSH_REF"
    if [[ ${!fail_ref_var} == "$image_ref" && ! -f $(state_file failed-push "$image_ref") ]]; then
      : > "$(state_file failed-push "$image_ref")"
      exit 13
    fi
    state_var="MOCK_TAG_STATE_$key"
    [[ ${!state_var} == absent ]] || { echo 'mock refused to overwrite an existing tag' >&2; exit 14; }
    : > "$(state_file pushed "$image_ref")"
    ;;
  pull)
    [[ ${2:-} == --platform && ${3:-} == linux/amd64 ]] || exit 2
    image_ref=${4:-}
    key=$(key_for "$image_ref")
    [[ ${MOCK_FAIL_PULL_REF:-} != "$image_ref" ]] || exit 15
    state_var="MOCK_TAG_STATE_$key"
    [[ ${!state_var} == existing || -f $(state_file pushed "$image_ref") ]] || exit 16
    : > "$(state_file pulled "$image_ref")"
    ;;
  *) exit 2 ;;
esac
MOCK_DOCKER
  chmod 0700 "$CASE_ROOT/bin/docker"
  DOCKER_BIN="$CASE_ROOT/bin/docker"
  export DOCKER_BIN
}

run_success() {
  bash "$helper" || fail "publisher failed unexpectedly: ${CASE_ROOT##*/}"
}

run_failure() {
  if bash "$helper" >"$CASE_ROOT/stdout" 2>"$CASE_ROOT/stderr"; then
    fail "publisher unexpectedly succeeded: ${CASE_ROOT##*/}"
  fi
}

assert_digest_output() {
  grep -Fxq "digest=$digest" "$GITHUB_OUTPUT" || fail "verified digest output is missing: ${CASE_ROOT##*/}"
  grep -Fxq "run_image=$run_image" "$GITHUB_OUTPUT" || fail 'run-tag output is missing'
  grep -Fxq "version_image=$version_image" "$GITHUB_OUTPUT" || fail 'version-tag output is missing'
}

assert_no_output() {
  [[ ! -s $GITHUB_OUTPUT ]] || fail "failed case wrote workflow outputs: ${CASE_ROOT##*/}"
}

assert_push_count() {
  local expected=$1 actual
  actual=$(grep -c '^push ' "$MOCK_DOCKER_LOG" || true)
  [[ $actual == "$expected" ]] || fail "expected $expected push attempts, got $actual: ${CASE_ROOT##*/}"
}

setup_case new-tags
run_success
assert_push_count 2
assert_digest_output
[[ -f $MOCK_DOCKER_STATE/pushed-RUN && -f $MOCK_DOCKER_STATE/pushed-VERSION ]] || fail 'both aliases were not published'
pass 'new run and semantic-version tags publish the tested artifact'

setup_case existing-tags
export MOCK_TAG_STATE_RUN=existing MOCK_TAG_STATE_VERSION=existing
run_success
assert_push_count 0
assert_digest_output
pass 'matching existing aliases are reused without overwrite'

setup_case run-only-existing
export MOCK_TAG_STATE_RUN=existing
run_success
assert_push_count 1
assert_digest_output
pass 'a partial prior publication is completed by adding the missing version tag'

setup_case version-only-existing
export MOCK_TAG_STATE_VERSION=existing
run_success
assert_push_count 1
assert_digest_output
pass 'a partial prior publication is completed by adding the missing run tag'

for mismatch in version revision run source platform image_id; do
  setup_case "version-collision-$mismatch"
  export MOCK_TAG_STATE_VERSION=existing
  case $mismatch in
    version) export MOCK_REMOTE_VERSION_VERSION=9.9.9 ;;
    revision) export MOCK_REMOTE_REVISION_VERSION=ffffffffffffffffffffffffffffffffffffffff ;;
    run) export MOCK_REMOTE_RUN_VERSION=999 ;;
    source) export MOCK_REMOTE_SOURCE_VERSION=https://example.invalid/wrong ;;
    platform) export MOCK_REMOTE_PLATFORM_VERSION=linux/arm64 ;;
    image_id) export MOCK_REMOTE_IMAGE_ID_VERSION=sha256:2222222222222222222222222222222222222222222222222222222222222222 ;;
  esac
  run_failure
  assert_push_count 0
  assert_no_output
  pass "existing version tag with mismatched $mismatch is rejected before either tag is pushed"
done

setup_case existing-digest-collision
export MOCK_TAG_STATE_RUN=existing MOCK_TAG_STATE_VERSION=existing
export MOCK_REMOTE_DIGEST_VERSION=sha256:0000000000000000000000000000000000000000000000000000000000000000
run_failure
assert_push_count 0
assert_no_output
pass 'existing aliases with different registry digests are rejected'

for failure in error unauthorized network-error; do
  setup_case "inspect-$failure"
  export MOCK_TAG_STATE_VERSION="$failure"
  run_failure
  assert_push_count 0
  assert_no_output
  pass "$failure registry inspection fails closed before publishing"
done

setup_case existing-pull-failure
export MOCK_TAG_STATE_VERSION=existing MOCK_FAIL_PULL_REF=$version_image
run_failure
assert_push_count 0
assert_no_output
pass 'an existing tag that cannot be pulled is never overwritten'

setup_case retry-after-partial-publish
export MOCK_FAIL_PUSH_REF=$version_image
run_failure
[[ -f $MOCK_DOCKER_STATE/pushed-RUN ]] || fail 'first alias was not published before simulated transient failure'
assert_no_output
export MOCK_FAIL_PUSH_REF=''
run_success
assert_push_count 3
assert_digest_output
pass 're-running after partial publication reuses the first tag and safely publishes the second'

setup_case conflicting-digests-after-first-push
export MOCK_REMOTE_DIGEST_VERSION=sha256:0000000000000000000000000000000000000000000000000000000000000000
run_failure
[[ -f $MOCK_DOCKER_STATE/pushed-RUN && -f $MOCK_DOCKER_STATE/pushed-VERSION ]] || fail 'digest conflict fixture did not exercise both aliases'
assert_no_output
pass 'different post-push alias digests fail the release without reporting success'

setup_case local-label-mismatch
export MOCK_LOCAL_VERSION=9.9.9
run_failure
assert_push_count 0
assert_no_output
pass 'invalid tested artifact labels fail before any registry write'

setup_case invalid-image-references
export IMAGE="$repository:mcp-999"
run_failure
assert_push_count 0
assert_no_output
pass 'tag references inconsistent with the release run are rejected'

setup_case missing-github-output
if env -u GITHUB_OUTPUT bash "$helper" >"$CASE_ROOT/stdout" 2>"$CASE_ROOT/stderr"; then
  fail 'missing GITHUB_OUTPUT unexpectedly succeeded'
fi
[[ ! -s $MOCK_DOCKER_LOG ]] || fail 'publisher invoked Docker before validating required inputs'
pass 'required workflow output is validated before Docker commands'

assert_workflow_line() {
  local expected=$1
  grep -Fq -- "$expected" "$release_workflow" || fail "release workflow contract is missing: $expected"
}

assert_workflow_line 'release:'
assert_workflow_line 'types: [published]'
assert_workflow_line 'DOCKERHUB_IMAGE: ${{ secrets.DOCKERHUB_IMAGE }}'
assert_workflow_line 'username: ${{ secrets.DOCKERHUB_USERNAME }}'
assert_workflow_line 'docker tag "$TESTED_IMAGE" "$IMAGE"'
assert_workflow_line 'echo "tested-image=ca-mcp-release:mcp-$GITHUB_RUN_NUMBER" >> "$GITHUB_OUTPUT"'
assert_workflow_line 'artifact-ids: ${{ needs.validate-and-build.outputs.artifact-id }}'
assert_workflow_line 'name: mcp-release-image-${{ github.run_id }}-${{ github.run_attempt }}'
assert_workflow_line 'password: ${{ secrets.DOCKERHUB_TOKEN }}'
[[ $(grep -Fc '${{ github.run_attempt }}' "$release_workflow") == 1 ]] || fail 'run_attempt must appear only in the artifact name'
[[ $(grep -Fc 'artifact-ids:' "$release_workflow") == 1 ]] || fail 'release image download must use the exported artifact ID'
[[ $(grep -Fc '${{ secrets.DOCKERHUB_TOKEN }}' "$release_workflow") == 1 ]] || fail 'Docker Hub token must only be consumed by the publisher'
[[ $(grep -Fc '${{ secrets.DOCKERHUB_USERNAME }}' "$release_workflow") == 1 ]] || fail 'Docker Hub username secret must only be consumed by the publisher'
[[ $(grep -Fc '${{ secrets.DOCKERHUB_IMAGE }}' "$release_workflow") == 1 ]] || fail 'Docker Hub image secret must be consumed only to derive release references'
! grep -Fq 'eduardomatuellacostaapps/ca' "$release_workflow" || fail 'release workflow must not hardcode the Docker Hub image repository'
! grep -Eq '^  deploy:' "$release_workflow" || fail 'release workflow still has a remote deploy job'
! grep -Eq 'MCP_DEPLOY_|MCP_DEPLOY_SSH_KEY|MCP_DEPLOY_KNOWN_HOSTS' "$release_workflow" || fail 'release workflow still references VPS deploy credentials'
! grep -Eq 'latest' "$release_workflow" || fail 'release workflow must not publish or depend on latest'
grep -Fq 'pull_request:' "$ci_workflow" || fail 'CI no longer runs for pull requests'
grep -Fq 'run: npm run test:database' "$ci_workflow" || fail 'CI no longer runs SQL integration tests'
grep -Fq 'ops/ci/image-smoke.ts' "$ci_workflow" || fail 'CI no longer runs the production image smoke test'
! grep -Eq 'DOCKERHUB_TOKEN|docker/login-action|MCP_DEPLOY_' "$ci_workflow" || fail 'CI receives a publish or deploy credential'
! grep -Fq 'eduardomatuellacostaapps/ca' "$ci_workflow" || fail 'CI smoke images must not depend on the Docker Hub repository secret'
pass 'published GitHub releases publish two tags from the tested artifact and have no SSH deployment'

echo 'All isolated release publisher checks passed.'
