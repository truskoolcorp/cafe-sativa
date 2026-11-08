#!/usr/bin/env bash
set -euo pipefail

# This is not a local socket workaround. Actual runtime is restricted to a new
# GitHub-hosted job, with no deployment environments, secrets or live services.
if [[ ${GITHUB_ACTIONS:-} != true || ${RUNNER_ENVIRONMENT:-} != github-hosted ||
      ${CAFE_DISPOSABLE_AUTH:-} != 1 || ! ${GITHUB_RUN_ID:-} =~ ^[0-9]+$ ||
      ! ${GITHUB_RUN_ATTEMPT:-} =~ ^[0-9]+$ ]]; then
  echo 'Requires explicit isolated Auth opt-in in a GitHub-hosted CI job.' >&2
  exit 2
fi

cd "$(dirname "$0")/../.."
for cmd in docker psql python3; do command -v "$cmd" >/dev/null; done
unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH COMPOSE_FILE COMPOSE_PROFILES
project="cafe-auth-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
compose=(docker --context default compose --env-file /dev/null
  --project-name "$project" -f tests/auth-service/compose.yml)
"${compose[@]}" config --quiet
if [[ -n $("${compose[@]}" ps -aq) ]]; then
  echo 'Refusing to reuse an existing disposable project.' >&2
  exit 2
fi

cleanup() {
  result=$?
  trap - EXIT
  if (( result != 0 )); then
    echo 'Isolated Auth acceptance failed. Container state follows; raw service logs are not emitted.' >&2
    "${compose[@]}" ps --all --format '{{.Service}} {{.State}} {{.Health}} {{.ExitCode}}' || true
  fi
  "${compose[@]}" down --volumes --remove-orphans || true
  exit "$result"
}
trap cleanup EXIT
"${compose[@]}" pull
for image in postgres:17.6 supabase/gotrue:v2.197.0; do
  docker --context default image inspect "$image" \
    --format 'Resolved image: {{json .RepoTags}} {{json .RepoDigests}}'
done
"${compose[@]}" up --detach --wait --wait-timeout 120 db
"${compose[@]}" up --detach auth

CAFE_DISPOSABLE_AUTH=1 python3 tests/auth-service/run.py
