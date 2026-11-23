#!/usr/bin/env bash
# Copies one or more databases from a source cluster to a destination cluster,
# then prints per-collection document counts from both so you can compare.
#
# Usage:
#   export SRC_URI='mongodb+srv://USER:PASS@source-cluster.mongodb.net/'
#   export DST_URI='mongodb+srv://USER:PASS@company-cluster.mongodb.net/'
#   DBS="hr_governance umrah360" ./migrate-mongo.sh
#
# Add DROP=true to replace collections that already exist on the destination.
# Without it, existing documents are left alone and duplicates are skipped.

set -euo pipefail

: "${SRC_URI:?Set SRC_URI (source connection string, no database name in it)}"
: "${DST_URI:?Set DST_URI (destination connection string, no database name in it)}"
: "${DBS:?Set DBS, e.g. DBS=\"hr_governance umrah360\"}"
DROP="${DROP:-false}"

for tool in mongodump mongorestore mongosh; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing $tool. Install MongoDB Database Tools and mongosh first."; exit 1; }
done

counts() {
  local uri="$1" db="$2"
  mongosh "$uri" --quiet --eval "
    const d = db.getSiblingDB('$db');
    d.getCollectionNames().sort().forEach(c => print(c + '\t' + d.getCollection(c).countDocuments()));
  "
}

for db in $DBS; do
  echo "=== Copying database: $db ==="
  restore_args=(--uri="$DST_URI" --archive --gzip --nsInclude="$db.*")
  if [ "$DROP" = "true" ]; then restore_args+=(--drop); fi

  mongodump --uri="$SRC_URI" --db="$db" --archive --gzip | mongorestore "${restore_args[@]}"

  echo "--- Document counts for $db (collection, count) ---"
  counts "$SRC_URI" "$db" > "/tmp/src_$db.txt"
  counts "$DST_URI" "$db" > "/tmp/dst_$db.txt"
  if diff -q "/tmp/src_$db.txt" "/tmp/dst_$db.txt" >/dev/null; then
    echo "OK: source and destination counts match for $db"
  else
    echo "MISMATCH for $db. Differences (< source, > destination):"
    diff "/tmp/src_$db.txt" "/tmp/dst_$db.txt" || true
  fi
done

echo "Done."