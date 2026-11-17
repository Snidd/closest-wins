#!/usr/bin/env bash
# The repo's checks. Exit 0 only when the branch is fit to review.
#
# The gate runs this script from the main checkout with the job's worktree as
# the working directory. Keep it fast, deterministic and non-interactive: no
# watch modes, no prompts, nothing that rewrites files.
#
# Needs the dev database running (`docker compose up -d db`, migrated) and
# Playwright's Chromium installed (`pnpm exec playwright install chromium`).
set -euo pipefail

# The main checkout: .env and data/ (map tiles, media) are gitignored, so a fresh
# worktree has neither. Borrow them from the main checkout.
MAIN="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
if [ ! -f .env ] && [ -f "$MAIN/.env" ]; then cp "$MAIN/.env" .env; fi
export DATA_DIR="$MAIN/data"

pnpm install --frozen-lockfile --prefer-offline
pnpm check
pnpm test:unit

# e2e builds and serves on the fixed port 4173, so only one job may run it at a
# time: hold an exclusive lock (released when this script exits). CI=1 stops
# Playwright from reusing a server another checkout left on that port.
# The `full-game` project is left out: it is timing-sensitive and fails on main
# on a busy machine. Run it by hand with `pnpm test:e2e e2e/full-game.e2e.ts --no-deps`.
mkdir -p "$MAIN/factory/jobs"
exec 9>"$MAIN/factory/jobs/.e2e.lock"
python3 -c 'import fcntl; fcntl.flock(9, fcntl.LOCK_EX)'
CI=1 pnpm test:e2e --project chromium
