@echo off
rem Avvia Miitomo Web in locale (server su http://localhost:8173, solo su questo PC)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve-local.ps1"
