#!/usr/bin/env bash
# 错题站 · 云服务器一键部署脚本
# 用法（在服务器上，把本项目文件上传到某个目录后）：
#   cd /root/cuoti && bash deploy.sh
# 可选环境变量：
#   PORT=8765            访问端口
#   REGISTER_CODE=xxx    注册邀请码（强烈建议设置，防止陌生人注册）
#   APP_DIR=/opt/cuoti   安装目录
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/cuoti}"
PORT="${PORT:-8765}"
REGISTER_CODE="${REGISTER_CODE:-}"
SERVICE="cuoti"

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 root 运行：sudo bash deploy.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> 1/5 安装 Node.js（已安装则跳过）"
if ! command -v node >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y curl ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "    node $(node -v)"

echo "==> 2/5 复制程序文件到 $APP_DIR"
mkdir -p "$APP_DIR/css" "$APP_DIR/js" "$APP_DIR/cloud-data/uploads"
cp "$SCRIPT_DIR/cloud-server.js" "$APP_DIR/"
cp "$SCRIPT_DIR/index.html" "$APP_DIR/"
cp "$SCRIPT_DIR/login.html" "$APP_DIR/"
cp -r "$SCRIPT_DIR"/css/* "$APP_DIR/css/"
cp "$SCRIPT_DIR"/js/* "$APP_DIR/js/"

echo "==> 3/5 注册 systemd 服务（开机自启 + 崩溃自动重启）"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Cuoti class server
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) $APP_DIR/cloud-server.js
Restart=always
RestartSec=3
Environment=PORT=$PORT
Environment=HOST=0.0.0.0
Environment=REGISTER_CODE=$REGISTER_CODE

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"

echo "==> 4/5 放行系统防火墙端口（云厂商安全组还要另外放行）"
if command -v ufw >/dev/null 2>&1; then ufw allow "$PORT"/tcp >/dev/null 2>&1 || true; fi
if command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port="$PORT"/tcp >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
fi

echo "==> 5/5 运行状态"
sleep 1
systemctl --no-pager --full status "$SERVICE" | head -n 12 || true

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo ""
echo "=================================================="
echo " 部署完成"
echo "   访问地址： http://${IP}:${PORT}/"
if [ -n "$REGISTER_CODE" ]; then
  echo "   注册邀请码： $REGISTER_CODE"
else
  echo "   注册邀请码： 未设置（任何人都能注册，公网建议设置）"
fi
echo ""
echo "   记得去云厂商控制台 → 安全组/防火墙，放行 TCP ${PORT}"
echo "   查看日志： journalctl -u $SERVICE -f"
echo "   重启服务： systemctl restart $SERVICE"
echo "=================================================="
