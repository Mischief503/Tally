// The customer side in the phone app (Oct 28): a customer signs in with the email on their move (Google, or a code by
// email) and the app opens on their side, from the Edge Function's copies of their moves (stood in for here by fnReply;
// the function itself is tests/function/cust.ts). Booking, signing ahead and paying go through the function; paying
// leaves for Stripe's page (Google Pay there) and comes back to a thank you and the review page.
const { load, ok, sleep, summary } = require('./lib');
const FILE = __dirname + '/../../build/tally-supabase.html', ORG = '11111111-1111-1111-1111-111111111111';
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const later = iso(new Date(Date.now() + 6 * 864e5)), past = iso(new Date(Date.now() - 2 * 864e5));
// the server's copy of a move (custCopy)
function move(id, o) {
  return Object.assign({ id, org: ORG, company: 'Ace Moving', phone: '+15125550000', status: 'quoted', test: false,
    d: { name: 'Priya Nair', phone: '512-555-0142', email: 'priya.nair@gmail.com', moveDate: later, time: '09:00', from: '418 Oak St', to: '77 Ridge Rd' },
    quote: { lines: [{ label: '3 movers, 4 hr at $195/hr', amt: 780 }, { label: 'Truck and fuel', amt: 220 }], total: 1000, nte: 1150, deposit: 250, crew: 3, hours: 4, trucks: 1, flat: false },
    items: [{ name: 'Sofa (3-seat)', qty: 1 }], bill: { total: 1000, paid: 0, due: 1000, deposit: 0 }, pays: [],
    forms: [{ id: 'f_agree', title: 'Moving agreement', kind: 'text', text: 'I agree to the quote.', pages: [], ahead: true, signed: null }],
    day: { startedAt: 0, eta: 0, phases: {}, finishedAt: 0 }, crew: { lead: '', n: 0 }, tips: true, book: true, review: 'https://g.page/r/ace/review', reviewed: false, bookedBy: '' }, o || {});
}
function server(moves) {
  const calls = [];
  const reply = (b) => {
    calls.push(b);
    const m = moves.find((x) => x.id === b.jobId);
    if (b.action === 'cust_list') return { ok: true, email: 'Priya.Nair@gmail.com', name: 'Priya Nair', phone: '', moves: JSON.parse(JSON.stringify(moves)) };
    if (b.action === 'cust_book') { m.status = 'booked'; m.bookedBy = 'customer'; m.bill.deposit = 250; return { ok: true }; }
    if (b.action === 'cust_sign') { m.forms.find((f) => f.id === b.formId).signed = { name: b.name, ts: Date.now(), ahead: true }; return { ok: true }; }
    if (b.action === 'cust_pay') return { ok: true, url: 'https://checkout.stripe.com/c/pay/cs_test_9' };
    if (b.action === 'cust_check' || b.action === 'cust_reviewed' || b.action === 'cust_profile') { if (b.action === 'cust_reviewed') m.reviewed = true; return { ok: true }; }
    return { ok: true, sent: 0 };
  };
  return { calls, reply };
}
const db0 = () => ({ docs: [], access_requests: [], comm_log: [], comm_lines: [], members: [] });

