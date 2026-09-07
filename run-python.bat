@echo off
if exist "%USERPROFILE%\.qwenpaw\venv\Scripts\python.exe" (
  "%USERPROFILE%\.qwenpaw\venv\Scripts\python.exe" %*
) else (
  python %*
)
exit /b %errorlevel%
