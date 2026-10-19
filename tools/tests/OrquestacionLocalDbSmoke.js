// Pasa la respuesta REAL de OrquestacionQueries (sobre el stub de LocalDB,
// OrquestacionLocalDb_stub.sql) por OrquestacionCalc y compara con lo que da
// el stub contado a mano. Lo corre tools/tests/OrquestacionLocalDb.sh:
//   node tools/tests/OrquestacionLocalDbSmoke.js <respuesta.json>
var fs = require('fs');
var path = require('path');
var Calc = require(path.join(__dirname, '..', '..', 'orquestacion', 'orquestacion.js'));

var fallos = 0;
function Check(nombre, esperado, obtenido) {
  var ok = JSON.stringify(esperado) === JSON.stringify(obtenido);
  if (!ok) fallos++;
  console.log((ok ? 'ok    ' : 'FAIL  ') + nombre + '  esperado=' + JSON.stringify(esperado) + '  obtenido=' + JSON.stringify(obtenido));
}

var R = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^﻿/, ''));
var r = R.r;
var jobs = Calc.tabla(r.jobs), decs = Calc.tabla(r.decomisos);

var i = Calc.indicadores(jobs, decs, r.parametros, false);
Check('universo', 5, i.universo);
Check('huerfanos', 1, i.huerfanos);
Check('activos', 3, i.activos);
Check('completamente orquestados', 1, i.orquestados);
Check('candidatos (Si)', 2, i.candidatos);
Check('migrados con exito', 1, i.migrados_exito);
Check('decomisos / exitosos', [2, 1], [i.decomisos, i.decomisos_exitosos]);
Check('ejecuciones calculadas (activos)', 15, i.ejec_calculada);
Check('ejecuciones capturadas (parametro de texto)', 17, i.ejec_capturada);
Check('pendientes por migrar', 5, i.pend_migrar);
Check('esquema hibrido JOB / Tarea', [1, 2], [i.n_job, i.n_tarea]);
Check('costo hibrido', 1200.5, i.costo_hibrido);
Check('ejecuciones futuras (17 + 5), numero y no texto', 22, i.ejec_futuras);
Check('costo futuro', 2200, i.costo_futuro);
Check('completos (14 documentados)', 0, i.completos);

var f = { dir: 'Dir Uno', n3: '', herr: '', cand: [] };
var js = Calc.filtrar(jobs, f);
var fi = Calc.indicadores(js, Calc.decomisosDe(decs, js, f), r.parametros, true);
Check('filtro Dir Uno: jobs', 2, fi.universo);
Check('filtro Dir Uno: decomisos (el de JOB_C es de Dir Dos)', 0, fi.decomisos);
Check('filtro: lo capturado del total no se reparte', null, fi.ejec_capturada);

var dir = Calc.porDireccion(jobs);
Check('Direccion -> N3: tres direcciones', 3, dir.direcciones.length);
var campos = Calc.porCampo(jobs, r.campos);
Check('completitud: 14 campos', 14, campos.length);
Check('Horario: con dato 1 (relleno), documentados 0', [1, 0], [campos[2].con_dato, campos[2].documentados]);

console.log('');
console.log(fallos ? fallos + ' caso(s) FALLARON' : 'TODO PASA');
process.exit(fallos ? 1 : 0);
