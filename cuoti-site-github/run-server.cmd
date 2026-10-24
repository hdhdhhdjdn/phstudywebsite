@echo off
cd /d "%~dp0"
set "NODE=C:\Users\lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" cloud-server.js >> server.log 2>&1
