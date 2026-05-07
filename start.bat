@echo off
REM One-click launcher for the Logo Projection viewer.
REM Starts a local HTTP server on port 5501 (so Three.js can load ES modules
REM via http:// instead of file://) and opens an isolated Chrome window
REM aimed at it. Leave this window open while you use the viewer; close it
REM (or Ctrl+C) to stop the server.

cd /d "%~dp0"

set PORT=5501
set URL=http://127.0.0.1:%PORT%/index.html
set CHROME_PROFILE=%LOCALAPPDATA%\LogoProjectionChrome
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"

REM If something is already listening on PORT (e.g. VS Code Live Server),
REM skip starting our own server and jump straight to Chrome.
netstat -an | findstr /R /C:":%PORT% .*LISTENING" >nul
if %ERRORLEVEL%==0 (
    echo Port %PORT% is already serving — using existing server.
    goto :launch_chrome
)

echo Starting local server at %URL% ...
echo (Close this window or press Ctrl+C to stop the server.)
echo.

where python >nul 2>nul
if %ERRORLEVEL%==0 (
    start "Logo Projection server" /min cmd /c "python -m http.server %PORT%"
    goto :wait_for_server
)

where py >nul 2>nul
if %ERRORLEVEL%==0 (
    start "Logo Projection server" /min cmd /c "py -m http.server %PORT%"
    goto :wait_for_server
)

echo Python was not found on PATH. Install Python from https://www.python.org/
echo or start any other static server in this folder on port %PORT%.
pause
exit /b 1

:wait_for_server
REM Give the server a moment to bind the port before Chrome hits it.
for /L %%i in (1,1,20) do (
    netstat -an | findstr /R /C:":%PORT% .*LISTENING" >nul && goto :launch_chrome
    timeout /t 1 /nobreak >nul
)

:launch_chrome
start "" %CHROME% ^
    --user-data-dir="%CHROME_PROFILE%" ^
    --disable-background-timer-throttling ^
    --disable-renderer-backgrounding ^
    --disable-backgrounding-occluded-windows ^
    --new-window "%URL%"
