@echo off
REM ---------------------------------------------------------------------
REM  Levanta el sitio en IIS Express con la raiz del proyecto como raiz
REM  web, en http://localhost:8081/
REM
REM  Requisito previo: copiar Web.config.ejemplo como Web.config y poner
REM  las credenciales reales en YOUR_SQL_USER / YOUR_SQL_PASSWORD.
REM  Web.config esta en .gitignore: no se sube nunca.
REM
REM    http://localhost:8081/                       tablero (dashboard.html)
REM    http://localhost:8081/qa/qa.html             tablero de QA (suelto)
REM
REM  Admin -> Iniciativas en local (SOLO DESARROLLO): IIS Express no tiene
REM  Autenticacion de Windows, asi que todo llega anonimo y Admin da 403.
REM  Para probarlo, pasar la cuenta como segundo argumento:
REM
REM    dev-local.cmd 8081 SORIANA\t_andresvr
REM
REM  Pone ADMIN_DEV_IDENTIDAD solo para este IIS Express. La cuenta pasa por
REM  la whitelist igual que en la VM (otra cuenta -> 403). Solo actua en
REM  iisexpress, desde localhost y sin identidad real: ver
REM  App_Code/IdentidadDesarrolloLocal.cs. Sin segundo argumento se borra.
REM
REM  Rol simulado (tercer argumento, ADM o MOD): pone ADMIN_DEV_ROL para
REM  probar lo que es solo de ADM sin la base de la VM. Solo vale con la
REM  identidad simulada de arriba (nunca con Windows Auth real ni fuera de
REM  IIS Express); la cuenta igual tiene que pasar la whitelist.
REM
REM    dev-local.cmd 8081 SORIANA\t_andresvr ADM
REM ---------------------------------------------------------------------
setlocal

set "PUERTO=%~1"
if "%PUERTO%"=="" set "PUERTO=8081"

set "ADMIN_DEV_IDENTIDAD=%~2"
if defined ADMIN_DEV_IDENTIDAD echo Admin local: identidad simulada %ADMIN_DEV_IDENTIDAD% (solo IIS Express, solo localhost)
if not defined ADMIN_DEV_IDENTIDAD (
  echo AVISO: sin cuenta simulada. Admin -^> Iniciativas respondera 403 en local
  echo        ^(IIS Express no tiene Autenticacion de Windows^). Para verlo:
  echo          dev-local.cmd %PUERTO% DOMINIO\cuenta ADM
)

REM  La cuenta tiene que traer DOMINIO\cuenta. Desde Git Bash, sin comillas,
REM  bash se come la barra (SORIANAt_andresvr) y la aplicacion la descarta en
REM  silencio: todo llega anonimo y Admin da 403. Se corta aqui con el aviso.
REM  (Sin bloques ( ): con la variable vacia, %VAR:...% rompe el parseo.)
if not defined ADMIN_DEV_IDENTIDAD goto :cuentaRevisada
set "SIN_BARRA=%ADMIN_DEV_IDENTIDAD:\=%"
if "%SIN_BARRA%"=="%ADMIN_DEV_IDENTIDAD%" goto :cuentaInvalida
if "%ADMIN_DEV_IDENTIDAD:~0,1%"=="\" goto :cuentaInvalida
if "%ADMIN_DEV_IDENTIDAD:~-1%"=="\" goto :cuentaInvalida
:cuentaRevisada

set "ADMIN_DEV_ROL=%~3"
if defined ADMIN_DEV_ROL (
  if /I not "%ADMIN_DEV_ROL%"=="ADM" if /I not "%ADMIN_DEV_ROL%"=="MOD" (
    echo ERROR: el rol simulado debe ser ADM o MOD; llego "%ADMIN_DEV_ROL%".
    exit /b 1
  )
)
if defined ADMIN_DEV_ROL echo Admin local: rol simulado %ADMIN_DEV_ROL% (solo con la identidad simulada; ADM o MOD)

REM  Si ya hay algo escuchando en el puerto (p. ej. un IIS Express de un
REM  arranque anterior SIN la cuenta), el nuevo no arranca y el viejo sigue
REM  contestando 403. Se corta con el aviso.
netstat -ano -p tcp | findstr /C:":%PUERTO% " | findstr /C:"LISTENING" >nul && goto :puertoOcupado

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

REM  %~dp0 termina en "\". Pasarlo tal cual a /path: haria que esa barra
REM  final escapase la comilla de cierre. Y "%~dp0." hacia que IIS buscase
REM  el web.config bajo una ruta extendida con un componente "." intermedio.
REM  El prefijo de ruta extendida desactiva la normalizacion, asi que ese
REM  "." no se resuelve, el archivo no existe, y de ahi salia el
REM  HTTP 500.19 con HRESULT 0x80070003. Se quita la barra final y se pasa
REM  la raiz limpia.
set "RAIZ=%~dp0"
if "%RAIZ:~-1%"=="\" set "RAIZ=%RAIZ:~0,-1%"

echo Sirviendo "%RAIZ%" en http://localhost:%PUERTO%/
"%IISEXPRESS%" /path:"%RAIZ%" /port:%PUERTO% /clr:v4.0

endlocal
exit /b

:cuentaInvalida
echo ERROR: la cuenta simulada debe ser DOMINIO\cuenta; llego "%ADMIN_DEV_IDENTIDAD%".
echo        Desde Git Bash ponla entre comillas simples:
echo          ./dev-local.cmd %PUERTO% 'SORIANA\t_andresvr' ADM
exit /b 1

:puertoOcupado
echo ERROR: el puerto %PUERTO% ya esta en uso (otro IIS Express?). Cierralo o usa otro puerto:
echo          taskkill /F /IM iisexpress.exe
exit /b 1
