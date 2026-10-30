# Prueba de punta a punta del POST de escritura de Admin (crear / modificar
# directo y enviar solicitud de cambio) con el atajo de desarrollo local
# (App_Code/AccesoDesarrolloLocal.cs) en IIS Express DE VERDAD, sin
# Autenticacion de Windows.
#
# El bug que cubre: el rol ADM del atajo pasaba ExigirAdm, pero la escritura
# se firmaba con IdentidadWindows.DesdeContexto (anonima en IIS Express) y
# respondia 403 SinUsuario. Ahora firma AccesoAdmin.IdentidadEscritura.
#
# NUNCA ESCRIBE EN UNA BASE: arma un sitio temporal (junctions a App_Code y
# handlers, copia de dev-local.cmd) con un Web.config generado desde
# Web.config.ejemplo cuya cadena de conexion apunta a un puerto cerrado de
# 127.0.0.1. Lo que llega a la base responde 503 ValidacionNoDisponible. No
# lee ni toca el Web.config del repo / de la VM.
#
# Corre desde la raiz del repo:
#   powershell -ExecutionPolicy Bypass -File tools\tests\AdminEscrituraLocalIisExpress.ps1 [-Puerto 8098] [-Raiz <arbol>]
# -Raiz: arbol con App_Code/handlers/dev-local.cmd a probar (por omision el
# repo; sirve para correrla contra un commit anterior extraido con git archive).
#
# Casos:
#   P1 interruptor encendido, ADM: crear/modificar pasan rol y firma (422 de
#      formato o 503 sin base; nunca 403); enviar solicitud: 422 de formato
#      (antes 403 SinUsuario).
#   P2 interruptor encendido, MOD: crear/modificar 403 RolInsuficiente;
#      enviar solicitud pasa (422).
#   P3 interruptor apagado: crear/modificar/enviar 403 AccesoDenegado, tambien
#      con headers/query/cookie falsos.
param([int]$Puerto = 8098, [string]$Raiz)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $Raiz) { $Raiz = $repo }
$Raiz = (Resolve-Path $Raiz).Path
$fallos = 0

function Check($caso, $esperado, $obtenido) {
    if ("$esperado" -eq "$obtenido") { "PASS  $caso" }
    else { $script:fallos++; "FAIL  $caso  esperado=$esperado  obtenido=$obtenido" }
}

$iis = Join-Path $env:ProgramFiles 'IIS Express\iisexpress.exe'
if (-not (Test-Path $iis)) { $iis = Join-Path ${env:ProgramFiles(x86)} 'IIS Express\iisexpress.exe' }
if (-not (Test-Path $iis)) { 'SKIP  no hay IIS Express'; exit 2 }

