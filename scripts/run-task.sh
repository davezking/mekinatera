#!/usr/bin/env bash
# Usage: scripts/run-task.sh P1-S2-T3
# Runs one task headlessly with the model named in its frontmatter.
set -euo pipefail
ID="$1"
FILE="docs/tasks/$ID.md"
[ -f "$FILE" ] || { echo "No task file $FILE" >&2; exit 1; }
MODEL=$(grep -m1 '^model:' "$FILE" | awk '{print $2}')
echo ">> $ID with model $MODEL"
claude -p "/run-task $ID" --model "$MODEL" --permission-mode acceptEdits
