#!/usr/bin/env bash
# Usage: scripts/parallel-group.sh <phase> <group>     e.g. scripts/parallel-group.sh 1 2A
# Creates one git worktree per task in that phase + parallel group and prints the command
# to run each one in its own terminal.
set -euo pipefail
PHASE="$1"; GROUP="$2"
ROOT=$(git rev-parse --show-toplevel)
REPO=$(basename "$ROOT")
BRANCH="phase-$PHASE"
git fetch origin "$BRANCH"
found=0
for f in "$ROOT"/docs/tasks/P"${PHASE}"-*.md; do
  g=$(grep -m1 '^parallel_group:' "$f" | awk '{print $2}')
  [ "$g" = "$GROUP" ] || continue
  id=$(grep -m1 '^id:' "$f" | awk '{print $2}')
  dir="$(dirname "$ROOT")/${REPO}-${id}"
  if [ ! -d "$dir" ]; then
    git worktree add --detach "$dir" "origin/$BRANCH"
  fi
  echo "cd $dir && pnpm install && scripts/run-task.sh $id"
  found=$((found+1))
done
[ "$found" -gt 0 ] || { echo "No tasks in phase $PHASE group $GROUP" >&2; exit 1; }
echo
echo "After the PRs merge, remove worktrees with: git worktree remove <dir>"
