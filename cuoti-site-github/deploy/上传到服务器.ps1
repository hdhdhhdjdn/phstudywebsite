# 从 Windows 上传错题站到云服务器（需要 Windows 自带的 OpenSSH / scp）
#
# 用法（在 cuoti-site 目录下）：
#   powershell -ExecutionPolicy Bypass -File deploy\上传到服务器.ps1 -Server 1.2.3.4
#   powershell -ExecutionPolicy Bypass -File deploy\上传到服务器.ps1 -Server 1.2.3.4 -User root -RemoteDir /root/cuoti
#
# 上传完成后，按提示在服务器上执行： cd /root/cuoti && bash deploy.sh

param(
  [Parameter(Mandatory = $true)][string]$Server,
  [string]$User = "root",
  [string]$RemoteDir = "/root/cuoti"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$target = "${User}@${Server}"

function Run($cmd) {
  Write-Host "> $cmd" -ForegroundColor DarkGray
  cmd /c $cmd
  if ($LASTEXITCODE -ne 0) { throw "命令失败: $cmd" }
}

Write-Host "目标服务器: $target : $RemoteDir" -ForegroundColor Cyan

Run "ssh $target ""mkdir -p $RemoteDir/css $RemoteDir/js"""

$files = @("cloud-server.js", "index.html", "login.html", "deploy/deploy.sh")
foreach ($f in $files) {
  $src = Join-Path $root ($f -replace "/", "\")
  if (-not (Test-Path $src)) { throw "找不到文件: $src" }
  $name = Split-Path $src -Leaf
  Run "scp ""$src"" ${target}:$RemoteDir/$name"
}

Run "scp -r ""$(Join-Path $root 'css')"" ${target}:$RemoteDir/"
Run "scp -r ""$(Join-Path $root 'js')"" ${target}:$RemoteDir/"

Write-Host ""
Write-Host "上传完成 ✅" -ForegroundColor Green
Write-Host "接下来登录服务器执行："
Write-Host "  cd $RemoteDir && PORT=8765 REGISTER_CODE=你的邀请码 bash deploy.sh"
Write-Host ""
Write-Host "（如果 scp/ssh 提示找不到命令：Windows 设置 → 应用 → 可选功能 → 安装 OpenSSH 客户端）"
