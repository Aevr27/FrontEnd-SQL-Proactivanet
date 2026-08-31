@echo off
REM ---------------------------------------------------------------------
REM  Vuelca la firma y el cuerpo de usp_CorreoBacklog_Historico y de
REM  usp_CorreoBacklog_HistoricoPorLider a salida_backlog_historico.txt.
REM
REM    tools\inspect_backlog_historico.cmd [usuario] [password]
REM
REM  Sin argumentos usa PROACTIVANETAD y pide la contrasena.
REM  Solo lee catalogos del sistema: no modifica nada.
REM ---------------------------------------------------------------------
setlocal

set "SERVIDOR=AZVMBDCENTRALQA"
set "BASE=Tickets_Proactivanet"

set "USUARIO=%~1"
if "%USUARIO%"=="" set "USUARIO=PROACTIVANETAD"

set "CLAVE=%~2"
if "%CLAVE%"=="" set /p "CLAVE=Password de %USUARIO%: "

set "SALIDA=%~dp0..\salida_backlog_historico.txt"

sqlcmd -S %SERVIDOR% -d %BASE% -U "%USUARIO%" -P "%CLAVE%" -C -W -w 4000 ^
       -i "%~dp0inspect_backlog_historico.sql" -o "%SALIDA%"

if errorlevel 1 (
  echo Fallo la consulta. Revisa red/VPN y credenciales.
  exit /b 1
)

echo Listo. Salida en "%SALIDA%"
endlocal
