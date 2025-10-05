@echo off
setlocal enableextensions

set MSG=%*
if "%MSG%"=="" set MSG=update %DATE% %TIME%

git add -A
git diff --cached --quiet
if %errorlevel%==0 (
  echo No changes to commit.
  exit /b 0
)

git commit -m "%MSG%"
if errorlevel 1 exit /b %errorlevel%

REM Puske nykyinen tila dev-haaraan
git push origin HEAD:dev
