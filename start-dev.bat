@echo off
setlocal enableextensions

REM Siirry tähän .batin kansioon (projektin juuri)
pushd "%~dp0"

REM Peruscheckit
where node >nul 2>&1 || (echo [VIRHE] Node.js puuttuu. Asenna https://nodejs.org & goto :end)
where npm  >nul 2>&1 || (echo [VIRHE] npm puuttuu. Asenna Node.js & goto :end)

REM Asenna riippuvuudet jos node_modules puuttuu
if not exist "node_modules" (
  echo [INFO] node_modules puuttuu -> asennetaan...
  call npm install || goto :end
)

echo [INFO] Buildataan...
call npm run build || goto :end

echo [INFO] Kaynnistetaan preview-palvelin (Ctrl+C lopettaa)...
REM Valinnainen portti parametrina: start-preview.bat 4174
set PORT_ARG=
if not "%~1"=="" set PORT_ARG=--port %~1
call npm run preview -- --open %PORT_ARG%

:end
popd
endlocal
