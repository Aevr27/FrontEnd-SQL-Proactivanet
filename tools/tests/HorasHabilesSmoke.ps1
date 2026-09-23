# tools/tests/HorasHabilesSmoke.ps1 - prueba de humo del horario habil de la
# primera respuesta (lunes a viernes, 08:00-18:30).
#
# NO forma parte del sitio: vive fuera de App_Code y de handlers/, asi que IIS
# no lo publica. Comprueba la MISMA expresion que usa el tablero: extrae el
# texto SQL de App_Code/DashboardQueries.cs entre los marcadores
# <<MINUTOS_HABILES y MINUTOS_HABILES>>, sustituye $M$ por cada extremo y deja
# que SQL Server haga la cuenta. Si alguien toca la expresion, esta prueba
# mide la version nueva: no hay copia que se quede atras.
#
# Como correrla (PowerShell, desde la raiz del repositorio, en la VM que si
# alcanza la base):
#
#   powershell -ExecutionPolicy Bypass -File tools\tests\HorasHabilesSmoke.ps1
#   # imprime PASS/FAIL por caso y sale 0 si todo paso
#
# La cadena de conexion sale de Web.config (clave TicketsProactivanet) o del
# parametro -Cadena. La prueba SOLO hace SELECT de constantes: no lee ninguna
# tabla y no escribe nada.
param(
    [string]$Cadena
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

if (-not $Cadena) {
    $webConfig = Join-Path $raiz 'Web.config'
    if (-not (Test-Path $webConfig)) {
        Write-Host "No hay Web.config en $raiz y no se paso -Cadena."
        exit 2
    }
    $xml = [xml](Get-Content $webConfig -Raw)
    $nodo = $xml.configuration.connectionStrings.add | Where-Object { $_.name -eq 'TicketsProactivanet' }
    if (-not $nodo) {
        Write-Host "Web.config no trae la cadena TicketsProactivanet."
        exit 2
    }
    $Cadena = $nodo.connectionString
}

# --- la expresion, tal cual la usa el tablero ---------------------------------
$fuente = Get-Content (Join-Path $raiz 'App_Code\DashboardQueries.cs') -Raw
$m = [regex]::Match($fuente, '(?s)<<MINUTOS_HABILES.*?@"(.*?)";.*?MINUTOS_HABILES>>')
if (-not $m.Success) {
    Write-Host "No se encontro el bloque <<MINUTOS_HABILES en DashboardQueries.cs."
    exit 2
}
# En un literal verbatim de C# las comillas van dobladas.
$expr = $m.Groups[1].Value -replace '""', '"'
$habIni = $expr.Replace('$M$', '@Ini')
$habFin = $expr.Replace('$M$', '@Fin')

# --- casos (2026-09-21 es lunes; 09-18 viernes; 09-19 sabado; 09-20 domingo) ---
$casos = @(
    @{ n = 'Lunes 08:00 -> Lunes 18:30';    i = '2026-09-21 08:00'; f = '2026-09-21 18:30'; e = 630 },
    @{ n = 'Lunes 08:00 -> Martes 08:00';   i = '2026-09-21 08:00'; f = '2026-09-22 08:00'; e = 630 },
    @{ n = 'Viernes 17:00 -> Lunes 09:00';  i = '2026-09-18 17:00'; f = '2026-09-21 09:00'; e = 150 },
    @{ n = 'Viernes 17:00 -> Lunes 08:00';  i = '2026-09-18 17:00'; f = '2026-09-21 08:00'; e = 90 },
    @{ n = 'Viernes 17:00 -> Viernes 18:00'; i = '2026-09-18 17:00'; f = '2026-09-18 18:00'; e = 60 },
    @{ n = 'Sabado 10:00 -> Lunes 09:00';   i = '2026-09-19 10:00'; f = '2026-09-21 09:00'; e = 60 },
    @{ n = 'Sabado 10:00 -> Domingo 15:00'; i = '2026-09-19 10:00'; f = '2026-09-20 15:00'; e = 0 },
    @{ n = 'Lunes 07:00 -> Lunes 09:00';    i = '2026-09-21 07:00'; f = '2026-09-21 09:00'; e = 60 },
    @{ n = 'Lunes 19:00 -> Martes 09:00';   i = '2026-09-21 19:00'; f = '2026-09-22 09:00'; e = 60 },
    @{ n = 'Mismo instante';                i = '2026-09-21 10:00'; f = '2026-09-21 10:00'; e = 0 },
    @{ n = 'Fin nulo (sin dato)';           i = '2026-09-21 10:00'; f = $null;              e = $null }
)

$sql = "SELECT Minutos = ($habFin) - ($habIni);"
$fallos = 0

Add-Type -AssemblyName System.Data
$cn = New-Object System.Data.SqlClient.SqlConnection $Cadena
$cn.Open()
try {
    foreach ($c in $casos) {
        $cmd = $cn.CreateCommand()
        $cmd.CommandText = $sql
        $pi = $cmd.Parameters.Add('@Ini', [System.Data.SqlDbType]::DateTime2)
        $pf = $cmd.Parameters.Add('@Fin', [System.Data.SqlDbType]::DateTime2)
        $pi.Value = [datetime]::Parse($c.i)
        $pf.Value = if ($null -eq $c.f) { [DBNull]::Value } else { [datetime]::Parse($c.f) }
        $r = $cmd.ExecuteScalar()
        $obtenido = if ($r -is [DBNull]) { $null } else { [int]$r }
        $ok = $obtenido -eq $c.e
        if (-not $ok) { $fallos++ }
        $e = if ($null -eq $c.e) { '(null)' } else { $c.e }
        $o = if ($null -eq $obtenido) { '(null)' } else { $obtenido }
        Write-Host ("{0}  {1}  esperado={2}  obtenido={3}" -f $(if ($ok) { 'PASS ' } else { 'FAIL ' }), $c.n, $e, $o)
    }
} finally {
    $cn.Close()
}

Write-Host ""
Write-Host $(if ($fallos -eq 0) { "TODO PASO ($($casos.Count) casos)" } else { "$fallos CASO(S) FALLARON" })
exit $fallos
