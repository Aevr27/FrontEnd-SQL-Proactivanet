// tools/tests/PaletaLideresSmoke.js - prueba de humo de la IDENTIDAD DE LIDER.
//
// NO forma parte del sitio: vive fuera de assets/, asi que ni IIS ni el
// navegador lo cargan nunca. Fija las reglas de la tabla compartida de
// assets/js/paleta.js, que es lo que hace que una persona lleve el mismo
// color en el Backlog y en Experiencia:
//
//   - el color sale del NOMBRE, del mapa fijo COLOR_LIDER_FIJO -los colores
//     historicos-, no del orden en que llegan los datos ni del ranking,
//   - el orden en que se LISTAN es A->Z y `Sin Torre` va SIEMPRE al final,
//     lo cual NO tiene nada que ver con que color lleva cada quien,
//   - los cubos sin dato -"(Sin director)", "(Sin PO)", "Otros"- no son
//     lideres: van de NEUTRO y no se llevan el color de una persona.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\PaletaLideresSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
//
'use strict';
var fs = require('fs');
var path = require('path');

function cargarPaleta() {
  var ventana = {};
  var codigo = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'js', 'paleta.js'), 'utf8');
  (new Function('window', codigo))(ventana);
  return ventana.Paleta;
}

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = String(esperado), o = String(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + '  esperado=' + e + '  obtenido=' + o);
}

var LIDERES = ['Adriana Lozano', 'Bendrix Zuir', 'Carlos Garcia', 'Jesus Campa',
               'Laura Cardenas', 'Sergio Gonzalez', 'Sin Torre'];

// 1. Orden canonico: alfabetico, con Sin Torre al final aunque llegue primero
//    y aunque alfabeticamente fuera entre Sergio y otra S.
var P = cargarPaleta();
Check('orden canonico A->Z con Sin Torre al final',
  LIDERES.join('|'),
  P.registrarLideres(['Sin Torre', 'Laura Cardenas', 'Sergio Gonzalez', 'Jesus Campa',
                      'Carlos Garcia', 'Bendrix Zuir', 'Adriana Lozano']).join('|'));

// 2. El color de una persona NO depende del orden en que se dieron de alta:
//    otra pagina que registre el mismo roster al reves reparte igual.
var Q = cargarPaleta();
Q.registrarLideres(LIDERES.slice().reverse());
Check('mismo roster, mismo reparto aunque cambie el orden de alta',
  LIDERES.map(P.colorLider).join('|'),
  LIDERES.map(Q.colorLider).join('|'));

// 3. Los colores historicos, congelados por nombre: Laura azul, Campa rojo,
//    Adriana verde, y asi. Salen de la paleta compartida, no de hex sueltos.
var HISTORICOS = {
  'Laura Cardenas':  P.PALETA_CATEGORICA[0],
  'Jesus Campa':     P.PALETA_CATEGORICA[1],
  'Adriana Lozano':  P.PALETA_CATEGORICA[2],
  'Bendrix Zuir':    P.PALETA_CATEGORICA[3],
  'Carlos Garcia':   P.PALETA_CATEGORICA[4],
  'Sergio Gonzalez': P.PALETA_CATEGORICA[5],
  'Sin Torre':       P.PALETA_CATEGORICA[6]
};
LIDERES.forEach(function (n) {
  Check('color historico de ' + n, HISTORICOS[n], P.colorLider(n));
});

// 3bis. El sitio en la leyenda -A->Z- NO es el color: Adriana abre la lista
//       y lleva el verde, no el azul de la posicion 1.
Check('el primero de la leyenda no se lleva el primer color de la paleta',
  'true', P.registrarLideres([])[0] === 'Adriana Lozano' && P.colorLider('Adriana Lozano') !== P.PALETA_CATEGORICA[0]);

// 3ter. El color no depende de que la persona se haya dado de alta en esta
//       vista: Experiencia puede pintar a un director que el Backlog no trajo.
Check('el mapa fijo responde sin registrar', HISTORICOS['Laura Cardenas'], cargarPaleta().colorLider('Laura Cardenas'));

// 4. Una grafica ordenada por volumen -mayor a menor- no recolorea a nadie:
//    Laura sigue siendo Laura este donde este.
var porVolumen = ['Sergio Gonzalez', 'Laura Cardenas', 'Adriana Lozano'];
Check('el ranking por volumen no cambia el color',
  ['Laura Cardenas'].map(P.colorLider).join(''),
  porVolumen.map(P.colorLider)[porVolumen.indexOf('Laura Cardenas')]);

// 5. Cubos sin dato: NEUTRO, nunca el color de una persona.
['(Sin director)', '(Sin PO)', '(Sin dato)', 'Otros', '', null].forEach(function (cubo) {
  Check('cubo sin dato de NEUTRO: ' + JSON.stringify(cubo), P.NEUTRO, P.colorLider(cubo));
});
Check('un cubo sin dato no entra al orden canonico',
  LIDERES.join('|'),
  P.ordenarLideres(LIDERES.concat(['(Sin PO)', 'Otros'])).join('|'));

// 6. `Sin Torre` SI es una categoria conocida: conserva su color, no es NEUTRO.
Check('Sin Torre lleva color propio, no NEUTRO', 'true', P.colorLider('Sin Torre') !== P.NEUTRO);

// 7. La misma persona escrita con acentos o en mayusculas es UN lider.
Check('acentos y caja no parten a una persona en dos',
  P.colorLider('Jesus Campa'), P.colorLider('JESÚS  CAMPA'));

// 8. Dar de alta a alguien que ya estaba no mueve el reparto.
var antes = LIDERES.map(P.colorLider).join('|');
P.registrarLideres(['Laura Cardenas', 'Sin Torre']);
Check('re-registrar un lider conocido no recolorea', antes, LIDERES.map(P.colorLider).join('|'));

console.log(fallos ? ('FALLOS: ' + fallos) : 'TODO PASA');
process.exit(fallos ? 1 : 0);
