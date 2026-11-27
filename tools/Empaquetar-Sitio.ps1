<#
.SYNOPSIS
    Arma el paquete del sitio IIS (DASHBOARD.md, seccion 5) desde un commit.

.DESCRIPTION
    El paquete sale de un COMMIT con git archive, nunca del arbol de trabajo:
    por eso no puede llevar el Web.config local (no esta versionado:
    .gitignore) con su webhook, TeamsPruebaDestinatario o AdminDevOverride.
    El servidor CONSERVA su Web.config; este paquete no lo trae ni lo
    reemplaza.

    Incluye solo el arbol del sitio de DASHBOARD.md seccion 5 y excluye el
    panel de pruebas de Power Automate (solo localhost). Antes de entregar el
    ZIP lo abre y valida; si algo falla borra lo armado y sale con codigo 1.

    Salida (en -Salida, que debe existir y estar FUERA del repositorio):
        sitio-<commit12>.zip                el paquete (raiz = raiz del sitio)
        sitio-<commit12>.manifiesto.txt     commit, SHA-256 del ZIP, incluidos
                                            (con su blob) y excluidos (con motivo)

    Reproducible: mismo commit y misma version de git = mismo ZIP byte a byte
    (git archive fija la fecha de cada entrada a la del commit;
    core.autocrlf=false deja el contenido tal como esta en el commit).

.PARAMETER Commit
    Commit a empaquetar (hash o referencia; se registra el hash completo).

.PARAMETER Salida
    Carpeta existente, fuera del repositorio, donde dejar ZIP y manifiesto.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\Empaquetar-Sitio.ps1 -Commit b86004f -Salida C:\paquetes
