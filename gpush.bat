@echo off
setlocal enableextensions

REM Ota commit-viesti parametreista; jos puuttuu, käytä aikaleimaa
set MSG=%*
if "%MSG%"=="" set MSG=update %DATE% %TIME%

REM Stageta kaikki muutokset
git add -A

REM Jos ei ole mitään staged, lopetetaan siististi
git diff --cached --quiet
if %errorlevel%==0 (
  echo No changes to commit.
  exit /b 0
)

git commit -m "%MSG%"
if errorlevel 1 exit /b %errorlevel%

REM Puske tämä työtilan HEAD aina origin/main:iin
git push origin HEAD:main