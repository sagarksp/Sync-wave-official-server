@echo off
title SyncWave - Server (port 3001)
color 0B

echo.
echo  ============================================
echo   SyncWave Server - starting on port 3001
echo  ============================================
echo.

if not exist "server\node_modules" (
    echo  node_modules not found. Running npm install first...
    echo.
    cd server
    call npm install --no-optional --legacy-peer-deps
    cd ..
)

cd server
echo  Starting server...
echo  Keep this window open while using SyncWave.
echo.
npm run dev