#>
param(
    [Parameter(Mandatory = $true)][string]$Commit,
    [Parameter(Mandatory = $true)][string]$Salida
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# Arbol del sitio: DASHBOARD.md seccion 5. Cambiar aqui y alli a la vez.
$Raices = @('dashboard.html', 'dashboard.css', 'dashboard.js', 'assets', 'backlog', 'experiencia',
            'qa', 'qare', 'tecnicos', 'analisis', 'concentracion', 'admin', 'handlers', 'App_Code')

# Panel de pruebas de Power Automate: solo localhost de desarrollo. Ninguna
# funcionalidad real los usa (el handler y la clase van juntos).
$ExcluidosPanel = @('admin/pruebas-power-automate.html', 'admin/pruebas-power-automate.js',
                    'handlers/admin_pruebas_power_automate.ashx', 'App_Code/PruebasPowerAutomate.cs')

# Deben estar: Admin normal y los tres avisos reales.
$Requeridos = @(
    'dashboard.html', 'dashboard.js', 'dashboard.css',
    'admin/admin.html', 'admin/admin.js', 'admin/admin.css', 'admin/rca-correo.js', 'admin/iniciativas.html',
    'handlers/admin_sesion.ashx', 'handlers/admin_correos.ashx', 'handlers/admin_rca_correo.ashx',
    'App_Code/AvisoTeams.cs', 'App_Code/AvisoNuevaSolicitud.cs', 'App_Code/AvisoRevisionSolicitud.cs',
    'handlers/admin_iniciativas_validar.ashx', 'handlers/admin_iniciativas_solicitudes.ashx',
    'handlers/admin_iniciativas_solicitudes_nuevas_revision.ashx')

# Los tres eventos siguen conectados donde se guarda / aprueba / rechaza.
$Llamadas = @(
    @('handlers/admin_iniciativas_validar.ashx', 'AvisoNuevaSolicitud.Iniciativa('),
    @('handlers/admin_iniciativas_solicitudes.ashx', 'AvisoNuevaSolicitud.Cambio('),
    @('handlers/admin_iniciativas_solicitudes.ashx', 'AvisoRevisionSolicitud.CambioAprobado('),
    @('handlers/admin_iniciativas_solicitudes.ashx', 'AvisoRevisionSolicitud.CambioRechazado('),
    @('handlers/admin_iniciativas_solicitudes_nuevas_revision.ashx', 'AvisoRevisionSolicitud.IniciativaAprobada('),
    @('handlers/admin_iniciativas_solicitudes_nuevas_revision.ashx', 'AvisoRevisionSolicitud.IniciativaRechazada('))

# Valores que nunca deben viajar. Se buscan VALORES, no nombres: el codigo
# real documenta las claves (p. ej. AccesoDesarrolloLocal.cs muestra
# AdminDevOverride="true" en un comentario), y AdminDevOverride solo actua
# dentro de un .config, que ya hace fallar el paquete. La contrasena se busca
# con forma de cadena de conexion (tras ; o comilla): una libreria
# minificada tiene "r.password=...".
$Secretos = @(
    @('firma sig= de un webhook', 'sig=[A-Za-z0-9%_\-]{20,}'),
    @('URL de Power Automate / Logic Apps', 'https://[^\s"''<>]*(logic\.azure\.com|powerplatform\.com|powerautomate)'),
    @('webhook o destinatario de prueba con valor', '<add\s+key\s*=\s*"(TeamsWebhookUrl|TeamsPruebaDestinatario)"\s+value\s*=\s*"[^"]+"'),
    @('contrasena en cadena de conexion', '(?i)(^|[;"''])\s*(password|pwd)\s*=\s*[^;"''\s]{3,}'))

function Fallar([string]$m) { throw "Empaquetar-Sitio: $m" }

function Invoke-GitRepo {
    # En Windows PowerShell 5.1, con Stop, cualquier linea de stderr de un
    # exe redirigida con 2>&1 se vuelve error terminante; se decide por
    # $LASTEXITCODE.
    $ErrorActionPreference = 'Continue'
    $salidaGit = & git -C $script:Repo -c core.autocrlf=false -c core.safecrlf=false -c core.quotepath=false @args 2>&1
    if ($LASTEXITCODE -ne 0) { Fallar ("git " + ($args -join ' ') + " fallo: " + ($salidaGit | Out-String).Trim()) }
    return $salidaGit
}

$tmp = $null
try {
    $script:Repo = (& git -C $PSScriptRoot rev-parse --show-toplevel 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $script:Repo) { Fallar "no se encontro el repositorio de git." }
    $script:Repo = [IO.Path]::GetFullPath($script:Repo)

    & git -C $script:Repo rev-parse --verify --quiet ($Commit + '^{commit}') *> $null
    if ($LASTEXITCODE -ne 0) { Fallar "'$Commit' no es un commit de este repositorio." }
    $sha = ((Invoke-GitRepo rev-parse ($Commit + '^{commit}')) | Select-Object -First 1).ToString().Trim()
    $arbol = ((Invoke-GitRepo rev-parse ($sha + '^{tree}')) | Select-Object -First 1).ToString().Trim()
    $corto = $sha.Substring(0, 12)

    if (-not (Test-Path -LiteralPath $Salida -PathType Container)) { Fallar "la carpeta de salida '$Salida' no existe." }
    $Salida = (Resolve-Path -LiteralPath $Salida).ProviderPath
    $repoBarra = $script:Repo.TrimEnd('\', '/') + '\'
    if (($Salida.TrimEnd('\', '/') + '\').StartsWith($repoBarra, [StringComparison]::OrdinalIgnoreCase)) {
        Fallar "la salida no puede estar dentro del repositorio (el ZIP acabaria versionado por error)."
    }
    $zip = Join-Path $Salida ("sitio-$corto.zip")
    $manifiesto = Join-Path $Salida ("sitio-$corto.manifiesto.txt")
    if ((Test-Path -LiteralPath $zip) -or (Test-Path -LiteralPath $manifiesto)) { Fallar "ya existe $zip o su manifiesto: no se sobrescribe." }

    # Lo que hay en el commit (con su blob) y lo que entra.
    # Rutas sensibles a mayusculas y en orden ordinal: el orden de las
    # entradas del ZIP no debe depender de la cultura de la maquina.
    $todos = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
    foreach ($l in (Invoke-GitRepo ls-tree -r $sha)) {
        $t = $l.ToString()
        $i = $t.IndexOf("`t")
        $meta = $t.Substring(0, $i).Split(' ')
        if ($meta[1] -eq 'blob') { $todos[$t.Substring($i + 1)] = $meta[2] }
    }
    $rutas = New-Object 'string[]' $todos.Count
    $todos.Keys.CopyTo($rutas, 0)
    [Array]::Sort($rutas, [StringComparer]::Ordinal)
    $incluidos = New-Object System.Collections.Generic.List[string]
    $excluidos = New-Object System.Collections.Generic.List[string]
    foreach ($ruta in $rutas) {
        $enSitio = $false
        foreach ($r in $Raices) { if ($ruta -ceq $r -or $ruta.StartsWith($r + '/', [StringComparison]::Ordinal)) { $enSitio = $true } }
        if ($ExcluidosPanel -ccontains $ruta) { $excluidos.Add("$ruta`tpanel de pruebas de Power Automate (solo localhost)") }
        elseif (-not $enSitio) { $excluidos.Add("$ruta`tfuera del arbol del sitio (DASHBOARD.md seccion 5)") }
        else { $incluidos.Add($ruta) }
    }
    foreach ($p in $ExcluidosPanel) { if (-not $todos.ContainsKey($p)) { $excluidos.Add("$p`tpanel de pruebas (no existe en este commit)") } }
    if ($incluidos.Count -eq 0) { Fallar "el commit no tiene archivos del sitio." }
    $faltan = @($Requeridos | Where-Object { -not $incluidos.Contains($_) })
    if ($faltan.Count -gt 0) { Fallar ("faltan archivos requeridos en $corto : " + ($faltan -join ', ')) }

    # Se arma a un temporal y solo se mueve a -Salida si pasa todo.
    $tmp = Join-Path $Salida ("sitio-$corto.zip.tmp-" + [Guid]::NewGuid().ToString('N'))
    Invoke-GitRepo (@('archive', '--format=zip', '-o', $tmp, $sha, '--') + $incluidos.ToArray()) | Out-Null

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $errores = New-Object System.Collections.Generic.List[string]
    $textos = @{}
    $leido = [IO.Compression.ZipFile]::OpenRead($tmp)
    try {
        $nombres = New-Object System.Collections.Generic.List[string]
        foreach ($e in $leido.Entries) {
            if ($e.FullName.EndsWith('/')) { continue }
            $nombres.Add($e.FullName)
            if ($e.FullName -match '\.(html|js|css|cs|ashx|json|md|txt|xml|config)$') {
                $s = $e.Open()
                try { $textos[$e.FullName] = (New-Object IO.StreamReader($s, [Text.Encoding]::UTF8)).ReadToEnd() }
                finally { $s.Dispose() }
            }
        }
    }
    finally { $leido.Dispose() }

    # El ZIP trae exactamente la lista del manifiesto.
    $sobran = @($nombres | Where-Object { -not $incluidos.Contains($_) })
    $noEstan = @($incluidos | Where-Object { -not $nombres.Contains($_) })
    if ($sobran.Count -gt 0) { $errores.Add("el ZIP trae archivos fuera de la lista: " + ($sobran -join ', ')) }
    if ($noEstan.Count -gt 0) { $errores.Add("faltan en el ZIP: " + ($noEstan -join ', ')) }

    foreach ($n in $nombres) {
        if ($ExcluidosPanel -contains $n) { $errores.Add("archivo del panel de pruebas en el paquete: $n") }
        if ($n -match '(?i)(^|/)web\.config$|\.config$|\.ejemplo$') { $errores.Add("archivo de configuracion en el paquete: $n") }
    }
    foreach ($par in $Llamadas) {
        if (-not $textos.ContainsKey($par[0]) -or -not $textos[$par[0]].Contains($par[1])) { $errores.Add("aviso real no conectado: $($par[1]) en $($par[0])") }
    }
    foreach ($n in $textos.Keys) {
        $t = $textos[$n]
        foreach ($sec in $Secretos) { if ($t -match $sec[1]) { $errores.Add("posible secreto ($($sec[0])) en $n") } }
        if ($n -match '\.html$' -and $t -match 'pruebas-power-automate|pruebasPaMontaje') { $errores.Add("$n referencia el panel de pruebas") }
        if ($n -match '\.(cs|ashx)$') {
            if ($t -match '\bPruebasPowerAutomate\.(?!cs\b)|\bAdminPruebasPowerAutomate\b') { $errores.Add("$n usa el panel de pruebas (no compilaria sin el)") }
            if ($t.Contains('TeamsPruebaDestinatario')) { $errores.Add("$n lee TeamsPruebaDestinatario (solo debe hacerlo el panel)") }
        }
    }
    if ($errores.Count -gt 0) { Fallar ("validacion: `n  - " + ($errores -join "`n  - ")) }

    $hash = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToLowerInvariant()
    $gitVer = ((Invoke-GitRepo --version) | Select-Object -First 1).ToString().Trim()
    $m = New-Object System.Text.StringBuilder
    [void]$m.AppendLine("Paquete del sitio IIS (DASHBOARD.md seccion 5)")
    [void]$m.AppendLine("commit:      $sha")
    [void]$m.AppendLine("arbol:       $arbol")
    [void]$m.AppendLine("git:         $gitVer")
    [void]$m.AppendLine("zip:         sitio-$corto.zip")
    [void]$m.AppendLine("sha256:      $hash")
    [void]$m.AppendLine("")
    [void]$m.AppendLine("Web.config: NO va en el paquete. El servidor conserva el suyo; debe tener")
    [void]$m.AppendLine("TeamsWebhookUrl, NO tener TeamsPruebaDestinatario ni AdminDevOverride, y")
    [void]$m.AppendLine("compilation debug=""false"" (DASHBOARD.md).")
    [void]$m.AppendLine("")
    [void]$m.AppendLine("Validado: lista exacta, requeridos presentes, tres avisos reales conectados,")
    [void]$m.AppendLine("sin panel de pruebas, sin .config, sin valores secretos.")
    [void]$m.AppendLine("")
    [void]$m.AppendLine("INCLUIDOS ($($incluidos.Count)) - blob<TAB>ruta")
    foreach ($r in $incluidos) { [void]$m.AppendLine($todos[$r] + "`t" + $r) }
    [void]$m.AppendLine("")
    [void]$m.AppendLine("EXCLUIDOS ($($excluidos.Count)) - ruta<TAB>motivo")
    foreach ($x in $excluidos) { [void]$m.AppendLine($x) }
    [IO.File]::WriteAllText($manifiesto, $m.ToString(), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $zip
    $tmp = $null

    Write-Output "OK  commit $sha"
    Write-Output "    $zip"
    Write-Output "    sha256 $hash"
    Write-Output "    $($incluidos.Count) incluidos, $($excluidos.Count) excluidos (ver $manifiesto)"
    exit 0
}
catch {
    if ($tmp -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Force }
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
