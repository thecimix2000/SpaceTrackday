// Trackday VL – legge i turni dal calendario prove libere di Vallelunga quando qualcuno apre il sito.
// Tiene la lettura per 5 minuti; se Vallelunga non risponde, restituisce l'ultima lettura buona (fino a 7 giorni).

const ENDPOINT = 'https://motorsport.vallelunga.it/wp-admin/admin-ajax.php';
const SHOP = 'https://motorsport.vallelunga.it/shop/';
const SEDI = { moto: 3, auto: 4 };
const FRESH_SECONDS = 300;
const BACKUP_SECONDS = 7 * 24 * 3600;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function iso(d) { return d.toISOString().slice(0, 10) + 'T00:00:00+01:00'; }

async function fetchSede(id) {
  const day = 864e5;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'TrackdayVL/1.0 (riepilogo non ufficiale dei turni)',
    },
    body: new URLSearchParams({
      action: 'motorsportCalendar', sede_id: String(id),
      start: iso(new Date(Date.now() - 45 * day)), end: iso(new Date(Date.now() + 425 * day)), timeZone: 'local',
    }),
  });
  if (!res.ok) throw new Error('sede ' + id + ': HTTP ' + res.status);
  const json = await res.json();
  if (json.error_code !== 0 || !Array.isArray(json.fullDay)) throw new Error('sede ' + id + ': risposta inattesa');
  return json.fullDay;
}

async function readVallelunga() {
  const packs = {};
  const row = (e) => {
    const date = String(e.data || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof e.posti_liberi !== 'number') throw new Error('turno con campi mancanti');
    const label = String(e.htmlTitle || '').split('<br>')[0].replace(/^\d+\s*/, '').trim();
    for (const q of ['2', '3']) {
      const base = e.pacchetti?.['0']?.[q]?.lordo, ins = e.pacchetti?.['1']?.[q]?.lordo;
      if (base > 0) (packs[e.tipo_turno] ??= {})[q] = [Math.round(base * q), Math.round((ins || base) * q)];
    }
    return [date, String(e.codice), String(e.numero_turno), String(e.tipo_turno), label, String(e.ora_inizio), String(e.ora_fine),
      e.prezzo, e.prezzo_assicurato, e.prezzo_ultimo_giorno, e.posti_liberi];
  };
  const sort = (a, b) => (a[0] + a[2]).localeCompare(b[0] + b[2]);
  const [moto, auto] = await Promise.all([fetchSede(SEDI.moto), fetchSede(SEDI.auto)]);
  return { updated: new Date().toISOString(), shop: SHOP, packs, moto: moto.map(row).sort(sort), auto: auto.map(row).sort(sort) };
}

function reply(body, maxAge, extra) {
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=' + maxAge, ...CORS, ...extra } });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname !== '/' && url.pathname !== '/data.json') return new Response('Not found', { status: 404, headers: CORS });

    const cache = caches.default;
    const freshKey = new Request(url.origin + '/__fresh');
    const backupKey = new Request(url.origin + '/__backup');

    const hit = await cache.match(freshKey);
    if (hit) return reply(await hit.text(), 60, { 'X-Cache': 'hit' });

    try {
      const body = JSON.stringify(await readVallelunga());
      ctx.waitUntil(Promise.all([
        cache.put(freshKey, reply(body, FRESH_SECONDS)),
        cache.put(backupKey, reply(body, BACKUP_SECONDS)),
      ]));
      return reply(body, 60, { 'X-Cache': 'miss' });
    } catch (err) {
      const old = await cache.match(backupKey);
      if (old) return reply(await old.text(), 30, { 'X-Cache': 'stale' });
      return new Response(JSON.stringify({ error: 'Vallelunga non risponde' }), { status: 502, headers: { 'Content-Type': 'application/json', ...CORS } });
    }
  },
};
