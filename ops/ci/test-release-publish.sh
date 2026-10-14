#!/usr/bin/env bash
set -Eeuo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
readonly helper="$repo_root/ops/release/publish-tested-image.sh"
readonly release_workflow="$repo_root/.github/workflows/release.yml"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/ca-mcp-publish-test.XXXXXX")
trap 'rm -rf -- "$test_root"' EXIT

readonly image='eduardomatuellacostaapps/ca:mcp-314'
readonly version='0.2.0'
readonly revision='0123456789abcdef0123456789abcdef01234567'
readonly run_number='314'
readonly digest='sha256:abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'
readonly source='https://github.com/costaapps/ca_mcp'

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
}

setup_case() {
  local name=$1
  CASE_ROOT="$test_root/$name"
  mkdir -p "$CASE_ROOT/bin" "$CASE_ROOT/state"
  MOCK_DOCKER_LOG="$CASE_ROOT/docker.log"
  MOCK_DOCKER_STATE="$CASE_ROOT/state"
  GITHUB_OUTPUT="$CASE_ROOT/github-output"
  : > "$MOCK_DOCKER_LOG"
  : > "$GITHUB_OUTPUT"
  export MOCK_DOCKER_LOG MOCK_DOCKER_STATE GITHUB_OUTPUT
  export IMAGE VERSION EXPECTED_REVISION EXPECTED_RUN
  IMAGE=$image
  VERSION=$version
  EXPECTED_REVISION=$revision
  EXPECTED_RUN=$run_number
  image_repo=${image%:*}
  export MOCK_TAG_STATE=absent
  export MOCK_REMOTE_DIGEST=$digest
  export MOCK_LOCAL_REPO_DIGEST="$image_repo@$digest"
  export MOCK_LOCAL_VERSION=$version
  export MOCK_REMOTE_VERSION=$version
  export MOCK_LOCAL_REVISION=$revision
  export MOCK_REMOTE_REVISION=$revision
  export MOCK_LOCAL_RUN=$run_number
  export MOCK_REMOTE_RUN=$run_number
  export MOCK_LOCAL_SOURCE=$source
  export MOCK_REMOTE_SOURCE=$source
  export MOCK_LOCAL_PLATFORM='linux/amd64'
  export MOCK_REMOTE_PLATFORM='linux/amd64'
  export MOCK_FAIL_PULL=0
  export MOCK_PUSH_FAIL=0
  export image_repo

  cat > "$CASE_ROOT/bin/docker" <<'MOCK_DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$MOCK_DOCKER_LOG"

case ${1:-} in
  image)
    [[ ${2:-} == inspect ]] || exit 2
    format=${4:-}
    image=${5:-}
    [[ $image == "$IMAGE" ]] || exit 2
    if [[ $format == '{{range .RepoDigests}}{{println .}}{{end}}' ]]; then
      printf '%s\n' "$MOCK_LOCAL_REPO_DIGEST"
      exit 0
    fi
    if [[ -f $MOCK_DOCKER_STATE/pulled ]]; then
      version=$MOCK_REMOTE_VERSION
      revision=$MOCK_REMOTE_REVISION
      run=$MOCK_REMOTE_RUN
      source=$MOCK_REMOTE_SOURCE
      platform=$MOCK_REMOTE_PLATFORM
    else
      version=$MOCK_LOCAL_VERSION
      revision=$MOCK_LOCAL_REVISION
      run=$MOCK_LOCAL_RUN
      source=$MOCK_LOCAL_SOURCE
      platform=$MOCK_LOCAL_PLATFORM
    fi
    case $format in
      '{{ index .Config.Labels "org.opencontainers.image.version" }}') printf '%s\n' "$version" ;;
      '{{ index .Config.Labels "org.opencontainers.image.revision" }}') printf '%s\n' "$revision" ;;
      '{{ index .Config.Labels "com.costaapps.github.run" }}') printf '%s\n' "$run" ;;
      '{{ index .Config.Labels "org.opencontainers.image.source" }}') printf '%s\n' "$source" ;;
      '{{ .Os }}/{{ .Architecture }}') printf '%s\n' "$platform" ;;
      *) exit 2 ;;
    esac
    ;;
  buildx)
    [[ ${2:-} == imagetools && ${3:-} == inspect && ${4:-} == "$IMAGE" ]] || exit 2
    count_file="$MOCK_DOCKER_STATE/inspect-count"
    count=0
    [[ -f $count_file ]] && count=$(<"$count_file")
    count=$((count + 1))
    printf '%s' "$count" > "$count_file"
    if [[ $count == 1 && $MOCK_TAG_STATE == absent ]]; then
      echo "ERROR: docker.io/$IMAGE: not found" >&2
      exit 1
    fi
    if [[ $count == 1 && $MOCK_TAG_STATE == error ]]; then
      echo 'unexpected Docker Hub inspection error' >&2
      exit 7
    fi
    if [[ $count == 1 && $MOCK_TAG_STATE == unauthorized ]]; then
      echo 'ERROR: failed to authorize: authentication required' >&2
      exit 1
    fi
    if [[ $count == 1 && $MOCK_TAG_STATE == network-error ]]; then
      echo 'ERROR: dial tcp: i/o timeout' >&2
      exit 1
    fi
    if [[ $count == 1 && $MOCK_TAG_STATE == absent && ! -f $MOCK_DOCKER_STATE/pushed ]]; then
      echo 'image was not pushed before registry reinspection' >&2
      exit 8
    fi
    printf 'Name: docker.io/%s\nDigest: %s\n' "$IMAGE" "$MOCK_REMOTE_DIGEST"
    ;;
  push)
    [[ ${2:-} == "$IMAGE" ]] || exit 2
    if [[ $MOCK_PUSH_FAIL == 1 ]]; then exit 13; fi
    : > "$MOCK_DOCKER_STATE/pushed"
    ;;
  pull)
    [[ ${2:-} == --platform && ${3:-} == linux/amd64 && ${4:-} == "$IMAGE" ]] || exit 2
    if [[ $MOCK_FAIL_PULL == 1 ]]; then exit 14; fi
    : > "$MOCK_DOCKER_STATE/pulled"
    ;;
  *) exit 2 ;;