(async () => {
  /* ---------- signed out: Google, or a code by email ---------- */
  let A = await load(FILE, { db: db0(), me: null, net: async (url) => ({ json: async () => (/\/auth\/v1\/settings$/.test(url) ? { external: { google: true, email: true } } : {}) }) });
  await sleep(100);
  ok(!!A.$('#lgGoogle') && /Continue with Google/.test(A.$('#login').textContent) && /Sign in to see your move, or to get to work\./.test(A.$('#login').textContent) && /Use the email they have for your move/.test(A.$('#login').textContent), 'signed out: Continue with Google, or a code by email; words for customers and the crew');
  A.click('#lgGoogle'); await sleep(20);
  ok(A.calls.oauth && A.calls.oauth.provider === 'google' && A.calls.oauth.options.redirectTo === 'https://tally.example.com/', 'Google sends them back to this page, signed in');
  A = await load(FILE, { db: db0(), me: null, net: async () => ({ json: async () => ({ external: { google: false } }) }) });
  await sleep(100);
  ok(!A.$('#lgGoogle') && !!A.$('#lgEmail'), 'Google not switched on in Supabase yet: only the email code (no button that leads to an error)');

  /* ---------- Priya signs in: her side of the app ---------- */
  const moves = [move('q1'), move('d1', { status: 'done', d: Object.assign({}, move('x').d, { moveDate: past }), bill: { total: 900, paid: 250, due: 650, deposit: 0 }, crew: { lead: 'Marcus', n: 2 },
    pays: [{ amt: 250, tip: 0, method: 'Cash', date: past, ts: 1 }], forms: [] })];
  let S = server(moves), went = [];
  A = await load(FILE, { db: db0(), me: { uid: 'u-priya', email: 'priya.nair@gmail.com' }, fnReply: S.reply, setup: (w) => { w.__tallyGo = (u) => went.push(u); } });
  await sleep(300);
  const { $, $$, click, T, w } = A;
  const tabs = () => $$('#tabs button').map((b) => b.textContent.replace(/\d+$/, '').trim()).filter(Boolean);
  const view = () => $('#view').textContent.replace(/\s+/g, ' ');
  const sheet = () => ($('#cust') && !$('#cust').hidden ? $('#cust').textContent.replace(/\s+/g, ' ') : '');
  ok(!$('#login') && T.state().ui.role === 'customer' && tabs().join('|') === 'My move|Pay|Profile', 'no company of her own, moves under her email: her side opens (My move, Pay, Profile)');
  ok(S.calls[0].action === 'cust_list' && $('#brandCo').textContent === 'Ace Moving' && T.sync.mode !== 'shared', 'her moves come from the server, under her mover’s name; no company’s data is opened');
  ok(/Pay your bill: \$650/.test(view()) && /Hi Priya/.test(view()), 'My move opens on the bill to pay (the move that needs her most)');
  click('#view [data-act="cs:move"][data-k="' + ORG + '/q1"]'); await sleep(15);
  ok(/Quote/.test(view()) && !!$('#view [data-act="cs:book"]'), 'her other move: a quote to book');
  click('#view [data-act="cs:book"]'); await sleep(10);
  $('#csAgree').checked = true; click('[data-act="cs:bookgo"]'); await sleep(120);
  const bk = S.calls.find((c) => c.action === 'cust_book');
  ok(bk && bk.org === ORG && bk.jobId === 'q1' && S.calls.filter((c) => c.action === 'cust_list').length >= 2, 'Book my move goes to the server, then her moves are read again');
  ok(/Pay your deposit/.test(sheet()), 'then the deposit');
  click('[data-act="cs:paygo"]'); await sleep(80);
  const pc = S.calls.find((c) => c.action === 'cust_pay');
  ok(pc && pc.kind === 'deposit' && pc.amount === 25000 && pc.tip === 0 && pc.back === 'https://tally.example.com/' && went[0] === 'https://checkout.stripe.com/c/pay/cs_test_9', 'Pay: the server makes the Stripe page for the $250 deposit, and the app goes there (Google Pay on the phone)');
  click('#cust .sheet-head [data-act="cs:close"]'); await sleep(10);
  click('#view [data-act="cs:sign"]'); await sleep(10);
  $('#csSigName').value = 'Priya Nair'; $('#csSigAgree').checked = true; $('#sigPad').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  click('[data-act="cs:signgo"]'); await sleep(120);
  const sc = S.calls.find((c) => c.action === 'cust_sign');
  ok(sc && sc.formId === 'f_agree' && sc.name === 'Priya Nair' && typeof sc.sig === 'string' && /All signed/.test(sheet()), 'signing ahead goes to the server too');
  click('#cust .sheet-head [data-act="cs:close"]'); await sleep(10);
  // the bill, with a tip
  click('#view [data-act="cs:move"][data-k="' + ORG + '/d1"]'); await sleep(15);
  click('#view [data-act="cs:pay"]'); await sleep(10);
  click('[data-act="cs:tip"][data-t="20"]'); await sleep(10);
  click('[data-act="cs:paygo"]'); await sleep(80);
  const pb = S.calls.filter((c) => c.action === 'cust_pay').pop();
  ok(pb.kind === 'bill' && pb.amount === 65000 && pb.tip === 18000, 'the bill ($650) and a 20% tip ($180 of the $900 bill): what the server is asked for');
  click('#cust .sheet-head [data-act="cs:close"]'); await sleep(10);
  click('[data-act="tab"][data-tab="myprofile"]'); await sleep(10);
  ok(/priya\.nair@gmail\.com/.test(view()) && !!$('[data-act="cs:signout"]') && !$('[data-act="cust:work"]'), 'Profile: the email she signs in with, and Sign out');
  $('#cpPhone').value = '512-555-0199'; click('[data-act="cs:prof"]'); await sleep(80);
  ok(A.calls.updateUser && A.calls.updateUser.data.phone === '512-555-0199' && S.calls.some((c) => c.action === 'cust_profile' && c.phone === '512-555-0199'), 'her profile: kept on her account, and on her open moves');
  ok(A.errors.length === 0, 'no errors (' + A.errors.slice(0, 2).join(' | ') + ')');

  /* ---------- back from Stripe's page: the bill paid, the thank you, the review page ---------- */
  const paidMoves = [move('d1', { status: 'done', d: Object.assign({}, move('x').d, { moveDate: past }), bill: { total: 900, paid: 250, due: 650, deposit: 0 }, crew: { lead: 'Marcus', n: 2 }, forms: [] })];
  S = server(paidMoves); went = [];
  let checks = 0;
  const reply2 = (b) => { if (b.action === 'cust_check' && ++checks === 2) { const m = paidMoves[0]; m.status = 'paid'; m.bill = { total: 900, paid: 900, due: 0, deposit: 0 }; m.pays.push({ amt: 650, tip: 180, method: 'Google Pay (Visa ••4242) (customer app)', date: past, ts: 2 }); } return S.reply(b); };
  const B = await load(FILE, { hash: '?paid=d1', db: db0(), me: { uid: 'u-priya', email: 'priya.nair@gmail.com' }, fnReply: reply2, setup: (w2) => { w2.__tallyGo = (u) => went.push(u); } });
  await sleep(6000);
  ok(checks >= 2 && B.w.location.search === '', 'back from Stripe: the move is brought up to date until the payment shows (and the address is tidied)');
  ok(/Your move is done/.test(B.$('#cust').textContent) && !!B.$('#csCount'), 'the thank you, counting down to the review page');
  await sleep(5200);
  ok(went[0] === 'https://g.page/r/ace/review' && S.calls.some((c) => c.action === 'cust_reviewed' && c.jobId === 'd1'), 'then the company’s review page: ' + went[0]);
  ok(B.errors.length === 0, 'no errors (' + B.errors.slice(0, 2).join(' | ') + ')');

  /* ---------- someone at work with a move of their own: More › My moves ---------- */
  const db = db0(); db.members.push({ org_id: ORG, user_id: 'u-marcus', email: 'marcus@x', staff: 'Marcus', role: 'lead', ts: 1 });
  db.docs.push({ org_id: ORG, path: 'meta/init', collection: 'meta', doc_id: 'init', data: { ts: 1 }, updated_at: 'x' }, { org_id: ORG, path: 'org/settings', collection: 'org', doc_id: 'settings', data: { company: 'Ace Moving', crew: ['Marcus'], leads: ['Marcus'], office: [] }, updated_at: 'x' });
  let reloaded = 0;
  const C = await load(FILE, { db, org: ORG, me: { uid: 'u-marcus', email: 'marcus@x' }, fnReply: server([move('m1', { d: Object.assign({}, move('x').d, { name: 'Marcus T', email: 'marcus@x' }) })]).reply, setup: (w3) => { w3.__tallyReload = () => { reloaded++; }; } });
  await sleep(300);
  ok(C.T.state().ui.role === 'lead', 'Marcus signs in at work, as a lead');
  C.click('[data-act="more:open"]'); await sleep(10);
  const mm = C.$('#more [data-act="cust:mine"]');
  ok(!!mm && /My moves/.test(mm.textContent), 'More: My moves, his own moves as a customer');
  C.click(mm); await sleep(10);
  ok(reloaded === 1 && C.w.sessionStorage.getItem('tally.cust') === '1' && !C.w.localStorage.getItem('tally.org'), 'it opens the app again on his side as a customer');

  /* ---------- the office texts a customer the app ---------- */
  const odb = db0(); odb.members.push({ org_id: ORG, user_id: 'u-owner', email: 'o@x', staff: 'Owner', role: 'owner', ts: 1 });
  odb.docs.push({ org_id: ORG, path: 'meta/init', collection: 'meta', doc_id: 'init', data: { ts: 1 }, updated_at: 'x' },
    { org_id: ORG, path: 'org/settings', collection: 'org', doc_id: 'settings', data: { company: 'Ace Moving', crew: ['Marcus'], leads: ['Marcus'], office: [{ name: 'Owner', kind: 'owner' }] }, updated_at: 'x' },
    { org_id: ORG, path: 'jobs/j1', collection: 'jobs', doc_id: 'j1', data: { id: 'j1', status: 'booked', createdAt: 1, d: { name: 'Priya Nair', phone: '512-555-0142', email: 'priya.nair@gmail.com', moveDate: later, time: '09:00', from: 'A', to: 'B', items: [], custom: {} }, quote: { total: 1000, lines: [] }, items: [], assign: { truckId: '', crew: [] }, payments: {}, signed: {}, log: {} }, updated_at: 'x' });
  const inv = [];
  const O = await load(FILE, { db: odb, org: ORG, me: { uid: 'u-owner', email: 'o@x' }, fnReply: (b) => { if (b.action === 'invite_app') { inv.push(b); return { ok: true, message: 'Texted Priya Nair the app.' }; } return { ok: true, sent: 0 }; } });
  await sleep(300);
  O.T.openJob('j1'); await sleep(30);
  const em = O.$('#sheet [data-j="email"]'), ib = O.$('#sheet [data-act="cust:invite"]');
  ok(em && em.value === 'priya.nair@gmail.com' && ib && /Text Priya the app/.test(ib.textContent) && /They sign in with priya\.nair@gmail\.com/.test(O.$('#sheet').textContent), 'the job: the customer’s email (how they sign in), and Text them the app');
  O.click(ib); await sleep(40);
  ok(inv.length === 1 && inv[0].jobId === 'j1' && inv[0].url === 'https://tally.example.com/' && O.$('#toast').textContent === 'Texted Priya Nair the app.', 'it texts the app’s address from the company line');

  /* ---------- no company and no move: says so ---------- */
  const D = await load(FILE, { db: db0(), me: { uid: 'u-new', email: 'new@x.com' }, fnReply: (b) => (b.action === 'cust_list' ? { ok: true, moves: [] } : { ok: true }) });
  await sleep(300);
  ok(/No move here yet for new@x\.com/.test(D.$('#login').textContent) && /Run a moving company\?/.test(D.$('#login').textContent) && !!D.$('#pkNew'), 'no move under that email yet: it says to ask the moving company, and a company can still be started');

  process.exit(summary('cust-hosted') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
