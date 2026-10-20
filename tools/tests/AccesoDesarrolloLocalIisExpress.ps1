# Prueba de la whitelist de desarrollo local (App_Code/AccesoDesarrolloLocal.cs)
# en IIS Express DE VERDAD: el entorno donde debe funcionar (DEBUG + loopback
# + iisexpress.exe). No toca SQL Server: las cuentas fuera de la whitelist son
# anonimas para IIS Express, asi que quedan VIEWER sin consultar la base, y
# los handlers que se llaman cortan antes de SQL (400/403/405).
#
# Requisitos: IIS Express instalado y Web.config local con
# <compilation debug="true"> (si no, el atajo no existe y la prueba avisa).
# El interruptor AdminDevOverride (appSettings del Web.config local) decide
# que casos corren: apagado -> I0; "true" -> I1-I4. Correrla con los dos
# valores para cubrir todo (la prueba NO toca Web.config).
#
# Corre desde la raiz del repo:
#   powershell -ExecutionPolicy Bypass -File tools\tests\AccesoDesarrolloLocalIisExpress.ps1 [-Puerto 8097]
#
# Casos:
#   I0 AdminDevOverride apagado: dev-local.cmd con la cuenta de la whitelist
#      como ADM NO entra (regla normal: anonimo -> VIEWER -> 403).
#   I1 dev-local.cmd sin cuenta (SORIANA\t_andresvr por omision): entra como ADM.
#   I2 dev-local.cmd con MOD: entra como MOD; lo solo-ADM da 403 RolInsuficiente.
#   I3 dev-local.cmd con otra cuenta local: NO entra (403 en handlers).
#   I4 IIS Express sin ADMIN_DEV_IDENTIDAD (no arrancado por dev-local): NO entra.
#   En I3/I4 se manda ademas lo que un cliente podria falsificar (headers,
#   query, cookie con la cuenta de la whitelist): no cambia nada.
param([int]$Puerto = 8097)

$ErrorActionPreference = 'Stop'
$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$fallos = 0

function Check($caso, $esperado, $obtenido) {
    if ("$esperado" -eq "$obtenido") { "PASS  $caso" }
    else { $script:fallos++; "FAIL  $caso  esperado=$esperado  obtenido=$obtenido" }
}

$cfg = Join-Path $raiz 'Web.config'
if (-not (Test-Path $cfg) -or -not (Select-String -Path $cfg -Pattern 'compilation\s+debug="true"' -Quiet)) {
    'SKIP  Web.config local sin <compilation debug="true">: el atajo no se compila.'
    exit 2
}
# El interruptor, leido como XML (un <add> comentado no cuenta), con la misma
# regla que el servidor: solo "true".
$override = @(([xml](Get-Content $cfg -Raw)).configuration.appSettings.add |
    Where-Object { $_.key -eq 'AdminDevOverride' -and "$($_.value)".Trim() -eq 'true' }).Count -gt 0
"      (AdminDevOverride encendido en Web.config local: $override)"
$iis = Join-Path $env:ProgramFiles 'IIS Express\iisexpress.exe'
if (-not (Test-Path $iis)) { $iis = Join-Path ${env:ProgramFiles(x86)} 'IIS Express\iisexpress.exe' }
if (-not (Test-Path $iis)) { 'SKIP  no hay IIS Express'; exit 2 }

function Pedir($ruta, $headers) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 -Headers $headers "http://localhost:$Puerto/$ruta"
        return @{ Estado = [int]$r.StatusCode; Cuerpo = $r.Content }
    } catch [System.Net.WebException] {
        # 4xx/5xx: PowerShell 5.1 ya leyo el cuerpo y lo deja en ErrorDetails.
        $resp = $_.Exception.Response
        if ($resp -eq $null) { return @{ Estado = 0; Cuerpo = $_.Exception.Message } }
        $txt = if ($_.ErrorDetails) { $_.ErrorDetails.Message } else { '' }
        return @{ Estado = [int]$resp.StatusCode; Cuerpo = "$txt" }
    }
}

