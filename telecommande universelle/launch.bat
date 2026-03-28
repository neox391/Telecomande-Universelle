@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe ou n'est pas dans le PATH.
  echo Installe Node.js puis relance ce fichier.
  pause
  exit /b 1
)

set "PORT=8080"
set "URL=http://localhost:%PORT%"

netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if errorlevel 1 (
  echo Demarrage du serveur local...
  start "Telecommande Universelle Server" cmd /c "cd /d "%~dp0" && node server.js"
) else (
  echo Serveur deja actif sur le port %PORT%.
)

echo Verification du serveur...
powershell -NoProfile -Command ^
  "$deadline=(Get-Date).AddSeconds(15); $ok=$false; while((Get-Date) -lt $deadline){ try { Invoke-WebRequest -UseBasicParsing '%URL%/api/scan' -TimeoutSec 3 | Out-Null; $ok=$true; break } catch { Start-Sleep -Milliseconds 500 } }; if(-not $ok){ exit 1 }"

if errorlevel 1 (
  echo Le serveur n'a pas repondu a temps.
  echo Verifie la fenetre "Telecommande Universelle Server" puis relance.
  pause
  exit /b 1
)

echo Ouverture de l'application...
start "" "%URL%"

endlocal
