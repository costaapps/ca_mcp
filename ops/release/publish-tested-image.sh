#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE:?IMAGE is required}"
: "${VERSION_IMAGE:?VERSION_IMAGE is required}"
: "${VERSION:?VERSION is required}"
: "${DOCKERHUB_IMAGE:?DOCKERHUB_IMAGE is required}"
: "${EXPECTED_REVISION:?EXPECTED_REVISION is required}"
: "${EXPECTED_RUN:?EXPECTED_RUN is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

docker_bin="${DOCKER_BIN:-docker}"
repository="$DOCKERHUB_IMAGE"
inspect_output="$(mktemp)"
trap 'rm -f -- "$inspect_output"' EXIT

docker_cli() {
  "$docker_bin" "$@"
}

if [[ ! "$repository" =~ ^[a-z0-9]+([._-][a-z0-9]+)*/[a-z0-9]+([._-][a-z0-9]+)*$ \
  || "$IMAGE" != "$repository:mcp-$EXPECTED_RUN" \
  || "$VERSION_IMAGE" != "$repository:mcp-$VERSION" ]]; then
  echo "Image references do not match the expected run and release version." >&2
  exit 1
fi

verify_release_labels() {
  local image_ref="$1"
  local actual_version actual_revision actual_run actual_source actual_platform
  actual_version="$(docker_cli image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$image_ref")"
  actual_revision="$(docker_cli image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image_ref")"
  actual_run="$(docker_cli image inspect --format '{{ index .Config.Labels "com.costaapps.github.run" }}' "$image_ref")"
  actual_source="$(docker_cli image inspect --format '{{ index .Config.Labels "org.opencontainers.image.source" }}' "$image_ref")"
  actual_platform="$(docker_cli image inspect --format '{{ .Os }}/{{ .Architecture }}' "$image_ref")"

  if [[ "$actual_version" != "$VERSION" \
    || "$actual_revision" != "$EXPECTED_REVISION" \
    || "$actual_run" != "$EXPECTED_RUN" \
    || "$actual_source" != "https://github.com/costaapps/ca_mcp" \
    || "$actual_platform" != "linux/amd64" ]]; then
    echo "Image labels do not match this tested release; refusing to publish." >&2
    return 1
  fi
}

read_remote_digest() {
  local image_ref="$1" remote_output
  remote_output="$(docker_cli buildx imagetools inspect "$image_ref")" || return $?
  printf '%s\n' "$remote_output" | awk '$1 == "Digest:" && !found { digest = $2; found = 1 } END { if (found) print digest; else exit 1 }'
}

inspect_remote_tag() {
  local image_ref="$1" inspect_status inspect_message digest
  if docker_cli buildx imagetools inspect "$image_ref" >"$inspect_output" 2>&1; then
    digest="$(awk '$1 == "Digest:" && !found { digest = $2; found = 1 } END { if (found) print digest; else exit 1 }' "$inspect_output")" || {
      echo "Could not parse the Docker Hub digest for $image_ref." >&2
      return 2
    }
    if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
      echo "Docker Hub returned an invalid digest for $image_ref." >&2
      return 2
    fi
    REMOTE_DIGEST="$digest"
    return 0
  else
    inspect_status=$?
  fi

  inspect_message="$(cat "$inspect_output")"
  if [[ "$inspect_status" -eq 1 && "$inspect_message" == "ERROR: docker.io/$image_ref: not found" ]]; then
    return 1
  fi

  echo "Could not safely inspect Docker Hub tag $image_ref; refusing to publish." >&2
  cat "$inspect_output" >&2
  return 2
}

verify_tested_image() {
  local image_ref="$1" actual_id repo_digests entry expected_digest="$2"
  actual_id="$(docker_cli image inspect --format '{{.Id}}' "$image_ref")"
  if [[ "$actual_id" != "$tested_image_id" ]]; then
    echo "Docker Hub tag $image_ref does not contain the tested image." >&2
    return 1
  fi

  verify_release_labels "$image_ref"
  repo_digests="$(docker_cli image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image_ref")"
  while IFS= read -r entry; do
    if [[ "$entry" == "${repository}@${expected_digest}" || "$entry" == "docker.io/${repository}@${expected_digest}" ]]; then
      return 0
    fi
  done <<< "$repo_digests"

  echo "Pulled image digest does not match Docker Hub tag $image_ref." >&2
  return 1
}

# Remember the tested image configuration ID before pulling registry tags.
verify_release_labels "$IMAGE"
tested_image_id="$(docker_cli image inspect --format '{{.Id}}' "$IMAGE")"
if [[ ! "$tested_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "The tested image has no valid image ID." >&2
  exit 1
fi

declare -A tag_state=()
declare -A tag_digest=()
expected_digest=""

# Preflight every release ref before the first push, so a known collision cannot
# leave a second release alias partially published.
for image_ref in "$IMAGE" "$VERSION_IMAGE"; do
  if inspect_remote_tag "$image_ref"; then
    tag_state["$image_ref"]='present'
    tag_digest["$image_ref"]="$REMOTE_DIGEST"
    docker_cli pull --platform linux/amd64 "$image_ref"
    verify_tested_image "$image_ref" "${tag_digest[$image_ref]}"
    if [[ -n "$expected_digest" && "$expected_digest" != "${tag_digest[$image_ref]}" ]]; then
      echo "Existing release tags point to different image digests; refusing to publish." >&2
      exit 1
    fi
    expected_digest="${tag_digest[$image_ref]}"
  else
    inspect_status=$?
    if [[ "$inspect_status" -ne 1 ]]; then
      exit 1
    fi
    tag_state["$image_ref"]='absent'
  fi
done

for image_ref in "$IMAGE" "$VERSION_IMAGE"; do
  if [[ "${tag_state[$image_ref]}" == 'absent' ]]; then
    echo "Docker Hub tag $image_ref is absent; publishing the tested image."
    docker_cli tag "$tested_image_id" "$image_ref"
    docker_cli push "$image_ref"
    docker_cli pull --platform linux/amd64 "$image_ref"
    verify_release_labels "$image_ref"
    actual_id="$(docker_cli image inspect --format '{{.Id}}' "$image_ref")"
    if [[ "$actual_id" != "$tested_image_id" ]]; then
      echo "Published tag $image_ref does not contain the tested image." >&2
      exit 1
    fi

    digest="$(read_remote_digest "$image_ref")"
    if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
      echo "Could not capture a valid Docker Hub image digest for $image_ref." >&2
      exit 1
    fi
    verify_tested_image "$image_ref" "$digest"
    if [[ -n "$expected_digest" && "$expected_digest" != "$digest" ]]; then
      echo "Release tags resolve to different image digests; refusing to complete publication." >&2
      exit 1
    fi
    expected_digest="$digest"
  fi
done

if [[ -z "$expected_digest" ]]; then
  echo "No Docker Hub digest was verified for this release." >&2
  exit 1
fi

printf 'digest=%s\n' "$expected_digest" >> "$GITHUB_OUTPUT"
printf 'run_image=%s\nversion_image=%s\n' "$IMAGE" "$VERSION_IMAGE" >> "$GITHUB_OUTPUT"
echo "Verified release image digest: $expected_digest"
