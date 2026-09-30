@echo off
rem Starts the dev server in seed mode without any external service.
cd /d C:\Users\melik\dev\pracovna
set PATH=C:\Program Files\nodejs;%PATH%
set SEED_MODE=true
set APP_ENV=staging
set LOG_LEVEL=info
node "%APPDATA%\npm\node_modules\pnpm\bin\pnpm.mjs" exec next dev -p 3000
