@echo off
rem Avvia MIITOMO REBOOT (funzioni nuove, non originali Nintendo) in locale su http://localhost:8173
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve-local.ps1" -Mode reboot
