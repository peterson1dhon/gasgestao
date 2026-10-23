@echo off
setlocal
set "GASGESTAO_EXE=%~dp0release\win-unpacked\GasGestao.exe"
if not exist "%GASGESTAO_EXE%" (
  echo O executavel ainda nao foi gerado. Consulte o README do projeto.
  pause
  exit /b 1
)
start "" "%GASGESTAO_EXE%"
