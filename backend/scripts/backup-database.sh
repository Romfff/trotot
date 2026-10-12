#!/usr/bin/env bash
# Local backup only. Scheduling, retention and offsite storage require owner configuration.
set -euo pipefail
umask 077
: "${PGDATABASE:?Set PGDATABASE to a database name; use PGPASSFILE for credentials}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"
case "$PGDATABASE" in *://*) echo 'PGDATABASE must be a name, not a connection URL' >&2; exit 2;; esac
if [ "$#" -ne 1 ]; then echo 'Usage: backup-database.sh BACKUP_DIRECTORY' >&2; exit 2; fi
for tool in pg_dump gzip sha256sum mktemp; do command -v "$tool" >/dev/null; done
mkdir -p -- "$1"
work=$(mktemp -d "$1/.partial-XXXXXXXXXX")
cleanup() {
  rm -f -- "$work/database.sql.gz" "$work/SHA256SUMS" "$work/diagnostics"
  rmdir -- "$work"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# pipefail prevents gzip succeeding after pg_dump fails. Never expose partial archives.
if ! { pg_dump --no-password --lock-wait-timeout=30s | gzip -c > "$work/database.sql.gz"; } 2> "$work/diagnostics"; then
  echo 'Backup failed during pg_dump/compression; no completed archive published' >&2
  exit 1
fi
if [ -s "$work/diagnostics" ]; then
  echo 'Backup produced warnings; inspect connectivity/permissions before retrying; no archive published' >&2
  exit 1
fi
gzip -t "$work/database.sql.gz"
(cd -- "$work" && sha256sum database.sql.gz > SHA256SUMS)
rm -f -- "$work/diagnostics"
final="$1/$(date -u +%Y%m%dT%H%M%SZ)-${work##*/.partial-}"
test ! -e "$final"
mv -T -- "$work" "$final"
trap - EXIT
printf '%s\n' "$final"
