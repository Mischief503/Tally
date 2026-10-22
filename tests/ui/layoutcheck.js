// The in-page layout check shared by layout.js (the artifact edition) and layout-hosted.js (the hosted
// app): on the screen or the open panel, what runs off the side, which controls are smaller than a thumb
// (36 px each way), and which ones sit under something else (the bottom bar, the round button, a bar).
// It runs inside the page (page.evaluate), so it uses only what the browser has.
const CHECK = () => {
  const W = innerWidth, H = innerHeight, out = { overflow: document.documentElement.scrollWidth - W, wide: [], small: [], covered: [] };
  const folded = (el) => { for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) { if (!d.open) { const sm = d.querySelector(':scope > summary'); if (!(sm && sm.contains(el))) return true; } } return false; };
  const vis = (el) => { if (!el.getClientRects().length || folded(el)) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0; };
  const name = (el) => el.tagName.toLowerCase() + (el.dataset.act ? '[' + el.dataset.act + ']' : '') + ' "' + (el.getAttribute('aria-label') || el.textContent || el.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 40) + '"';
  const ovs = ['#sos', '#matpick', '#mover', '#start', '#call', '#pick', '#more', '#rq', '#emp', '#flow', '#sheet'].map((s) => document.querySelector(s)).filter((e) => e && !e.hidden && vis(e));
  const root = ovs[0] || document.querySelector('main');
  const sideScroll = (el) => { for (let p = el.parentElement; p; p = p.parentElement) if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowX)) return true; return false; };
  root.querySelectorAll('*').forEach((el) => { if (!vis(el)) return; const r = el.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1) && !sideScroll(el)) out.wide.push(name(el)); });
  const ctrls = Array.from(root.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [data-act]')).filter((e) => vis(e) && !e.classList.contains('scrim') && !e.closest('[aria-hidden="true"]'));
  ctrls.forEach((el) => {
    const r = el.getBoundingClientRect(), inText = el.tagName === 'A' && el.closest('p, li, small, .hint'), tick = el.type === 'checkbox' || el.type === 'radio' || !!el.closest('.sw');
    if (!inText && !tick && (r.height < 35.5 || r.width < 35.5)) out.small.push(name(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  ctrls.forEach((el) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > H) return;
    const hit = document.elementFromPoint(Math.min(W - 2, Math.max(1, r.left + r.width / 2)), Math.min(H - 2, Math.max(1, r.top + r.height / 2)));
    if (!hit || hit === el || el.contains(hit) || hit.contains(el) || (hit.closest('label') && hit.closest('label').contains(el)) || (el.labels && Array.from(el.labels).some((l) => l.contains(hit)))) return;
    if (el.closest('.sw') && hit.closest('.sw') === el.closest('.sw')) return;
    out.covered.push(name(el) + ' under ' + name(hit));
  });
  scrollTo(0, 0);
  return out;
};
module.exports = { CHECK };
