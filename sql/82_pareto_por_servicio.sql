/* =====================================================================================
   82_pareto_por_servicio.sql  --  PROPUESTA, PENDIENTE DE APROBACION

   NO SE HA APLICADO EN NINGUNA BASE. Lo corre el dueño en SSMS cuando lo
   apruebe. Rollback: 82_pareto_por_servicio_rollback.sql. Verificacion
   despues de aplicarlo: diag_82_pareto_por_servicio_verificar.sql.

   QUE CAMBIA
   dbo.usp_CorreoServicio_Pareto agrupa hoy por RamaServicio (el prefijo de
   categoria que trajo al ticket: 'S-Punto de Venta', 'S-Logistica'...). Un
   servicio con dos ramas sale como dos barras: PU ('S-Punto de Venta' +
   'S-Aplicativos Punto de Venta') y WMS ('S-FENIX WMS' + 'S-Logistica').
   Con este cambio agrupa por el codigo del servicio,
   dbo.CatServicioCorreo.Servicio, y agrega su descripcion como etiqueta.

   Columnas de salida:
     Posicion             igual (BIGINT; orden CantidadTickets DESC, Servicio ASC)
     Servicio             AHORA el codigo (EQC, PU, WMS...), nvarchar(100);
                          antes el nombre de la rama, nvarchar(400)
     CantidadTickets      igual: COUNT(DISTINCT CodigoTicket) del servicio
     TotalTickets         igual: suma de CantidadTickets de todos los servicios
     Porcentaje           igual
     PorcentajeAcumulado  igual
     NombreServicio       NUEVA, al final: CatServicioCorreo.Descripcion
                          (si viniera vacia, el codigo)

   POR QUE LOS CONTEOS NO CAMBIAN (diag 2, QA, 2026-11-09)
     - D3: ningun prefijo cuelga de otro.
     - D5a / D6: 0 tickets en mas de un servicio y 0 en mas de una rama del
       mismo servicio, slots 0..12.
     - D4: renglones = tickets distintos = suma por rama = suma por servicio
       en los 13 slots. El denominador (TotalTickets) es el mismo.
     - D8: la agrupacion por Servicio da 33 servicios y 11,492 tickets en el
       slot 0, igual que la actual (C2).
     Si algun dia se agregara un prefijo anidado, un ticket podria contar en
     dos servicios: la suma seguiria cerrando en 100 % pero TotalTickets
     seria mayor que los tickets distintos. diag_82_..._verificar.sql lo
     vigila (columna TicketsEnVariosServicios).

   QUE NO CAMBIA
     Parametro @Slot INT = 0, solo lectura (SELECT puro), misma fuente
     dbo.vw_ServicioTickets. Nueva lectura: dbo.CatServicioCorreo (mismo
     esquema y dueño dbo; PROACTIVANETAD ya tiene db_datareader y EXECUTE
     sobre dbo, diag 2 B2/B3: no hace falta GRANT).

   RIESGO
     El procedimiento lo creo otra persona el 2026-11-03. Si algo fuera de la
     base (un script de correo, Power BI) lo consume, desde aqui vera codigos
     en Servicio en vez de nombres de rama, y una columna mas. Confirmar antes
     de aplicar. Desde el 2026-11-09 la pestaña ya NO llama a este
     procedimiento (agrupa por codigo de servicio en la aplicacion, con la
     misma cuenta; la prueba de paridad la compara contra este 82), asi que
     aplicarlo o no ya no afecta al tablero: solo a otros consumidores.
     Busqueda 2026-11-09: en los repositorios (FrontEnd todas las ramas e
     historial, Integracion_SQL, copia local de reenviacorreo/) solo lo usa
     la pestaña. NO se pudo revisar: la carpeta de scripts de correo del
     servidor (AppSettings AdminScriptsDir), Power BI / Excel, jobs y otras
     bases. diag_concentracion_consumidores_identidad.sql cubre lo que SQL
     Server registra (dependencias, jobs, ejecuciones en cache).
   ===================================================================================== */

USE [Tickets_Proactivanet];
GO

CREATE OR ALTER PROCEDURE [dbo].[usp_CorreoServicio_Pareto]

    -- Slot a analizar (dbo.vw_Tickets.Slot: 0 = hoy-29 .. hoy, hora de Mexico)
    -- Por default = 0
    @Slot INT = 0

AS
BEGIN

    SET NOCOUNT ON;


    ;WITH A AS
    (
        -- Un renglon por servicio del catalogo (CatServicioCorreo.Servicio),
        -- juntando todas sus ramas (CatServicioCategoria.PrefijoCategoria).
        SELECT
            Servicio = LTRIM(RTRIM(v.Servicio)),

            CantidadTickets = COUNT(DISTINCT v.CodigoTicket)

        FROM dbo.vw_ServicioTickets AS v

        WHERE v.Slot = @Slot
          AND NULLIF(LTRIM(RTRIM(v.Servicio)), N'') IS NOT NULL

        GROUP BY
            LTRIM(RTRIM(v.Servicio))
    ),

    P AS
    (
        SELECT
            Servicio,
            CantidadTickets,

            TotalTickets =
                SUM(CantidadTickets) OVER (),

            Posicion =
                ROW_NUMBER() OVER
                (
                    ORDER BY
                        CantidadTickets DESC,
                        Servicio ASC
                ),

            Porcentaje =
                CAST
                (
                    100.0 * CantidadTickets
                    / NULLIF(
                        SUM(CantidadTickets) OVER (),
                        0
                    )
                    AS DECIMAL(6,2)
                ),

            PorcentajeAcumulado =
                CAST
                (
                    100.0 *
                    SUM(CantidadTickets) OVER
                    (
                        ORDER BY
                            CantidadTickets DESC,
                            Servicio ASC
                        ROWS BETWEEN
                            UNBOUNDED PRECEDING
                            AND CURRENT ROW
                    )
                    /
                    NULLIF(
                        SUM(CantidadTickets) OVER (),
                        0
                    )
                    AS DECIMAL(6,2)
                )

        FROM A
    )

    SELECT
        P.Posicion,
        P.Servicio,
        P.CantidadTickets,
        P.TotalTickets,
        P.Porcentaje,
        P.PorcentajeAcumulado,
        NombreServicio = ISNULL(NULLIF(LTRIM(RTRIM(s.Descripcion)), N''), P.Servicio)

    FROM P
    LEFT JOIN dbo.CatServicioCorreo AS s
           ON s.Servicio = P.Servicio

    ORDER BY P.Posicion;

END;
GO