esac
MOCK_DOCKER
  chmod 0700 "$CASE_ROOT/bin/docker"
  DOCKER_BIN="$CASE_ROOT/bin/docker"
  export DOCKER_BIN
}

run_success() {
  bash "$helper" || fail "publish helper failed unexpectedly: ${CASE_ROOT##*/}"
}

run_failure() {
  if bash "$helper" >"$CASE_ROOT/stdout" 2>"$CASE_ROOT/stderr"; then
    fail "publish helper unexpectedly succeeded: ${CASE_ROOT##*/}"
  fi
}

assert_no_digest_output() {
  [[ ! -s $GITHUB_OUTPUT ]] || fail "failed case wrote a deploy digest: ${CASE_ROOT##*/}"
}

assert_digest_output() {
  [[ $(<"$GITHUB_OUTPUT") == "digest=$digest" ]] || fail "expected digest output was not written: ${CASE_ROOT##*/}"
}

assert_push_count() {
  local expected=$1 actual
  actual=$(grep -c '^push ' "$MOCK_DOCKER_LOG" || true)
  [[ $actual == "$expected" ]] || fail "expected $expected pushes, observed $actual: ${CASE_ROOT##*/}"
}

setup_case "new-tag"
run_success
assert_push_count 1
assert_digest_output
[[ -f $MOCK_DOCKER_STATE/pulled ]] || fail 'new tag path did not pull and verify the registry image'
pass 'missing registry tag publishes the validated artifact once and returns its digest'

setup_case "existing-tag"
MOCK_TAG_STATE=existing
run_success
assert_push_count 0
assert_digest_output
pass 'matching existing tag is reused without push'

test_existing_tag_mismatch() {
  local name=$1 variable=$2 invalid_value=$3
  setup_case "existing-tag-$name"
  MOCK_TAG_STATE=existing
  export "$variable=$invalid_value"
  run_failure
  assert_push_count 0
  assert_no_digest_output
  [[ ! -f $MOCK_DOCKER_STATE/pushed ]] || fail "existing tag collision attempted to publish: $name"
  pass "existing tag with mismatched $name is rejected without overwrite"
}

