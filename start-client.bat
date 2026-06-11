@echo off
title SyncWave - Client (port 3000)
color 0E

echo.
echo  ============================================
echo   SyncWave Client - starting on port 3000
echo  ============================================
echo.

if not exist "client\node_modules" (
    echo  node_modules not found. Running npm install first...
    echo.
    cd client
    call npm install --no-optional --legacy-peer-deps
    cd ..
)

cd client
echo  Starting client...
echo  Browser will open at http://localhost:3000
echo  Keep this window open.
echo.
npm start
