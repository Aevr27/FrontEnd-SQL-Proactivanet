/* =====================================================================================
   Servicio "Conciliaciones" (conciliaciones) para la pestaña "Análisis de servicios"

   Generado con node analisis_servicio/armar_scripts.js desde analisis_servicio/servicios.js.
   2 criterio(s), 19 regla(s), 178 frase(s).

   Reemplaza los criterios y las reglas de ESTE servicio y sube su ReglasVersion;
   no toca los demas servicios. Todo o nada: si algo falla, no cambia nada.
   Necesita 47_analisis_servicios.sql (del 2026-10-21 o despues). Lleva acentos en
   los textos: abrirlo como archivo en SSMS (trae BOM) o pegarlo tal cual en una
   consulta nueva.
   ===================================================================================== */

USE [Tickets_Proactivanet];
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET NOEXEC OFF;
IF OBJECT_ID('dbo.AnalisisRegla') IS NULL OR COL_LENGTH('dbo.AnalisisServicio', 'Secciones') IS NULL
BEGIN
    RAISERROR(N'Falta correr 47_analisis_servicios.sql: no existen las tablas o es de antes del 2026-10-21 (sin la columna Secciones).', 16, 1);
    SET NOEXEC ON;
END;
GO

BEGIN TRANSACTION;

MERGE dbo.AnalisisServicio AS d
USING (SELECT Servicio = 'conciliaciones',
              Nombre = N'Conciliaciones',
              Descripcion = N'Ruta /Conciliaciones/ (Conciliación Bancaria y Servicios Tienda). El cierre de la conciliación bancaria y de Caja General, y las diferencias que se mandan a Control de Ingresos. En "Servicios Tienda (aplicación)" las tiendas capturan también tickets de otras aplicaciones.',
              DesdeSugerido = CONVERT(DATE, '2026-04-01', 23),
              MotivosEquipo = N'[]',
              Secciones = CONVERT(NVARCHAR(MAX), NULL)) AS o
ON d.Servicio = o.Servicio
WHEN MATCHED THEN UPDATE SET Nombre = o.Nombre, Descripcion = o.Descripcion, DesdeSugerido = o.DesdeSugerido,
    MotivosEquipo = o.MotivosEquipo, Secciones = o.Secciones, ReglasVersion = d.ReglasVersion + 1, Activo = 1,
    FechaUltimaCargaDW = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (Servicio, Nombre, Descripcion, DesdeSugerido, MotivosEquipo, Secciones)
    VALUES (o.Servicio, o.Nombre, o.Descripcion, o.DesdeSugerido, o.MotivosEquipo, o.Secciones);

DELETE FROM dbo.AnalisisServicioCriterio WHERE Servicio = 'conciliaciones';
INSERT INTO dbo.AnalisisServicioCriterio (Servicio, Orden, Clave, Valor) VALUES
    ('conciliaciones', 1, 'Ruta', N'/Conciliaciones/%'),
    ('conciliaciones', 2, 'Titulo', N'%concilia%');

