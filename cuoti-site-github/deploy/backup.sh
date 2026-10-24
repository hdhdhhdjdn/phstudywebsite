#!/bin/bash
# 备份错题站数据（db.json + uploads），保留 14 天
set -e
SRC="/opt/cuoti/cloud-data"
BACKUP_DIR="/opt/cuoti-backup"
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/cuoti-data-$STAMP.tar.gz" -C "$(dirname "$SRC")" "$(basename "$SRC")"
find "$BACKUP_DIR" -name "cuoti-data-*.tar.gz" -mtime +14 -delete
echo "[$(date)] backup ok: $BACKUP_DIR/cuoti-data-$STAMP.tar.gz"
