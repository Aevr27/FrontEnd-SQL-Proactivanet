/* =========================================================================
   sql/baseline_83_export.sql - BASELINE de las asociaciones dadas de baja
   (dbo.ProblemCategoria con VigenteEnOrigen = 0), JUSTO ANTES de aplicar
   sql/83. SOLO LECTURA de la base: @b es una variable de tabla que solo
   existe mientras corre este script; no crea ni cambia nada en la base.

   COMO CORRERLO: en SSMS con "Results to File" (o sqlcmd -o), de
   preferencia cuando no corre la carga del Excel. Guardar LOS DOS
   resultados juntos, FUERA del repositorio, con la evidencia de la
   migracion (tienen codigos de iniciativa y rutas de categoria).

   QUE SALE
     1. Cabecera: TomadaUtc, Base, Servidor, Filas y HuellaSha256.
     2. Una linea por par (Codigo, Categoria), en hexadecimal (UTF-16):
        "(0x..., 0x...),". En hexadecimal el archivo no puede danar ningun
        caracter (acentos, NBSP, espacios al final).

   HUELLA (la MISMA expresion que sql/diag_83_reactivacion.sql)
     Cada par se serializa como
       <largo de Codigo>:<Codigo>|<largo de Categoria>:<Categoria>;
     (largo en unidades UTF-16 = DATALENGTH / 2: sin ambiguedad aunque el
     texto tenga ':', '|' o ';'), en orden Latin1_General_BIN2 (por punto de
     codigo, determinista), todo concatenado y SHA2_256 sobre nvarchar(max).
   ========================================================================= */
SET NOCOUNT ON;
DECLARE @TomadaUtc datetime2(7) = SYSUTCDATETIME();   -- cota inferior para atribuir
DECLARE @b TABLE
(
    Codigo    nvarchar(100) COLLATE DATABASE_DEFAULT NOT NULL,
    Categoria nvarchar(450) COLLATE DATABASE_DEFAULT NOT NULL
);
INSERT @b (Codigo, Categoria)
SELECT pc.Codigo, pc.Categoria
FROM dbo.ProblemCategoria AS pc
WHERE pc.VigenteEnOrigen = 0;

DECLARE @Filas int = (SELECT COUNT(*) FROM @b);
DECLARE @Canon nvarchar(max) =
    (SELECT STRING_AGG(CONVERT(nvarchar(max),
                CONCAT(DATALENGTH(b.Codigo) / 2, N':', b.Codigo, N'|',
                       DATALENGTH(b.Categoria) / 2, N':', b.Categoria, N';')), N'')
            WITHIN GROUP (ORDER BY b.Codigo COLLATE Latin1_General_BIN2, b.Categoria COLLATE Latin1_General_BIN2)
     FROM @b AS b);
DECLARE @Huella varbinary(32) = HASHBYTES('SHA2_256', ISNULL(@Canon, N''));

-- Resultado 1: cabecera (sus tres valores van al diagnostico)
SELECT Cabecera     = 'BASELINE 83',
       TomadaUtc    = CONVERT(varchar(33), @TomadaUtc, 126),
       Base         = DB_NAME(),
       Servidor     = @@SERVERNAME,
       Filas        = @Filas,
       HuellaSha256 = CONVERT(varchar(66), @Huella, 1);

-- Resultado 2: una linea por par, lista para pegar
SELECT Linea = '(' + CONVERT(varchar(max), CONVERT(varbinary(max), b.Codigo), 1) + ', '
                   + CONVERT(varchar(max), CONVERT(varbinary(max), b.Categoria), 1) + '),'
FROM @b AS b
ORDER BY b.Codigo COLLATE Latin1_General_BIN2, b.Categoria COLLATE Latin1_General_BIN2;
