# Release and Image Versioning

Clira uses semantic version tags for releases and separate moving tags for branch builds.

## Image Channels

- `main`: latest successful image built from the `main` branch
- `sha-<commit>`: exact image for a specific `main` commit
- `vX.Y.Z`: exact release image
- `vX.Y`: latest patch release within a minor line
- `latest`: latest tagged release only

## Expected Workflow

### Every push to `main`

GitHub Actions publishes:

- `ghcr.io/rushik-b/clira:main`
- `ghcr.io/rushik-b/clira:sha-<commit>`

Use these for internal testing or rapid iteration.

### Every git tag like `v0.1.0`

GitHub Actions publishes:

- `ghcr.io/rushik-b/clira:v0.1.0`
- `ghcr.io/rushik-b/clira:v0.1`
- `ghcr.io/rushik-b/clira:latest`

Use these for user-facing and production-style self-host installs.

## Self-Host Guidance

- For fast testing, `CLIRA_IMAGE=ghcr.io/rushik-b/clira:main`
- For reproducible installs, pin `CLIRA_IMAGE` to `vX.Y.Z`
- Avoid relying on `latest` unless you intentionally want release-to-release movement

## Maintainer Notes

- Keep git release tags in `vX.Y.Z` format
- Reserve `latest` for tagged releases
- If a change should be safe for users, cut a release tag instead of telling them to track `main`
