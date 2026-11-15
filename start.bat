@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Brak Node.js - zainstaluj wersje LTS z https://nodejs.org & pause & exit /b)
if not exist node_modules (
  echo Pierwsze uruchomienie - instaluje zaleznosci...
  call npm install || (pause & exit /b)
  call npx playwright install chromium || (pause & exit /b)
)

rem ===== USTAWIENIA =====
set DEFAULT_CITY=Bielsko-Biała
rem Widoczne okno przegladarki (pomaga przy blokadach anty-bot, np. Media Expert):
rem set HEADLESS=false
rem Dostep z telefonu w domowym Wi-Fi - odkomentuj OBA wiersze i wpisz swoje haslo:
rem set HOST=0.0.0.0
rem set APP_PASSWORD=wpisz-haslo
rem Automatyczne sprawdzanie obserwowanych co 6 godzin:
rem set WATCH_HOURS=6

if "%HOST%"=="0.0.0.0" (
  echo.
  echo Na telefonie otworz: http://ADRES-TEGO-KOMPUTERA:3000
  ipconfig | findstr /i "IPv4"
  echo.
)
start "" http://localhost:3000
node server.js
pause
