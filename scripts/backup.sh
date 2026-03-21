#!/usr/bin/env bash
# ============================================================
# STRAT PLANNER PRO — AUTOMATED BACKUP SCRIPT
# scripts/backup.sh
#
# Backs up data/ (NeDB flat files) and uploads/ (user files)
# to an S3-compatible bucket. Retains 30 daily backups.
#
# Usage:
#   ./scripts/backup.sh                 # manual run
#   crontab: 0 2 * * * /app/scripts/backup.sh >> /var/log/spp-backup.log 2>&1
#
# Required environment variables (set on hosting platform):
#   S3_BUCKET     — e.g. s3://your-bucket-name/strat-planner-backups
#   S3_ENDPOINT   — optional, for non-AWS (e.g. https://s3.us-east-1.amazonaws.com)
#   AWS_ACCESS_KEY_ID
#   AWS_SECRET_ACCESS_KEY
#   AWS_DEFAULT_REGION — e.g. ap-southeast-1
#
# Dependencies: aws-cli (apt install awscli OR pip install awscli)
# ============================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────
APP_DIR="${APP_DIR:-/app}"
DATA_DIR="${APP_DIR}/data"
UPLOADS_DIR="${APP_DIR}/uploads"
BACKUP_DIR="/tmp/spp-backup-$$"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
ARCHIVE="${BACKUP_DIR}/spp-backup-${TIMESTAMP}.tar.gz"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

S3_BUCKET="${S3_BUCKET:?S3_BUCKET environment variable is required}"
S3_PREFIX="${S3_PREFIX:-backups}"

# ── Helpers ───────────────────────────────────────────────
log()  { echo "[BACKUP $(date '+%H:%M:%S')] $*"; }
fail() { echo "[BACKUP ERROR] $*" >&2; exit 1; }

# ── Validate ──────────────────────────────────────────────
command -v aws >/dev/null 2>&1 || fail "aws-cli not found. Install with: pip install awscli"
[ -d "$DATA_DIR" ]    || fail "data/ directory not found at $DATA_DIR"

# ── Create backup ─────────────────────────────────────────
log "Starting backup (timestamp: ${TIMESTAMP})"
mkdir -p "${BACKUP_DIR}"

log "Archiving data/ and uploads/..."
tar -czf "${ARCHIVE}" \
    -C "${APP_DIR}" \
    data/ \
    $([ -d "${UPLOADS_DIR}" ] && echo "uploads/" || true)

ARCHIVE_SIZE=$(du -sh "${ARCHIVE}" | cut -f1)
log "Archive created: ${ARCHIVE} (${ARCHIVE_SIZE})"

# ── Upload to S3 ──────────────────────────────────────────
S3_PATH="${S3_BUCKET}/${S3_PREFIX}/$(basename ${ARCHIVE})"
log "Uploading to ${S3_PATH}..."

AWS_ARGS=""
if [ -n "${S3_ENDPOINT:-}" ]; then
    AWS_ARGS="--endpoint-url ${S3_ENDPOINT}"
fi

aws s3 cp "${ARCHIVE}" "${S3_PATH}" \
    ${AWS_ARGS} \
    --storage-class STANDARD_IA \
    --metadata "timestamp=${TIMESTAMP},app=strat-planner-pro"

log "Upload complete"

# ── Prune old backups ──────────────────────────────────────
log "Pruning backups older than ${RETENTION_DAYS} days..."
CUTOFF=$(date -d "${RETENTION_DAYS} days ago" +%Y-%m-%d 2>/dev/null || \
         date -v -${RETENTION_DAYS}d +%Y-%m-%d 2>/dev/null || \
         echo "1970-01-01")

aws s3 ls "${S3_BUCKET}/${S3_PREFIX}/" ${AWS_ARGS} \
    | awk '{print $4}' \
    | grep "^spp-backup-" \
    | while read -r key; do
        file_date=$(echo "$key" | grep -oP '\d{4}-\d{2}-\d{2}' | head -1 || echo "9999-12-31")
        if [[ "$file_date" < "$CUTOFF" ]]; then
            log "Deleting old backup: ${key}"
            aws s3 rm "${S3_BUCKET}/${S3_PREFIX}/${key}" ${AWS_ARGS}
        fi
      done

# ── Cleanup ───────────────────────────────────────────────
rm -rf "${BACKUP_DIR}"
log "✅ Backup complete"

# ── Summary ───────────────────────────────────────────────
BACKUP_COUNT=$(aws s3 ls "${S3_BUCKET}/${S3_PREFIX}/" ${AWS_ARGS} | grep -c "spp-backup" || echo "?")
log "Backups in bucket: ${BACKUP_COUNT}"
