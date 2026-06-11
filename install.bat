@echo off
title SyncWave - Installing Dependencies
color 0A

echo.
echo  ============================================
echo   SyncWave - Installing Dependencies
echo  ============================================
echo.

echo [1/4] Cleaning server node_modules (if any)...
if exist "server\node_modules" (
    rmdir /s /q "server\node_modules"
    echo       Deleted old server\node_modules
) else (
    echo       Nothing to clean
)

echo.
echo [2/4] Installing server dependencies...
cd server
call npm install --no-optional --legacy-peer-deps
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: Server install failed. Try running as Administrator.
    cd ..
    pause
    exit /b 1
)
cd ..
echo       Server dependencies installed OK

echo.
echo [3/4] Cleaning client node_modules (if any)...
if exist "client\node_modules" (
    rmdir /s /q "client\node_modules"
    echo       Deleted old client\node_modules
) else (
    echo       Nothing to clean
)

echo.
echo [4/4] Installing client dependencies...
cd client
call npm install --no-optional --legacy-peer-deps
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: Client install failed.
    cd ..
    pause
    exit /b 1
)
cd ..
echo       Client dependencies installed OK

echo.
echo  ============================================
echo   Installation complete!
echo  ============================================
echo.
echo  Next steps:
echo    1. Double-click start-server.bat  (keep this window open)
echo    2. Double-click start-client.bat  (opens in a new window)
echo    3. Open http://localhost:3000 in your browser
echo.
pause
