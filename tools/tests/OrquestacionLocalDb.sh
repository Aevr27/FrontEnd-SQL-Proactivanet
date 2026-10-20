#!/usr/bin/env bash
# Prueba sql/77_tablero_orquestacion.sql y App_Code/OrquestacionQueries.cs en
# LocalDB, con el esquema orq de mentira (OrquestacionLocalDb_stub.sql: NO es
# el 76). Base desechable OrqSmoke_<pid>; se borra al final.
#
#   bash tools/tests/OrquestacionLocalDb.sh      (desde la raiz del repo, Git Bash)
#   bash tools/tests/OrquestacionLocalDb.sh r.json   (ademas guarda la respuesta del handler)
#
# 1. El 77 sin el 76: avisa y no crea ninguna vista.
# 2. El stub y el 77 dos veces: las tres vistas cada vez.
# 3. OrquestacionQueries (compilado con App_Code, codepage 1252 como IIS) y
#    su respuesta por OrquestacionCalc (node).
set -u
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"
SRV='(localdb)\MSSQLLocalDB'
DB="OrqSmoke_$$"
CSC=/c/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe
TD=$(mktemp -d)
WTD=$(cygpath -w "$TD")
fallos=0
ok()   { echo "ok    $1"; }
mal()  { echo "FAIL  $1"; fallos=$((fallos + 1)); }
q()    { sqlcmd -S "$SRV" -d "$DB" -b -h -1 -W -Q "SET NOCOUNT ON; $1"; }
vistas() { q "SELECT COUNT(*) FROM sys.views WHERE schema_id = SCHEMA_ID(N'orq') AND name LIKE N'vw[_]Tablero%'" | tr -d '[:space:]'; }

sqlcmd -S "$SRV" -b -Q "CREATE DATABASE [$DB]" >/dev/null || { echo "no se pudo crear $DB"; exit 1; }
trap 'sqlcmd -S "$SRV" -Q "ALTER DATABASE [$DB] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$DB]" >/dev/null; rm -rf "$TD"' EXIT

# El 77 apunta a Tickets_Proactivanet: aqui, a la base desechable.
sed "s/USE \[Tickets_Proactivanet\];/USE [$DB];/" sql/77_tablero_orquestacion.sql > "$TD/77.sql"

# 1. sin el 76
salida=$(sqlcmd -S "$SRV" -d "$DB" -f 65001 -i "$WTD\\77.sql" 2>&1)
echo "$salida" | grep -q "Falta el 76" && ok "77 sin 76: avisa" || mal "77 sin 76: no aviso"
q "IF SCHEMA_ID(N'orq') IS NULL EXEC (N'CREATE SCHEMA orq')" >/dev/null
[ "$(vistas)" = "0" ] && ok "77 sin 76: no crea vistas" || mal "77 sin 76: creo vistas"
q "DROP SCHEMA orq" >/dev/null

# 2. stub + 77 dos veces
sqlcmd -S "$SRV" -d "$DB" -b -f 65001 -i "$(cygpath -w tools/tests/OrquestacionLocalDb_stub.sql)" >/dev/null || mal "stub"
for vez in 1 2; do
  if sqlcmd -S "$SRV" -d "$DB" -b -f 65001 -i "$WTD\\77.sql" >/dev/null; then ok "77 corrida $vez"; else mal "77 corrida $vez"; fi
  [ "$(vistas)" = "3" ] && ok "77 corrida $vez: tres vistas" || mal "77 corrida $vez: vistas=$(vistas)"
done

# 3. OrquestacionQueries + OrquestacionCalc
cat > "$TD/smoke.exe.config" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<configuration><connectionStrings>
  <add name="TicketsProactivanet" connectionString="Server=$SRV;Database=$DB;Integrated Security=true" />
</connectionStrings></configuration>
EOF
if "$CSC" /nologo /codepage:1252 /nowarn:618 "/out:$WTD\\smoke.exe" /r:System.Web.dll /r:System.Web.Extensions.dll \
     /r:System.Configuration.dll /r:System.Data.dll 'App_Code\*.cs' 'tools\tests\OrquestacionLocalDbSmoke.cs' >/dev/null; then
  "$TD/smoke.exe" "$WTD\\respuesta.json" || fallos=$((fallos + 1))
  node tools/tests/OrquestacionLocalDbSmoke.js "$WTD\\respuesta.json" || fallos=$((fallos + 1))
  [ -n "${1:-}" ] && cp "$TD/respuesta.json" "$1"
else
  mal "no compila el smoke"
fi

echo
[ "$fallos" = 0 ] && echo "TODO PASA" || echo "$fallos paso(s) FALLARON"
exit $([ "$fallos" = 0 ] && echo 0 || echo 1)
