@echo off
setlocal
cd /d "%~dp0"
node scripts\apply-kan15-replacement.mjs
exit /b %errorlevel%