DELETE FROM dbo.AnalisisRegla WHERE Servicio = 'conciliaciones';
INSERT INTO dbo.AnalisisRegla (Servicio, Orden, Regla, Motivo, Campo, Frases) VALUES
    ('conciliaciones', 1, 'R01', N'Cerrado sin respuesta de la tienda', 'S',
        N'["no hemos podido contactar","no logramos contactar","no recibir seguimiento","intentado contactar","intento contactar","sin respuesta","no se obtuvo respuesta"]'),
    ('conciliaciones', 2, 'R02', N'Duplicado', 'S',
        N'["duplicado","ya se atiende en","ya fue atendido","se repite"]'),
    ('conciliaciones', 3, 'R03', N'Falla general del cierre: se corrigió para todas las tiendas', 'S',
        N'["corrigio el tema","derivada de un error","ya fue resuelto","falla general","falla masiva"]'),
    ('conciliaciones', 4, 'R04', N'Diferencia en el cierre: se pidió escribir a Control de Ingresos', 'S',
        N'["control de ingresos"]'),
    ('conciliaciones', 5, 'R05', N'No es de Conciliaciones: se mandó a otra área o a Soria', 'S',
        N'["ponerse en contacto","contactar a los siguientes","proporcionamos el contacto","mediante soria","por medio de soria","control de tarjetas","programa de lealtad","categoria correspondiente"]'),
    ('conciliaciones', 6, 'R06', N'Servidor bancario (eHUB): pagos que no se agregan o no cierra', 'D',
        N'["servidor bancario","ehub","e hub","credimax","servidor de bancos"]'),
    ('conciliaciones', 7, 'R07', N'Cargos bancarios o cargos manuales', 'D',
        N'["cargos bancarios","cargo bancario","cargos manuales","cargo manual"]'),
    ('conciliaciones', 8, 'R08', N'Pago de servicios', 'D',
        N'["pago de servicios","pagos de servicios","pago de servicio","pagodeservicio"]'),
    ('conciliaciones', 9, 'R09', N'Las ventas no cuadran (Power BI u otro reporte)', 'D',
        N'["power bi","powerbi"," pbi ","diferencia en ventas","diferencia en la venta"]'),
    ('conciliaciones', 10, 'R10', N'Diferencia en póliza', 'D',
        N'["diferencia en poliza","diferencia de poliza","diferencia en la poliza","poliza"]'),
    ('conciliaciones', 11, 'R11', N'Usuario o acceso (alta, baja, usuario no reconocido, contraseña)', 'D',
        N'["usuario no reconocido","no reconocido por el sistema","otorgar permiso","dar permiso","darle permiso","permiso en la aplicacion","usuario nuevo","alta y baja","baja y alta","contrasena","password","asignar usuario","ususario","privilegios"]'),
    ('conciliaciones', 12, 'R12', N'Cierre del Back Office bloqueado (cajero activo, retiros o transacción pendiente)', 'D',
        N'["cajero activo","cajeros dados de alta","retiros pendientes","retiro pendiente","transaccion suspendida","transacciones suspendidas","cuenta suspendida","suspendida","cierre de backoffice","cierre de back office","cierre del back office","cierre del backoffice","cierre en backoffice","cierre back office","cierre de backoficce","cierre de banckoficce"]'),
    ('conciliaciones', 13, 'R13', N'Es de otro servicio (punto de venta, devoluciones, Evolución, tarjetas, lealtad...)', 'D',
        N'["frogmi"," osa ","modo autonomo","app de entrega","aplicacion de entregas","consulta tienda","verifone","baja forzada","nota de credito","notas de credito"," evolucion "]'),
    ('conciliaciones', 14, 'R14', N'No deja cerrar: diferencia en la conciliación (tarjetas o bancos)', 'D',
        N'["diferencia en conciliacion","diferencia en la conciliacion","diferencia en las conciliaciones","diferencia en ls conciliaciones","diferencia en conciliaciones","diferencia en tarjeta","diferencia en la tarjeta","marca diferencia","marca una diferencia","arroja una diferencia","arroja diferencia","diferencia al cierre","diferencia en cierre","diferencia en el cierre","por diferencia","hay diferencia","existe una diferencia","diferencia por","desvio de conciliacion","desvio en conciliacion","desviacion en conciliacion"]'),
    ('conciliaciones', 15, 'R15', N'Transferencias, pagos electrónicos o depósitos que no se reflejan', 'D',
        N'["transferencia","pagos electronicos","pago electronico","referencia no fue localizada","ficha","deposito","saldo","city credit","abono"]'),
    ('conciliaciones', 16, 'R16', N'No deja cerrar: error o falla del sistema', 'D',
        N'["cierre","cerrar","cirre","ierre","conciliacion","conciliancion","diferencia"]'),
    ('conciliaciones', 17, 'R17', N'Es de otro servicio (punto de venta, devoluciones, Evolución, tarjetas, lealtad...)', 'D',
        N'["punto de venta","precio","codigo","devolucion","nota de credito","notas de credito","promocion"," evolucion ","modo autonomo","verifone","terminal","baja forzada","parametro","consulta tienda","inventario","pedido","remate"," vales ","sonido","uber","energeticos","ordenes de pago","tarjeta","lealtad","puntos"," osa ","frogmi","merma","horario","caja chica"," app ","uuid","produccion","suspendida","cancelacion del retiro"]'),
    ('conciliaciones', 18, 'R18', N'Usuario o acceso (alta, baja, usuario no reconocido, contraseña)', 'D',
        N'["usuario","contrasena","password","bloquead","alta","acceso","ingresar","login","permisos","supervisor","numero de empleado"]'),
    ('conciliaciones', 19, 'R19', N'Red, equipo o la aplicación no abre', 'D',
        N'[" red ","internet","conexion","no abre","abrir la aplicacion","abrir el aplicativo","servidor"]');

COMMIT;
GO
SET NOEXEC OFF;
GO

SELECT s.Servicio, s.Nombre, s.ReglasVersion,
       Criterios = (SELECT COUNT(*) FROM dbo.AnalisisServicioCriterio AS c WHERE c.Servicio = s.Servicio),
       Reglas    = (SELECT COUNT(*) FROM dbo.AnalisisRegla AS r WHERE r.Servicio = s.Servicio)
FROM dbo.AnalisisServicio AS s
WHERE s.Servicio = 'conciliaciones';
GO
