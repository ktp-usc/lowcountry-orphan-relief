@echo off
setlocal
cd /d "%~dp0"
node scripts\apply-kan15-replacement.mjs
if errorlevel 1 exit /b 1
call npm ci
if errorlevel 1 exit /b 1
call npm run db:deploy
if errorlevel 1 exit /b 1
call npm run db:seed
if errorlevel 1 exit /b 1
call npm run db:seed
if errorlevel 1 exit /b 1
call npm run db:check:seed
if errorlevel 1 exit /b 1
call npm run db:seed:demo
if errorlevel 1 exit /b 1
call npm run db:seed:demo
if errorlevel 1 exit /b 1
call npm run db:check:seed -- --demo
if errorlevel 1 exit /b 1
call npm run db:test
if errorlevel 1 exit /b 1
call npm run lint
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1
echo.
echo PASS: KAN-15 seed commands, valuation checks, constraints, lint and build.
echo Review git status and git diff before committing the complete update.
exit /b 0
