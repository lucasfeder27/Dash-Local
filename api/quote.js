// api/quote.js — cotações públicas de ações (para ações tokenizadas e ações comuns).
// Sem banco, sem senha: só repassa cotações públicas do Yahoo Finance (com Stooq de reserva). Cache curto.
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; DashInvest/1.0)' };

async function yahoo(sym) {
  const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?interval=1d&range=5d', { headers: UA });
  if (!r.ok) throw new Error('Yahoo ' + r.status);
  const j = await r.json();
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  const m = res && res.meta;
  if (!m || !(m.regularMarketPrice > 0)) throw new Error('Yahoo sem preço');
  const closes = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close || []).filter(x => x != null);
  const prev = m.chartPreviousClose > 0 ? m.chartPreviousClose : (m.previousClose > 0 ? m.previousClose : (closes.length > 1 ? closes[closes.length - 2] : null));
  return { price: +m.regularMarketPrice, prev: prev ? +prev : null, name: m.longName || m.shortName || sym, currency: m.currency || 'USD', time: m.regularMarketTime ? m.regularMarketTime * 1000 : Date.now() };
}

async function stooq(sym) {
  const s = sym.toLowerCase().includes('.') ? sym.toLowerCase() : sym.toLowerCase() + '.us';
  const r = await fetch('https://stooq.com/q/l/?s=' + encodeURIComponent(s) + '&f=sd2t2ohlcv&h&e=csv', { headers: UA });
  if (!r.ok) throw new Error('Stooq ' + r.status);
  const t = (await r.text()).trim().split('\n');
  const c = (t[1] || '').split(',');
  const p = parseFloat(c[6]);
  if (!(p > 0)) throw new Error('Stooq sem preço');
  const o = parseFloat(c[3]);
  return { price: p, prev: o > 0 ? o : null, name: sym, currency: 'USD', time: Date.now() };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
  const q = new URL(req.url, 'http://x').searchParams;
  const syms = [...new Set(String(q.get('symbols') || '').split(',').map(s => s.trim().toUpperCase()).filter(s => /^[A-Z0-9.\-^=]{1,15}$/.test(s)))].slice(0, 30);
  const out = {}, errors = {};
  await Promise.all(syms.map(async s => {
    try { out[s] = await yahoo(s); }
    catch (e1) { try { out[s] = await stooq(s); } catch (e2) { errors[s] = e1.message; } }
  }));
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true, quotes: out, errors }));
};
