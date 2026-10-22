/* =====================================================================================
   Servicio "S-Abasto" (abasto) para la pestaña "Análisis de servicios"

   Generado con node analisis_servicio/armar_scripts.js desde analisis_servicio/servicios.js.
   3 criterio(s), 27 regla(s), 229 frase(s).

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
USING (SELECT Servicio = 'abasto',
              Nombre = N'S-Abasto',
              Descripcion = N'Ruta /S-Abasto/ (SAP y F&R). Casi todo son solicitudes de los compradores (ampliar pedidos, liberar presupuesto, estrategias de liberación, retiro del bit de entrega final, cancelar STO) que Soporte AMS Inetum resuelve con una plantilla. Casi nadie lo reporta desde una tienda: no se mide por sitio.',
              DesdeSugerido = CONVERT(DATE, '2026-04-01', 23),
              MotivosEquipo = N'[]',
              Secciones = CONVERT(NVARCHAR(MAX), NULL)) AS o
ON d.Servicio = o.Servicio
WHEN MATCHED THEN UPDATE SET Nombre = o.Nombre, Descripcion = o.Descripcion, DesdeSugerido = o.DesdeSugerido,
    MotivosEquipo = o.MotivosEquipo, Secciones = o.Secciones, ReglasVersion = d.ReglasVersion + 1, Activo = 1,
    FechaUltimaCargaDW = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (Servicio, Nombre, Descripcion, DesdeSugerido, MotivosEquipo, Secciones)
    VALUES (o.Servicio, o.Nombre, o.Descripcion, o.DesdeSugerido, o.MotivosEquipo, o.Secciones);

DELETE FROM dbo.AnalisisServicioCriterio WHERE Servicio = 'abasto';
INSERT INTO dbo.AnalisisServicioCriterio (Servicio, Orden, Clave, Valor) VALUES
    ('abasto', 1, 'Ruta', N'/S-Abasto/%'),
    ('abasto', 2, 'Titulo', N'%abasto%'),
    ('abasto', 3, 'Titulo', N'%f&r%');

DELETE FROM dbo.AnalisisRegla WHERE Servicio = 'abasto';
INSERT INTO dbo.AnalisisRegla (Servicio, Orden, Regla, Motivo, Campo, Frases) VALUES
    ('abasto', 1, 'R01', N'Cerrado sin respuesta del usuario', 'S',
        N'["intentamos localizarlo","no se recibio respuesta","no hemos podido contactar","sin tener exito","no recibir seguimiento"]'),
    ('abasto', 2, 'R02', N'Duplicado', 'S',
        N'["ticket se repite","se repite con el ticket","duplicado","ya se atiende en"]'),
    ('abasto', 3, 'R03', N'Control presupuestal de CEDIS: no generó pedido o lo partió en dos', 'D',
        N'["consolidado presupuestal","control presupuestal","nopartecp","presupuesto asignado"]'),
    ('abasto', 4, 'R04', N'Liberar o descomprometer presupuesto', 'D',
        N'["liberacion de presupuesto","liberacion del presupuesto","liberar el ppto","liberar el presupuesto","liberar presupuesto","liberar prepuesto","descomprom","despresupuest","des presupuest","ppto comprometido","presupuesto comprometido","comprometiendo doble","presupuesto","ppto"]'),
    ('abasto', 5, 'R05', N'Estrategias de liberación o liberadores (alta, cambio o baja de usuarios)', 'D',
        N'["estrategia","liberador","grupo de liberacion","autorizador","flujo de autoriz","crear materiales","creacion de materiales","aprobacion de pedidos","permisos para liberar","grupo de compras","en liberacion de sap","liberacion de pedidos","liberacion gr","permisos para la liberacion"]'),
    ('abasto', 6, 'R06', N'Acceso o permiso a una transacción de SAP', 'D',
        N'["acceso a la transaccion","no se cuenta con autorizacion","no cuenta con autorizacion","asignacion de la transaccion","permisos correspondientes","transaccion bloqueada","autorizacion para"]'),
    ('abasto', 7, 'R07', N'Retiro del bit de entrega final', 'D',
        N'["bit de entrega","bot de entrega","retiro del bit","retiro de bit","quitarle el bot","quitar el bit","entrega final"]'),
    ('abasto', 8, 'R08', N'Cancelar o eliminar STO o pedidos', 'D',
        N'["cancelar las sto","cancelacion de las sto","cancelando las siguientes sto","cancelar la siguientes sto","cancelar las siguientes","cancelacion de esta oc","cancelar pedido","cancelacion del pedido","cancelacion de pedido","cancelacion de los","cancela ped","stos manuales","sto manuales","cancelar oc","cancelar la oc","cancelar esta","eliminar la","eliminar las","elimiar","anular","anulacion","cancelacion","cancelar","borrado de las"]'),
    ('abasto', 9, 'R09', N'Ampliación de pedidos: SAP marca error (tabla de bloqueo o rechazo)', 'D',
        N'["tabla de bloqueo","marco rechazo","marca rechazo","rechazo en sap"]'),
    ('abasto', 10, 'R10', N'Ampliación: se pidió mandarla por correo, no por ticket', 'S',
        N'["canalizar la solicitud"]'),
    ('abasto', 11, 'R11', N'Ampliación de vigencia o fecha de entrega de pedidos', 'D',
        N'["ampliacion","ampliar","amplac","amplai","ampliacio","fecha de entrega","extender estos pedidos","extender los pedidos"]'),
    ('abasto', 12, 'R12', N'Pedidos de importación que no migran a Infor Nexus (DHL)', 'D',
        N'["infornexus","infor nexus"," inx ","nexus"]'),
    ('abasto', 13, 'R13', N'Unificar proveedor en OREF o una orden por formato', 'D',
        N'["oref","unificar","homologar los pedidos","una orden de compra por"]'),
    ('abasto', 14, 'R14', N'F&R: línea de transporte o CEDIS equivocado (FRE07)', 'D',
        N'["linea de transporte","free 07","fre 07","fre07","free07","cedis diferente","generaron a cedis","cedis incorrecto","trasporte","cedis distinto"]'),
    ('abasto', 15, 'R15', N'F&R: la combinación no generó propuesta, pedido o necesidad', 'D',
        N'["no generaron propuesta","no generaron pedido","no genero pedido","no generan pedido","no le genera pedido","no se le estan generando","propuesta de resurtido","propuestas de pedido","no genero propuesta","necesidad","fre01","generando propuesta","resurtido"]'),
    ('abasto', 16, 'R16', N'F&R: datos de la combinación distintos a SAP (stock, ciclo, pronóstico, proveedor)', 'D',
        N'["stock","inventario","ciclo de aprovisionamiento","ciclo de planificacion","catorcenal","calendario","fuera de rol","unidad de medida"," ump ","cajas por combinacion","empaque","pronostico","forecast","proveedor anterior","suministro","fre cade","frecade"," apagar "," cpn ","encender"," z0 "]'),
    ('abasto', 17, 'R17', N'Alta de fracción arancelaria o puerto', 'D',
        N'["fraccion","alta de puerto","puerto"]'),
    ('abasto', 18, 'R18', N'Tablas de asignación o TXT de carga (borrar combinaciones)', 'D',
        N'["fnr apertura","tabla de asignacion"," txt ","combinaciones ya existen","borrando la carga","carga de pedidos"]'),
    ('abasto', 19, 'R19', N'Configuración contable o bancaria (segmentos, cuentas, extractos)', 'D',
        N'["segmento","extracto","cuenta bancaria","cuentas bancarias","compensa","cuenta contable","clave de banco","centros de costo","cebe","tolerancia","clase de activos","rangos de numeros","cuenta por cobrar","clave bancaria"]'),
    ('abasto', 20, 'R20', N'Replicar o reenviar información entre sistemas (BD10, IDoc)', 'D',
        N'["bd10","idoc","replica","reenvi"]'),
    ('abasto', 21, 'R21', N'Modificar datos de pedidos (proveedor, almacén, plazo, bloqueo)', 'D',
        N'["cambio de plazo","cambio de proveedor","cambio del almacen","memasspo","en lugar de","bloqueado a la compra","desbloque"]'),
    ('abasto', 22, 'R22', N'Factura, pago o pasivo del pedido', 'D',
        N'["desligar factura"," re l ","pasivo","fecha de pago","plazo de pago","tipo de factur","factura","pago manual","bloquear el pedido","bloqueo del pedido"]'),
    ('abasto', 23, 'R23', N'Costo o precio del pedido incorrecto', 'D',
        N'["costo","precio","registro info","reginfo"]'),
    ('abasto', 24, 'R24', N'Configuración en SAP (clase de pedido, categoría de valoración, tablas)', 'D',
        N'["clase de documento","clase de pedido","categoria de valoracion","catval","tabla","categorias de valoracion","valorizacion","exclusion"]'),
    ('abasto', 25, 'R25', N'Revisar el estatus de un pedido (MIGO, EDI, envío)', 'D',
        N'["migo"," edi ","empuje","revisar los pedidos","revisar el pedido","validacion de este pedido","validar este pedido","el siguiente pedido","los siguientes pedidos","reporte","como el sistema considera","analisis de este pedido"]'),
    ('abasto', 26, 'R26', N'Error al crear, guardar o cerrar una orden de compra', 'D',
        N'["marca error","marco error","error en sap","error al","me arroja","aparece el siguiente","mensaje de error","no me permite","no permite","error"]'),
    ('abasto', 27, 'R27', N'No procede o se pidió a otra área (Datos Maestros, Finanzas, Abasto)', 'S',
        N'["no procede","datos maestros","administracion y finanzas","no tenemos alcance","comunicarse con el area","control de accesos","acercarse con"]');

COMMIT;
GO
SET NOEXEC OFF;
GO

SELECT s.Servicio, s.Nombre, s.ReglasVersion,
       Criterios = (SELECT COUNT(*) FROM dbo.AnalisisServicioCriterio AS c WHERE c.Servicio = s.Servicio),
       Reglas    = (SELECT COUNT(*) FROM dbo.AnalisisRegla AS r WHERE r.Servicio = s.Servicio)
FROM dbo.AnalisisServicio AS s
WHERE s.Servicio = 'abasto';
GO
