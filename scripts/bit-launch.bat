@echo off
setlocal
cd /d "%~dp0\.."
set "ELECTRON_RUN_AS_NODE="
echo Iniciando entorno local de Bit...
call npm.cmd start
