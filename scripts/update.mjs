// Legge i turni dal calendario prove libere di Vallelunga e riscrive data.json.
// Se la lettura fallisce o i dati non hanno la forma attesa, esce con errore e lascia data.json com'è.
import { readFile, writeFile } from 'node:fs/promises';

const ENDPOINT = 'https://motorsport.vallelunga.it/wp-admin/admin-ajax.php';
const SHOP = 'https://motorsport.vallelunga.it/shop/';
const SEDI = { moto: 3, auto: 4 };

const day = 864e5;
const iso = (d) => d.toISOString().slice(0, 10) + 'T00:00:00+01:00';
const start = iso(new Date(Date.now() - 45 * day));
const end = iso(new Date(Date.now() + 425 * day));

async function fetchSede(id) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'TrackDayVL/1.0 (riepilogo non ufficiale dei turni; aggiornamento ogni 15 minuti)',
    },
    body: new URLSearchParams({ action: 'motorsportCalendar', sede_id: String(id), start, end, timeZone: 'local' }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`sede ${id}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error_code !== 0 || !Array.isArray(json.fullDay)) throw new Error(`sede ${id}: risposta inattesa`);
  return json.fullDay;
}

const packs = {};
function row(e) {
  const date = String(e.data || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof e.posti_liberi !== 'number') throw new Error('turno con campi mancanti');
  const label = String(e.htmlTitle || '').split('<br>')[0].replace(/^\d+\s*/, '').trim();
  for (const q of ['2', '3']) {
    const base = e.pacchetti?.['0']?.[q]?.lordo, ins = e.pacchetti?.['1']?.[q]?.lordo;
    if (base > 0) (packs[e.tipo_turno] ??= {})[q] = [Math.round(base * q), Math.round((ins || base) * q)];
  }
  return [date, String(e.codice), String(e.numero_turno), String(e.tipo_turno), label, String(e.ora_inizio), String(e.ora_fine),
    e.prezzo, e.prezzo_assicurato, e.prezzo_ultimo_giorno, e.posti_liberi];
}
const sort = (a, b) => (a[0] + a[2]).localeCompare(b[0] + b[2]);

const out = { updated: new Date().toISOString(), shop: SHOP, packs };
for (const [name, id] of Object.entries(SEDI)) out[name] = (await fetchSede(id)).map(row).sort(sort);

let changed = true;
try {
  const old = JSON.parse(await readFile('data.json', 'utf8'));
  changed = JSON.stringify({ ...old, updated: 0 }) !== JSON.stringify({ ...out, updated: 0 });
} catch {}
await writeFile('data.json', JSON.stringify(out) + '\n');
console.log(`moto: ${out.moto.length} turni, auto: ${out.auto.length} turni, dati ${changed ? 'cambiati' : 'invariati'}`);
if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`, { flag: 'a' });
