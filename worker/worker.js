// Trackday VL – legge i turni dal calendario prove libere di Vallelunga quando qualcuno apre il sito.
// Tiene la lettura per 5 minuti; se Vallelunga non risponde, restituisce l'ultima lettura buona.
// Un calendario vuoto viene accettato solo se resta vuoto per 48 ore di fila (prima si considera un errore temporaneo).
// Richiede il collegamento KV "STORE" (ultima lettura buona e inizio del periodo vuoto).

const ENDPOINT = 'https://motorsport.vallelunga.it/wp-admin/admin-ajax.php';
const SHOP = 'https://motorsport.vallelunga.it/shop/';
const SEDI = { moto: 3, auto: 4 };
const FRESH_SECONDS = 300;
const EMPTY_ACCEPT_MS = 48 * 3600 * 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers': 'X-State',
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
  let [moto, auto] = await Promise.all([fetchSede(SEDI.moto), fetchSede(SEDI.auto)]);
  if (!moto.length && !auto.length) {
    // A volte Vallelunga risponde per qualche minuto con un calendario vuoto: riprova una volta.
    await new Promise((r) => setTimeout(r, 1500));
    [moto, auto] = await Promise.all([fetchSede(SEDI.moto), fetchSede(SEDI.auto)]);
  }
  return { updated: new Date().toISOString(), shop: SHOP, packs, moto: moto.map(row).sort(sort), auto: auto.map(row).sort(sort), empty: !moto.length && !auto.length };
}

function reply(body, maxAge, extra) {
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=' + maxAge, ...CORS, ...extra } });
}

async function decide(env) {
  let data;
  try { data = await readVallelunga(); }
  catch (err) {
    const backup = await env.STORE.get('backup');
    if (backup) return { body: backup, state: 'stale' };
    throw err;
  }
  const empty = data.empty; delete data.empty;
  const body = JSON.stringify(data);
  if (!empty) {
    const tasks = [env.STORE.put('backup', body)];
    if (await env.STORE.get('emptySince')) tasks.push(env.STORE.delete('emptySince'));
    await Promise.all(tasks);
    return { body, state: 'fresh' };
  }
  let since = Number(await env.STORE.get('emptySince'));
  if (!since) { since = Date.now(); await env.STORE.put('emptySince', String(since)); }
  const backup = await env.STORE.get('backup');
  if (!backup || Date.now() - since >= EMPTY_ACCEPT_MS) {
    if (backup) await env.STORE.put('backup', body);
    return { body, state: 'empty' };
  }
  return { body: backup, state: 'empty-wait' };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname !== '/' && url.pathname !== '/data.json') return new Response('Not found', { status: 404, headers: CORS });

    const cache = caches.default;
    const freshKey = new Request(url.origin + '/__fresh-v3');
    const hit = await cache.match(freshKey);
    if (hit) return reply(await hit.text(), 60, { 'X-State': 'cache' });

    try {
      const { body, state } = await decide(env);
      ctx.waitUntil(cache.put(freshKey, reply(body, FRESH_SECONDS)));
      return reply(body, 60, { 'X-State': state });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Vallelunga non risponde' }), { status: 502, headers: { 'Content-Type': 'application/json', ...CORS } });
    }
  },
};