test_existing_tag_mismatch version MOCK_REMOTE_VERSION 9.9.9
test_existing_tag_mismatch commit MOCK_REMOTE_REVISION ffffffffffffffffffffffffffffffffffffffff
test_existing_tag_mismatch run MOCK_REMOTE_RUN 999
test_existing_tag_mismatch source MOCK_REMOTE_SOURCE https://example.invalid/wrong
test_existing_tag_mismatch platform MOCK_REMOTE_PLATFORM linux/arm64

setup_case "existing-tag-digest-mismatch"
MOCK_TAG_STATE=existing
MOCK_REMOTE_DIGEST='sha256:0000000000000000000000000000000000000000000000000000000000000000'
run_failure
assert_push_count 0
assert_no_digest_output
pass 'existing tag with a conflicting remote digest is rejected without overwrite'

setup_case "local-label-mismatch"
MOCK_LOCAL_VERSION='9.9.9'
run_failure
assert_push_count 0
assert_no_digest_output
pass 'invalid local artifact labels fail before publishing'

setup_case "remote-label-mismatch"
MOCK_REMOTE_REVISION='ffffffffffffffffffffffffffffffffffffffff'
run_failure
assert_push_count 1
assert_no_digest_output
pass 'registry image with a different revision is rejected after pull'

setup_case "inspect-error"
MOCK_TAG_STATE=error
run_failure
assert_push_count 0
assert_no_digest_output
[[ ! -f $MOCK_DOCKER_STATE/pulled ]] || fail 'inspection error proceeded to pull'
pass 'unknown registry inspection error fails closed without push or pull'

for inspect_failure in unauthorized network-error; do
  setup_case "inspect-$inspect_failure"
  MOCK_TAG_STATE=$inspect_failure
  run_failure
  assert_push_count 0
  assert_no_digest_output
  [[ ! -f $MOCK_DOCKER_STATE/pulled ]] || fail "$inspect_failure inspection failure proceeded to pull"
  pass "$inspect_failure registry inspection failure fails closed"
done

setup_case "pull-error"
MOCK_FAIL_PULL=1
run_failure
assert_push_count 1
assert_no_digest_output
pass 'failed registry pull prevents a deploy digest from being emitted'

setup_case "digest-mismatch"
MOCK_LOCAL_REPO_DIGEST="$image_repo@sha256:0000000000000000000000000000000000000000000000000000000000000000"
run_failure
assert_push_count 1
assert_no_digest_output
pass 'local RepoDigest must match the digest reported by Docker Hub'

setup_case "missing-github-output"
if env -u GITHUB_OUTPUT bash "$helper" >"$CASE_ROOT/stdout" 2>"$CASE_ROOT/stderr"; then
  fail 'missing GITHUB_OUTPUT unexpectedly succeeded'
fi
[[ ! -s $MOCK_DOCKER_LOG ]] || fail 'helper invoked Docker before validating required output'
pass 'required workflow output is validated before Docker commands'

assert_workflow_line() {
  local expected=$1
  grep -Fq -- "$expected" "$release_workflow" || fail "release workflow contract is missing: $expected"
}

assert_workflow_line 'artifact-id: ${{ steps.image-artifact.outputs.artifact-id }}'
assert_workflow_line 'id: image-artifact'
assert_workflow_line 'artifact-ids: ${{ needs.validate-and-build.outputs.artifact-id }}'
assert_workflow_line 'name: mcp-release-image-${{ github.run_id }}-${{ github.run_attempt }}'
[[ $(grep -Fc '${{ github.run_attempt }}' "$release_workflow") == 1 ]] || fail 'run_attempt must appear only in the upload artifact name'
[[ $(grep -Fc 'artifact-ids:' "$release_workflow") == 1 ]] || fail 'release image download must use the exported artifact ID'
pass 'release workflow passes the current artifact ID across retry attempts'

echo 'All isolated release publisher checks passed.'
