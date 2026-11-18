// api/bench.js — dados públicos de mercado (Ibovespa, S&P 500, CDI) para o gráfico de rentabilidade.
// Não usa banco nem senha: só repassa cotações públicas. Cache de 1 hora na Vercel.
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; DashInvest/1.0)' };

const isoDate = d => new Date(d).toISOString().slice(0, 10);

async function yahoo(symbol, fromIso) {
  const p1 = Math.floor(new Date(fromIso + 'T00:00:00Z').getTime() / 1000);
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) +
    '?period1=' + p1 + '&period2=' + p2 + '&interval=1d';
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error('Yahoo ' + r.status);
  const j = await r.json();
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res || !res.timestamp) throw new Error('Yahoo sem dados');
  const close = res.indicators.quote[0].close;
  const out = [];
  res.timestamp.forEach((t, i) => { if (close[i] != null) out.push([isoDate(t * 1000), +close[i]]); });
  if (!out.length) throw new Error('Yahoo vazio');
  return out;
}

async function stooq(symbol, fromIso) {
  const r = await fetch('https://stooq.com/q/d/l/?s=' + encodeURIComponent(symbol) + '&i=d', { headers: UA });
  if (!r.ok) throw new Error('Stooq ' + r.status);
  const txt = await r.text();
  const out = [];
  txt.split('\n').slice(1).forEach(l => {
    const c = l.trim().split(',');
    if (c.length >= 5 && c[0] >= fromIso && +c[4] > 0) out.push([c[0], +c[4]]);
  });
  if (!out.length) throw new Error('Stooq vazio');
  return out;
}

async function cdi(fromIso) {
  const br = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
  const url = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=' + br(fromIso) + '&dataFinal=' + br(isoDate(Date.now()));
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error('BCB ' + r.status);
  const j = await r.json();
  let idx = 1;
  const out = j.map(x => {
    const d = x.data.slice(6, 10) + '-' + x.data.slice(3, 5) + '-' + x.data.slice(0, 2);
    idx *= 1 + parseFloat(x.valor) / 100;
    return [d, idx];
  });
  if (!out.length) throw new Error('BCB vazio');
  return out;
}

async function firstOk(fns) {
  let err;
  for (const f of fns) { try { return await f(); } catch (e) { err = e; } }
  throw err;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  const q = new URL(req.url, 'http://x').searchParams;
  let from = q.get('from') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) from = isoDate(Date.now() - 400 * 86400000);
  const jobs = {
    ibov: () => firstOk([() => yahoo('^BVSP', from), () => stooq('^bvp', from)]),
    spx: () => firstOk([() => yahoo('^GSPC', from), () => stooq('^spx', from)]),
    cdi: () => cdi(from)
  };
  const series = {}, errors = {};
  await Promise.all(Object.keys(jobs).map(async k => {
    try { series[k] = await jobs[k](); } catch (e) { errors[k] = e.message; }
  }));
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true, from, series, errors }));
};
