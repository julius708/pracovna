@echo off
rem Starts the dev server against the real Supabase project and the real Guesty API (values from .env.local).
cd /d C:\Users\melik\dev\pracovna
set PATH=C:\Program Files\nodejs;%PATH%
node "%APPDATA%\npm\node_modules\pnpm\bin\pnpm.mjs" exec next dev -p 3000