# ---- sitio temporal --------------------------------------------------------
$sitio = Join-Path ([IO.Path]::GetTempPath()) ("adm-escritura-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory $sitio | Out-Null
foreach ($d in 'App_Code', 'handlers') {
    cmd /c mklink /J "$(Join-Path $sitio $d)" "$(Join-Path $Raiz $d)" | Out-Null
}
Copy-Item (Join-Path $Raiz 'dev-local.cmd') $sitio

function Configurar([bool]$encendido) {
    [xml]$x = Get-Content (Join-Path $repo 'Web.config.ejemplo') -Raw
    foreach ($cs in $x.configuration.connectionStrings.add) {
        # Puerto cerrado: falla en el acto y nunca alcanza una base.
        $cs.connectionString = 'Server=127.0.0.1,1;Database=NoExiste;User ID=nadie;Password=nadie;Connection Timeout=2'
    }
    $x.configuration.'system.web'.compilation.debug = 'true'
    if ($encendido) {
        $add = $x.CreateElement('add')
        $add.SetAttribute('key', 'AdminDevOverride'); $add.SetAttribute('value', 'true')
        $x.configuration.appSettings.AppendChild($add) | Out-Null
    }
    $x.Save((Join-Path $sitio 'Web.config'))
}

function Pedir($metodo, $ruta, $campos, $headers) {
    try {
        # Un POST del navegador desde el propio sitio trae Sec-Fetch-Site:
        # sin el, AccesoAdmin.ExigirMismoOrigen responde 403 (CSRF).
        $h = @{ 'Sec-Fetch-Site' = 'same-origin' }
        if ($headers) { foreach ($k in $headers.Keys) { $h[$k] = $headers[$k] } }
        $p = @{ UseBasicParsing = $true; TimeoutSec = 120; Method = $metodo; Uri = "http://localhost:$Puerto/$ruta"; Headers = $h }
        if ($campos) { $p.Body = $campos }
        $r = Invoke-WebRequest @p
        return @{ Estado = [int]$r.StatusCode; Cuerpo = $r.Content }
    } catch [System.Net.WebException] {
        $resp = $_.Exception.Response
        if ($resp -eq $null) { return @{ Estado = 0; Cuerpo = $_.Exception.Message } }
        $txt = if ($_.ErrorDetails) { $_.ErrorDetails.Message } else { '' }
        return @{ Estado = [int]$resp.StatusCode; Cuerpo = "$txt" }
    }
}

function Parar {
    Get-CimInstance Win32_Process -Filter "name='iisexpress.exe'" |
        Where-Object { $_.CommandLine -match "/port:$Puerto\b" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

function Arrancar($argsDevLocal) {
    Parar
    Start-Sleep -Milliseconds 500
    $cmd = "`"$(Join-Path $sitio 'dev-local.cmd')`" $Puerto $argsDevLocal"
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmd -WindowStyle Hidden | Out-Null
    for ($i = 0; $i -lt 90; $i++) {
        Start-Sleep -Milliseconds 500
        if ((Pedir 'GET' 'handlers/admin_sesion.ashx' $null @{}).Estado -eq 200) { return }
    }
    throw "IIS Express no contesto en el puerto $Puerto"
}

$crear = @{ accion = 'crear'; tipo = 'PRB'; titulo = 'Prueba atajo local'; descripcion = 'x' }
$modificar = @{ accion = 'modificar'; folio = 'PRB 2026-000001'; titulo = 'Prueba atajo local' }
$enviar = @{ accion = 'enviar' }
$gestion = 'handlers/admin_iniciativas_gestion.ashx'
$solicitudes = 'handlers/admin_iniciativas_solicitudes.ashx?accion=enviar'
$falsos = @{
    'X-ADMIN-DEV-IDENTIDAD' = 'SORIANA\t_andresvr'
    'X-Forwarded-For'       = '127.0.0.1'
    'X-Remote-User'         = 'SORIANA\t_andresvr'
    'Cookie'                = 'ADMIN_DEV_IDENTIDAD=SORIANA%5Ct_andresvr; ADMIN_DEV_ROL=ADM; AdminDevOverride=true'
}

function PasoFirma($r) {
    # Paso rol y firma: lo que sigue es formato (422) o la base caida (503).
    return ($r.Estado -eq 422 -or ($r.Estado -eq 503 -and $r.Cuerpo.Contains('ValidacionNoDisponible'))) -and -not $r.Cuerpo.Contains('SinUsuario')
}

"      (arbol probado: $Raiz)"
try {
    # ---- P1 encendido, ADM ------------------------------------------------
    Configurar $true
    Arrancar ''
    $r = Pedir 'GET' 'handlers/admin_sesion.ashx' $null @{}
    Check 'P1 admin_sesion: ADM por el atajo' '{"autorizado":true,"rol":"ADM","desarrollo_local":true}' $r.Cuerpo
    $r = Pedir 'POST' $gestion $crear @{}
    Check "P1 POST crear ADM: pasa rol y firma (sin 403 SinUsuario) [$($r.Estado)]" $true (PasoFirma $r)
    $r = Pedir 'POST' $gestion $modificar @{}
    Check "P1 POST modificar ADM: pasa rol y firma (sin 403 SinUsuario) [$($r.Estado)]" $true (PasoFirma $r)
    $r = Pedir 'POST' $solicitudes $enviar @{}
    Check 'P1 POST enviar solicitud ADM: firma y llega al formato (422)' '422|False' "$($r.Estado)|$($r.Cuerpo.Contains('SinUsuario'))"

    # ---- P2 encendido, MOD ------------------------------------------------
    Arrancar 'SORIANA\t_andresvr MOD'
    $r = Pedir 'POST' $gestion $crear @{}
    Check 'P2 POST crear MOD: 403 RolInsuficiente' '403|True' "$($r.Estado)|$($r.Cuerpo.Contains('RolInsuficiente'))"
    $r = Pedir 'POST' $gestion $modificar @{}
    Check 'P2 POST modificar MOD: 403 RolInsuficiente' '403|True' "$($r.Estado)|$($r.Cuerpo.Contains('RolInsuficiente'))"
    $r = Pedir 'POST' $solicitudes $enviar @{}
    Check 'P2 POST enviar solicitud MOD: firma y llega al formato (422)' '422|False' "$($r.Estado)|$($r.Cuerpo.Contains('SinUsuario'))"

    # ---- P3 apagado -------------------------------------------------------
    Configurar $false
    Arrancar ''
    foreach ($caso in @(@{ n = 'limpio'; h = @{}; q = '' },
                        @{ n = 'con headers/query/cookie falsos'; h = $falsos; q = '?ADMIN_DEV_IDENTIDAD=SORIANA%5Ct_andresvr&AdminDevOverride=true' })) {
        $r = Pedir 'POST' ($gestion + $caso.q) $crear $caso.h
        Check "P3 apagado ($($caso.n)): POST crear 403 AccesoDenegado" '403|True' "$($r.Estado)|$($r.Cuerpo.Contains('AccesoDenegado'))"
        $r = Pedir 'POST' ($gestion + $caso.q) $modificar $caso.h
        Check "P3 apagado ($($caso.n)): POST modificar 403 AccesoDenegado" '403|True' "$($r.Estado)|$($r.Cuerpo.Contains('AccesoDenegado'))"
        $sep = if ($caso.q) { '&' + $caso.q.Substring(1) } else { '' }
        $r = Pedir 'POST' ($solicitudes + $sep) $enviar $caso.h
        Check "P3 apagado ($($caso.n)): POST enviar 403 AccesoDenegado" '403|True' "$($r.Estado)|$($r.Cuerpo.Contains('AccesoDenegado'))"
    }
}
finally {
    Parar
    Start-Sleep -Milliseconds 500
    # Las junctions se quitan sin tocar su destino (rmdir no recorre una junction).
    # Si alguna queda, NO se borra la carpeta (Remove-Item -Recurse podria
    # entrar en la junction y borrar el arbol real).
    foreach ($d in 'App_Code', 'handlers') { cmd /c rmdir "$(Join-Path $sitio $d)" | Out-Null }
    if ((Test-Path (Join-Path $sitio 'App_Code')) -or (Test-Path (Join-Path $sitio 'handlers'))) {
        "AVISO  quedaron junctions en $sitio; quitarlas con rmdir antes de borrar la carpeta"
    } else {
        Remove-Item -Recurse -Force $sitio -ErrorAction SilentlyContinue
    }
}

if ($fallos -eq 0) { 'OK: todo paso'; exit 0 } else { "FALLOS: $fallos"; exit 1 }
