@echo off
setlocal
cd /d "%~dp0"
if not defined LOCALAPPDATA set "LOCALAPPDATA=%USERPROFILE%\AppData\Local"
if not defined PNB_HOME set "PNB_HOME=%LOCALAPPDATA%\PNB-Pilot"
"%~dp0node.exe" "%~dp0pnb\trade.mjs" %*
exit /b %ERRORLEVEL%
