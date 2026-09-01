# ---------------------------------------------------------------------------
#  test.ps1 - Prueba de concepto: comprobar que la pagina de administracion
#  puede lanzar un script de PowerShell a traves de IIS/ASP.NET.
#
#  El script es deliberadamente inofensivo:
#    - No manda correo.
#    - No abre SMTP.
#    - No consulta la base de datos.
#    - No toca ningun archivo del proyecto.
#
#  Lo unico que hace es escribir una linea con la marca de tiempo en
#  C:\Temp\admin-powershell-test.txt para dejar constancia de que se ejecuto.
#
#  Lo invoca handlers/admin_prueba_powershell.ashx con la ruta fija; no acepta
#  ningun parametro.
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'

$carpeta = 'C:\Temp'
$archivo = Join-Path $carpeta 'admin-powershell-test.txt'

if (-not (Test-Path -LiteralPath $carpeta)) {
    New-Item -ItemType Directory -Path $carpeta | Out-Null
}

$marca   = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$usuario = "$env:USERDOMAIN\$env:USERNAME"
$linea   = "[$marca] EXITO: test.ps1 se ejecuto correctamente desde la consola de administracion. Usuario del proceso: $usuario. PID: $PID."

Add-Content -LiteralPath $archivo -Value $linea -Encoding UTF8

# Lo que se escribe en la salida estandar es lo que el handler devuelve a la
# pagina, asi que el mensaje esta pensado para leerse tal cual en pantalla.
Write-Output $linea
Write-Output "Archivo: $archivo"

exit 0
