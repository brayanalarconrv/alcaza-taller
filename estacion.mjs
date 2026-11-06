// Robot de la Estación de taller de Grupo Alcaza.
// Abre grupoalcaza.com/estudio en un Chrome sin pantalla, deja que el taller haga los mockups pendientes y se apaga.
// Uso: node estacion.mjs revisar   → solo dice si hay trabajo (para no gastar minutos)
//      node estacion.mjs           → trabaja hasta vaciar la fila (máx. ~50 min)
import fs from 'node:fs';
const FN = 'https://jshhnomcofkmqjgwpppj.supabase.co/functions/v1/ml-agente';
const CLAVE = (process.env.TALLER_CLAVE || '').trim();
const NOMBRE = 'Robot del taller';
const LIMITE_MIN = Number(process.env.LIMITE_MIN || 50);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(accion, datos = {}) {
  const r = await fetch(FN + '?estudio=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion, clave: CLAVE, nombre: NOMBRE, ...datos }) });
  const j = await r.json().catch(() => null);
  if (!j || j.ok === false) throw new Error(j?.mensaje || 'Sin respuesta del servidor (' + r.status + ')');
  return j;
}
const hayTrabajo = (e) => e.pendientes > 0 || (e.imagenes > 0 && e.trabajando === 0);

if (!CLAVE) { console.error('Falta el secreto TALLER_CLAVE (la clave del Estudio) en Settings → Secrets → Actions.'); process.exit(1); }
const e0 = await api('taller_estado');
console.log('Fila del taller:', JSON.stringify(e0));

if (process.argv[2] === 'revisar') {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `hay=${hayTrabajo(e0) ? 1 : 0}\n`);
  process.exit(0);
}

const { chromium } = await import('playwright-core');
const ruta = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const navegador = await chromium.launch({ executablePath: ruta, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pagina = await navegador.newPage({ viewport: { width: 1280, height: 900 } });
await pagina.addInitScript(([clave, nombre]) => {
  localStorage.setItem('estudio.clave', clave); localStorage.setItem('estudio.nombre', nombre); localStorage.setItem('estudio.taller', '1');
}, [CLAVE, NOMBRE]);
pagina.on('pageerror', (err) => console.log('Error en la página:', err.message));
await pagina.goto('https://grupoalcaza.com/estudio/#taller', { waitUntil: 'networkidle' });

const t0 = Date.now(); let quietas = 0, ultimo = '';
while (Date.now() - t0 < LIMITE_MIN * 60e3) {
  await espera(30000);
  const texto = await pagina.evaluate(() => document.querySelector('.taller')?.innerText || '').catch(() => '');
  const fotos = (texto.match(/(\d+) fotos/) || [])[1] || '0';
  const linea = texto.split('\n').find((l) => /Trabajando en|Esperando trabajos|apagado/.test(l)) || '';
  if (linea + fotos !== ultimo) { console.log(new Date().toISOString().slice(11, 19), fotos, 'fotos ·', linea); ultimo = linea + fotos; }
  const e = await api('taller_estado').catch(() => null);
  quietas = /Esperando trabajos/.test(texto) && e && e.pendientes === 0 ? quietas + 1 : 0;
  if (quietas >= 2) break;
}
console.log('Listo:', Math.round((Date.now() - t0) / 60e3), 'min.');
await navegador.close();