# Arranca un IIS Express (via dev-local.cmd o directo, sin la variable) y
# espera a que conteste; devuelve el proceso para cortarlo despues.
function Arrancar($argsDevLocal, [switch]$Directo) {
    Get-CimInstance Win32_Process -Filter "name='iisexpress.exe'" |
        Where-Object { $_.CommandLine -match "/port:$Puerto\b" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Start-Sleep -Milliseconds 500
    if ($Directo) {
        Remove-Item Env:ADMIN_DEV_IDENTIDAD -ErrorAction SilentlyContinue
        Remove-Item Env:ADMIN_DEV_ROL -ErrorAction SilentlyContinue
        Start-Process -FilePath $iis -ArgumentList "/path:`"$raiz`"", "/port:$Puerto", '/clr:v4.0' -WindowStyle Hidden | Out-Null
    } else {
        $cmd = "`"$(Join-Path $raiz 'dev-local.cmd')`" $Puerto $argsDevLocal"
        Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmd -WindowStyle Hidden | Out-Null
    }
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        $r = Pedir 'handlers/admin_sesion.ashx' @{}
        if ($r.Estado -eq 200) { return }
    }
    throw "IIS Express no contesto en el puerto $Puerto"
}

function Parar {
    Get-CimInstance Win32_Process -Filter "name='iisexpress.exe'" |
        Where-Object { $_.CommandLine -match "/port:$Puerto\b" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

# Lo que un navegador o un atacante podria mandar para hacerse pasar por la
# cuenta de la whitelist.
$falsos = @{
    'X-ADMIN-DEV-IDENTIDAD' = 'SORIANA\t_andresvr'
    'ADMIN_DEV_IDENTIDAD'   = 'SORIANA\t_andresvr'
    'X-Forwarded-For'       = '127.0.0.1'
    'X-Remote-User'         = 'SORIANA\t_andresvr'
    'Cookie'                = 'ADMIN_DEV_IDENTIDAD=SORIANA%5Ct_andresvr; ADMIN_DEV_ROL=ADM'
}
$qFalso = 'ADMIN_DEV_IDENTIDAD=SORIANA%5Ct_andresvr&ADMIN_DEV_ROL=ADM'

try {
  if (-not $override) {
    # ---- I0 interruptor apagado: la whitelist sola no basta --------------
    Arrancar ''
    foreach ($caso in @(@{ n = 'limpio'; h = @{}; q = '' }, @{ n = 'con headers/query/cookie falsos'; h = $falsos; q = "?$qFalso" })) {
        $r = Pedir ('handlers/admin_sesion.ashx' + $caso.q) $caso.h
        Check "I0 apagado ($($caso.n)): admin_sesion no autoriza" '200|{"autorizado":false}' "$($r.Estado)|$($r.Cuerpo)"
        $r = Pedir ('handlers/admin_iniciativas_capacidad.ashx' + $caso.q) $caso.h
        Check "I0 apagado ($($caso.n)): capacidad 403 AccesoDenegado" '403|True' "$($r.Estado)|$($r.Cuerpo.Contains('AccesoDenegado'))"
        $r = Pedir ('handlers/admin_iniciativas_gestion.ashx' + $caso.q) $caso.h
        Check "I0 apagado ($($caso.n)): gestion (crear/modificar) 403" 403 $r.Estado
        $r = Pedir ('handlers/admin_correos.ashx' + $caso.q) $caso.h
        Check "I0 apagado ($($caso.n)): admin_correos 403" 403 $r.Estado
    }
    'SKIP  I1-I4: encender AdminDevOverride en Web.config local y volver a correr'
  } else {
    # ---- I1 la cuenta de la whitelist, por omision ----------------------
    Arrancar ''
    $r = Pedir 'handlers/admin_sesion.ashx' @{}
    Check 'I1 admin_sesion: ADM por la whitelist local' '200|{"autorizado":true,"rol":"ADM","desarrollo_local":true}' "$($r.Estado)|$($r.Cuerpo)"
    $r = Pedir 'handlers/admin_iniciativas_capacidad.ashx' @{}
    Check 'I1 capacidad: pasa Exigir (400 sin categoria, sin SQL)' '400|True' "$($r.Estado)|$($r.Cuerpo.Contains('SolicitudInvalida'))"
    $r = Pedir 'handlers/admin_correos.ashx' @{}
    Check 'I1 admin_correos (solo ADM): no 403' 'True' ($r.Estado -ne 403)
    $r = Pedir 'handlers/admin_iniciativas_gestion.ashx' @{}
    Check 'I1 gestion (crear/modificar directo) ADM: pasa ExigirAdm (405 por GET)' 405 $r.Estado
    $r = Pedir 'admin/iniciativas.html' @{}
    Check 'I1 pagina: 200' 200 $r.Estado

    # ---- I2 misma cuenta como MOD ---------------------------------------
    Arrancar 'SORIANA\t_andresvr MOD'
    $r = Pedir 'handlers/admin_sesion.ashx' @{}
    Check 'I2 admin_sesion: MOD' '{"autorizado":true,"rol":"MOD","desarrollo_local":true}' $r.Cuerpo
    $r = Pedir 'handlers/admin_correos.ashx' @{}
    Check 'I2 admin_correos con MOD: 403 RolInsuficiente' '403|True' "$($r.Estado)|$($r.Cuerpo.Contains('RolInsuficiente'))"
    $r = Pedir 'handlers/admin_iniciativas_capacidad.ashx' @{}
    Check 'I2 capacidad con MOD: pasa Exigir (400)' 400 $r.Estado
    $r = Pedir 'handlers/admin_iniciativas_gestion.ashx' @{}
    Check 'I2 gestion (crear/modificar directo) con MOD: 403 RolInsuficiente' '403|True' "$($r.Estado)|$($r.Cuerpo.Contains('RolInsuficiente'))"

    # ---- I3 otra cuenta local: no entra sola ----------------------------
    foreach ($otra in 'SORIANA\omaralus', 'SORIANA\t_otro') {
        Arrancar "$otra ADM"
        foreach ($caso in @(@{ n = 'limpio'; h = @{}; q = '' }, @{ n = 'con headers/query/cookie falsos'; h = $falsos; q = "?$qFalso" })) {
            $r = Pedir ('handlers/admin_sesion.ashx' + $caso.q) $caso.h
            Check "I3 $otra ($($caso.n)): admin_sesion no autoriza" '200|{"autorizado":false}' "$($r.Estado)|$($r.Cuerpo)"
            $r = Pedir ('handlers/admin_iniciativas_capacidad.ashx' + $caso.q) $caso.h
            Check "I3 $otra ($($caso.n)): capacidad 403 AccesoDenegado" '403|True' "$($r.Estado)|$($r.Cuerpo.Contains('AccesoDenegado'))"
            $r = Pedir ('handlers/admin_correos.ashx' + $caso.q) $caso.h
            Check "I3 $otra ($($caso.n)): admin_correos 403" 403 $r.Estado
        }
    }

    # ---- I4 IIS Express sin la variable (no lo arranco dev-local) --------
    Arrancar -Directo
    foreach ($caso in @(@{ n = 'limpio'; h = @{}; q = '' }, @{ n = 'con headers/query/cookie falsos'; h = $falsos; q = "?$qFalso" })) {
        $r = Pedir ('handlers/admin_sesion.ashx' + $caso.q) $caso.h
        Check "I4 sin ADMIN_DEV_IDENTIDAD ($($caso.n)): no autoriza" '200|{"autorizado":false}' "$($r.Estado)|$($r.Cuerpo)"
        $r = Pedir ('handlers/admin_iniciativas_registro.ashx' + $caso.q) $caso.h
        Check "I4 sin ADMIN_DEV_IDENTIDAD ($($caso.n)): registro 403 AccesoDenegado" '403|True' "$($r.Estado)|$($r.Cuerpo.Contains('AccesoDenegado'))"
    }
  }
}
finally {
    Parar
}

if ($fallos -eq 0) { 'OK: todo paso'; exit 0 } else { "FALLOS: $fallos"; exit 1 }
