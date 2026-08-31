@echo off
REM ---------------------------------------------------------------------
REM  Levanta el sitio en IIS Express con la raiz del proyecto como raiz
REM  web, en http://localhost:8080/
REM
REM  Requisito previo: copiar Web.config.ejemplo como Web.config y poner
REM  las credenciales reales en YOUR_SQL_USER / YOUR_SQL_PASSWORD.
REM  Web.config esta en .gitignore: no se sube nunca.
REM
REM    http://localhost:8080/                       tablero (dashboard.html)
REM    http://localhost:8080/qa_test.html           tablero de QA
REM    http://localhost:8080/handlers/qa_diag.ashx  prueba de conexion
REM ---------------------------------------------------------------------
setlocal

set "PUERTO=%~1"
if "%PUERTO%"=="" set "PUERTO=8080"

set "IISEXPRESS=%ProgramFiles%\IIS Express\iisexpress.exe"
if not exist "%IISEXPRESS%" set "IISEXPRESS=%ProgramFiles(x86)%\IIS Express\iisexpress.exe"
if not exist "%IISEXPRESS%" (
  echo No se encontro iisexpress.exe. Instala IIS Express.
  exit /b 1
)

if not exist "%~dp0Web.config" (
  echo Falta Web.config en la raiz. Copia Web.config.ejemplo como Web.config
  echo y ajusta las credenciales antes de arrancar.
  exit /b 1
)

echo Sirviendo "%~dp0" en http://localhost:%PUERTO%/
"%IISEXPRESS%" /path:"%~dp0." /port:%PUERTO% /clr:v4.0

endlocal
