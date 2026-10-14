#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE:?IMAGE is required}"
: "${VERSION:?VERSION is required}"
: "${EXPECTED_REVISION:?EXPECTED_REVISION is required}"
: "${EXPECTED_RUN:?EXPECTED_RUN is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

docker_bin="${DOCKER_BIN:-docker}"
repository="${IMAGE%:*}"
inspect_output="$(mktemp)"
trap 'rm -f -- "$inspect_output"' EXIT

docker_cli() {
  "$docker_bin" "$@"
}

verify_release_labels() {
  local actual_version actual_revision actual_run actual_source actual_platform
  actual_version="$(docker_cli image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$IMAGE")"
  actual_revision="$(docker_cli image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$IMAGE")"
  actual_run="$(docker_cli image inspect --format '{{ index .Config.Labels "com.costaapps.github.run" }}' "$IMAGE")"
  actual_source="$(docker_cli image inspect --format '{{ index .Config.Labels "org.opencontainers.image.source" }}' "$IMAGE")"
  actual_platform="$(docker_cli image inspect --format '{{ .Os }}/{{ .Architecture }}' "$IMAGE")"

  if [[ "$actual_version" != "$VERSION" \
    || "$actual_revision" != "$EXPECTED_REVISION" \
    || "$actual_run" != "$EXPECTED_RUN" \
    || "$actual_source" != "https://github.com/costaapps/ca_mcp" \
    || "$actual_platform" != "linux/amd64" ]]; then
    echo "Image labels do not match this tested release; refusing to publish or deploy it." >&2
    return 1
  fi
}

read_remote_digest() {
  local remote_output
  remote_output="$(docker_cli buildx imagetools inspect "$IMAGE")" || return $?
  printf '%s\n' "$remote_output" | awk '$1 == "Digest:" && !found { digest = $2; found = 1 } END { if (found) print digest; else exit 1 }'
}

verify_local_digest() {
  local expected_digest="$1"
  local repo_digests entry
  repo_digests="$(docker_cli image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$IMAGE")"
  while IFS= read -r entry; do
    if [[ "$entry" == "${repository}@${expected_digest}" || "$entry" == "docker.io/${repository}@${expected_digest}" ]]; then
      return 0
    fi
  done <<< "$repo_digests"

  echo "Pulled image digest does not match the Docker Hub digest for $IMAGE." >&2
  return 1
}

# The artifact was produced by the job that built and smoke-tested the image.
# Check its release labels before any push so a bad artifact cannot overwrite a tag.
verify_release_labels

if docker_cli buildx imagetools inspect "$IMAGE" >"$inspect_output" 2>&1; then
  echo "Docker Hub tag already exists; checking that it belongs to this tested release."
else
  inspect_status=$?
  inspect_message="$(cat "$inspect_output")"
  expected_missing="ERROR: docker.io/$IMAGE: not found"
  if [[ "$inspect_status" -ne 1 || "$inspect_message" != "$expected_missing" ]]; then
    echo "Could not safely determine whether the Docker Hub tag exists; refusing to publish." >&2
    cat "$inspect_output" >&2
    exit 1
  fi

  echo "Docker Hub tag is absent; publishing the already-tested image."
  docker_cli push "$IMAGE"
fi

# Pull in both paths. This verifies the registry copy, not only the local build.
docker_cli pull --platform linux/amd64 "$IMAGE"
verify_release_labels

digest="$(read_remote_digest)"
if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Could not capture a valid Docker Hub image digest." >&2
  exit 1
fi
verify_local_digest "$digest"

printf 'digest=%s\n' "$digest" >> "$GITHUB_OUTPUT"
echo "Published image digest: $digest"
