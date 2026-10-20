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
REM  Autenticacion de Windows. La cuenta de desarrollo va en
REM  ADMIN_DEV_IDENTIDAD (segundo argumento; por omision SORIANA\t_andresvr)
REM  y tiene que estar en App_Code/AdminWhitelistTemporal.cs. Ademas hace
REM  falta, en el Web.config LOCAL, el interruptor (apagado por omision)
REM      <add key="AdminDevOverride" value="true" />   (en appSettings)
REM  y <compilation debug="true">, y abrir desde esta misma maquina
REM  (App_Code/AccesoDesarrolloLocal.cs). Otra cuenta -> 403. En la VM (IIS,
REM  w3wp.exe) nada de esto aplica.
REM  Rol de desarrollo (tercer argumento, ADM o MOD; por omision ADM).
REM
REM    dev-local.cmd 8081                          ->  t_andresvr como ADM
REM    dev-local.cmd 8081 SORIANA\t_andresvr MOD   ->  probar lo de MOD
REM    http://localhost:8081/admin/iniciativas.html
REM ---------------------------------------------------------------------
setlocal

set "PUERTO=%~1"
if "%PUERTO%"=="" set "PUERTO=8081"

set "ADMIN_DEV_IDENTIDAD=%~2"
if not defined ADMIN_DEV_IDENTIDAD set "ADMIN_DEV_IDENTIDAD=SORIANA\t_andresvr"

REM  La cuenta tiene que traer DOMINIO\cuenta. Desde Git Bash, sin comillas,
REM  bash se come la barra (SORIANAt_andresvr) y la aplicacion la descarta:
REM  Admin da 403. Se corta aqui con el aviso.
set "SIN_BARRA=%ADMIN_DEV_IDENTIDAD:\=%"
if "%SIN_BARRA%"=="%ADMIN_DEV_IDENTIDAD%" goto :cuentaInvalida
if "%ADMIN_DEV_IDENTIDAD:~0,1%"=="\" goto :cuentaInvalida
if "%ADMIN_DEV_IDENTIDAD:~-1%"=="\" goto :cuentaInvalida

set "ADMIN_DEV_ROL=%~3"
if not defined ADMIN_DEV_ROL set "ADMIN_DEV_ROL=ADM"
if /I not "%ADMIN_DEV_ROL%"=="ADM" if /I not "%ADMIN_DEV_ROL%"=="MOD" goto :rolInvalido

REM  Si ya hay algo escuchando en el puerto (p. ej. un IIS Express de un
REM  arranque anterior), el nuevo no arranca y sigue contestando el viejo,
REM  con el codigo de antes. Se corta con el aviso.
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
echo Admin local: http://localhost:%PUERTO%/admin/iniciativas.html
REM  Solo aviso: quien decide es el servidor (AccesoDesarrolloLocal).
findstr /R /I /C:"key=\"AdminDevOverride\" *value=\"true\"" "%~dp0Web.config" >nul
if errorlevel 1 (
  echo   AdminDevOverride no esta en "true" en Web.config: Admin local sigue la regla normal ^(403^).
) else (
  echo   cuenta %ADMIN_DEV_IDENTIDAD% como %ADMIN_DEV_ROL% ^(solo si esta en la whitelist, debug="true" y desde esta maquina^)
)
"%IISEXPRESS%" /path:"%RAIZ%" /port:%PUERTO% /clr:v4.0

endlocal
exit /b

:cuentaInvalida
echo ERROR: la cuenta de desarrollo debe ser DOMINIO\cuenta; llego "%ADMIN_DEV_IDENTIDAD%".
echo        Desde Git Bash ponla entre comillas simples:
echo          ./dev-local.cmd %PUERTO% 'SORIANA\t_andresvr' ADM
exit /b 1

:rolInvalido
echo ERROR: el rol de desarrollo debe ser ADM o MOD; llego "%ADMIN_DEV_ROL%".
exit /b 1

:puertoOcupado
echo ERROR: el puerto %PUERTO% ya esta en uso (otro IIS Express?). Cierralo o usa otro puerto:
echo          taskkill /F /IM iisexpress.exe
exit /b 1
