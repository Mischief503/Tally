// Job history: paid jobs from earlier days and lost jobs leave Jobs, the Board and the Field view and
// live in their own tab (search, filters, months, paging). Today's finished work stays out front for
// the day, a finished job that still owes money or a signature stays until settled, and open jobs
// whose date went by are flagged instead of hidden. Crew and leads see the jobs they worked.
const { load, ok, sleep, summary, clone } = require('./lib');
const file = process.argv[2] || __dirname + '/../../build/tally-artifact.html', label = process.argv[3] || 'history';
const L = (m) => label + ': ' + m;
const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const PAST = ['Lena Wu', 'Devon Reyes', 'Ibrahim Sayed', 'Chloe Martin', 'Owen Patel', 'Grace Pham'];
const OPEN = ['Priya Nair', 'Hollis & Reed Law', 'Nadia Farouk', 'Ortega family', 'Sam Kowalski', 'Marcus Tull'];

(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, text, T } = A;
  const st = () => T.state();
  const byName = (n) => st().jobs.find((j) => j.d.name === n);
  const view = () => $('#view').textContent.replace(/\s+/g, ' ');
  const names = (sel) => $$(sel || '#view [data-act="job:open"]').map((b) => (st().jobs.find((j) => j.id === b.dataset.id) || { d: { name: '?' } }).d.name);
  const tab = async (t) => { click('[data-act="tab"][data-tab="' + t + '"]'); await sleep(15); };
  const more = async (t) => { click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:go"][data-tab="' + t + '"]'); await sleep(15); };
  const preview = async (role, staff) => { click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5); click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === role && b.dataset.staff === staff)); await sleep(15); };
  const endPreview = async () => { click('[data-act="pv:end"]'); await sleep(15); };
  const type = (sel, v) => { const e = $(sel); e.focus(); e.value = v; e.dispatchEvent(new w.Event('input', { bubbles: true })); return e; };
  const mondayOf = (s) => { const p = s.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  /* ---------------- Jobs: open work only ---------------- */
  await tab('jobs');
  const open = names();
  ok(open.length === 6 && OPEN.every((n) => open.includes(n)), L('Jobs lists the six open jobs: ' + open.join(', ')));
  ok(!PAST.some((n) => open.includes(n)), L('paid jobs from earlier days and the lost one are not in Jobs'));
  ok(/Marcus Tull/.test(view()) && /\$[\d,.]+ due/.test(view()), L('a finished job that still owes money stays in Jobs, with what is due'));
  ok(!$('[data-act="filter"][data-f="lost"]') && !!$('[data-act="filter"][data-f="paid"]') && !$('[data-act="filter"][data-f="late"]'), L('no Lost chip (lost jobs are history) and no Date passed chip while nothing is late'));
  ok(/6 paid or lost jobs/.test(view()) && !!$('#view [data-act="hist:go"]'), L('a line at the bottom says where the past jobs went'));

  /* ---------------- the Job history tab ---------------- */
  click('#view [data-act="hist:go"]'); await sleep(20);
  ok(T.ui.tab === 'history' && !!$('#hSearch'), L('Job history › opens the history tab with a search box'));
  let hist = names();
  ok(hist.join() === 'Lena Wu,Grace Pham,Devon Reyes,Ibrahim Sayed,Chloe Martin,Owen Patel', L('newest first: ' + hist.join(', ')));
  const months = $$('#hBody .secline h2').map((h) => h.textContent);
  ok(months.length >= 2 && months.every((m) => /^[A-Z][a-z]+ \d{4}$/.test(m)), L('grouped by month: ' + months.join(' | ')));
  ok($$('[data-act="hist:f"]').map((c) => c.dataset.f).join() === 'all,paid,lost', L('chips: All, Paid, Lost'));
  click('[data-act="hist:f"][data-f="lost"]'); await sleep(10);
  ok(names().join() === 'Grace Pham' && /^1 job$/.test($('#hBody .secline small').textContent.trim()), L('Lost: just Grace Pham, and a lost quote adds no money to the month'));
  click('[data-act="hist:f"][data-f="all"]'); await sleep(10);
  ok(/\$/.test($('#hBody .secline small').textContent), L('month lines show what was billed'));

  // ---- search
  const box = type('#hSearch', 'tanya'); await sleep(5);
  ok(names().sort().join() === 'Chloe Martin,Ibrahim Sayed,Lena Wu', L('search by crew: Tanya worked Chloe, Ibrahim and Lena'));
  ok(w.document.activeElement === box && $('#hSearch') === box, L('typing keeps the same search box, focused'));
  type('#hSearch', 'shoal'); await sleep(5);
  ok(names().join() === 'Owen Patel', L('search by street'));
  type('#hSearch', 'marcus georgetown'); await sleep(5);
  ok(names().join() === 'Devon Reyes', L('two words both have to match'));
  byName('Lena Wu').d.phone = '512-555-0123';
  type('#hSearch', '0123'); await sleep(5);
  ok(names().join() === 'Lena Wu', L('part of a phone number'));
  type('#hSearch', '(512) 555-0123'); await sleep(5);
  ok(names().join() === 'Lena Wu', L('or the whole number, written any way'));
  type('#hSearch', byName('Devon Reyes').d.moveDate); await sleep(5);
  ok(names().join() === 'Devon Reyes', L('or the day'));
  type('#hSearch', 'zzzz'); await sleep(5);
  ok(/Nothing matches “zzzz”/.test(view()) && !!$('[data-act="hist:clear"]'), L('no match says so, with Clear search'));
  click('[data-act="hist:clear"]'); await sleep(10);
  ok($('#hSearch').value === '' && names().length === 6, L('Clear search shows everything again'));

  // ---- leaving and coming back starts fresh; a remote redraw while typing keeps the box
  type('#hSearch', 'lena'); await sleep(5);
  T.render(); await sleep(5);
  ok($('#hSearch').value === 'lena' && w.document.activeElement === $('#hSearch') && names().join() === 'Lena Wu', L('a redraw while typing keeps the search and the focus'));
  $('#hSearch').blur();
  await tab('today'); await more('history');
  ok($('#hSearch').value === '' && names().length === 6, L('coming back from More starts with no search'));

  // ---- paging: a busy company's history shows 50 at a time
  const base = byName('Lena Wu');
  for (let i = 0; i < 120; i++) { const j = clone(base); j.id = 'old' + i; j.d.name = 'Oldjob' + i + 'q'; j.d.phone = ''; j.d.moveDate = iso(-100 - i); st().jobs.push(j); }
  T.render(); await sleep(10);
  ok(names().length === 50 && /Show 50 more \(76 left\)/.test(view()), L('126 past jobs: the first 50, then Show 50 more (76 left)'));
  click('[data-act="hist:more"]'); await sleep(10);
  ok(names().length === 100 && /Show 26 more \(26 left\)/.test(view()), L('then 100'));
  click('[data-act="hist:more"]'); await sleep(10);
  ok(names().length === 126 && !$('[data-act="hist:more"]'), L('then all of them'));
  type('#hSearch', 'oldjob11'); await sleep(5);
  ok(names().length === 11 && names().every((n) => /^Oldjob11\d?q$/.test(n)), L('search looks through all of them, not just the 50 shown'));
  st().jobs = st().jobs.filter((j) => !/^old/.test(j.id));
  type('#hSearch', ''); $('#hSearch').blur(); await sleep(10);

  // ---- the office opens a past job in the job sheet, as before
  click('#view [data-act="job:open"][data-id="' + base.id + '"]'); await sleep(15);
  ok(!$('#sheet').hidden && /Lena Wu/.test($('#sheet').textContent), L('tapping a past job opens it'));
  click('[data-act="sheet:close"]'); await sleep(10);

  /* ---------------- today's finished work stays out front for the day ---------------- */
  const P = byName('Priya Nair');
  P.status = 'paid'; T.render(); await tab('jobs');
  ok(names().includes('Priya Nair') && $('[data-act="filter"][data-f="paid"] small').textContent === '1', L('a job paid today stays in Jobs today'));
  await tab('today'); ok(/Priya Nair/.test(view()), L('and on Today'));
  await tab('dispatch'); ok(/Priya Nair/.test(view()), L('and on the Board'));
  await more('history'); ok(!names().includes('Priya Nair'), L('and is not in history yet'));
  P.d.moveDate = iso(-1); T.render(); await sleep(5);
  ok(names()[0] === 'Priya Nair', L('the next day it is at the top of Job history'));
  await tab('jobs'); ok(!names().includes('Priya Nair'), L('and gone from Jobs'));
  P.status = 'booked'; P.d.moveDate = iso(0); T.render();

  /* ---------------- a finished job stays until money and signatures are done ---------------- */
  const M = byName('Marcus Tull');
  M.payments.push({ id: 'p-all', amt: 99999, method: 'Cash', date: iso(-2), ts: Date.now() }); T.render(); await sleep(5);
  ok(names().includes('Marcus Tull'), L('paid in full but the delivery receipt is not signed: still in Jobs'));
  M.signed.push({ id: 's1', formId: 'f_deliv', title: 'Delivery receipt and release', name: 'Marcus Tull', sig: '', ts: Date.now() });
  T.render(); await sleep(5);
  ok(!names().includes('Marcus Tull') && /7 paid or lost jobs/.test(view()), L('signed and paid: Complete moves to history'));
  await more('history');
  ok(names().includes('Marcus Tull') && $$('[data-act="hist:f"]').map((c) => c.dataset.f).join() === 'all,paid,done,lost', L('history shows it as Complete, with a Complete chip'));

  /* ---------------- the Board ---------------- */
  const lena = byName('Lena Wu');
  T.ui.weekStart = mondayOf(lena.d.moveDate); T.ui.day = lena.d.moveDate; await tab('dispatch');
  ok(!/Lena Wu/.test(view()) && /Nothing open this day/.test(view()) && /1 finished job is in Job history/.test(view()), L('Board: Lena Wu’s day shows nothing open and says where her job went'));
  const dots = $$('.dpill.on .n')[0];
  ok(dots && /transparent/.test(dots.getAttribute('style') || ''), L('and the day has no job dot'));
  click('#view [data-act="hist:go"]'); await sleep(20);
  ok(T.ui.tab === 'history' && $('#hSearch').value === lena.d.moveDate && names().join() === 'Lena Wu', L('Open Job history shows that day’s finished jobs'));
  const extra = clone(byName('Nadia Farouk')); extra.id = 'xtra'; extra.d.name = 'Rosa Diaz'; extra.d.moveDate = lena.d.moveDate; st().jobs.push(extra);
  T.ui.day = lena.d.moveDate; await tab('dispatch');
  ok(/Rosa Diaz/.test(view()) && /1 finished job from this day/.test(view()) && !/Nothing open this day/.test(view()), L('with open work that day, the board shows it and a line for the finished one'));
  st().jobs = st().jobs.filter((j) => j.id !== 'xtra');
  T.ui.weekStart = mondayOf(iso(0)); T.ui.day = iso(0);

  /* ---------------- open jobs whose date went by: flagged, not hidden ---------------- */
  const H = byName('Hollis & Reed Law'), O = byName('Ortega family');
  H.d.moveDate = iso(-3); O.d.moveDate = iso(-1); T.render();
  await tab('today');
  ok(/1 booked job is past its date/.test(view()) && /Hollis & Reed Law · finish, move or mark lost/.test(view()), L('Today: one alert for the booked job past its date (not the quote)'));
  click('[data-act="jobs:late"]'); await sleep(15);
  ok(T.ui.tab === 'jobs' && $('[data-act="filter"][data-f="late"]').classList.contains('on'), L('it opens Jobs on Date passed'));
  ok(names().sort().join() === 'Hollis & Reed Law,Ortega family' && $$('#view .pill.warn').filter((p) => p.textContent === 'Date passed').length === 2, L('which lists the booking and the quote, each flagged'));
  click('#view [data-act="job:open"][data-id="' + O.id + '"]'); await sleep(15);
  ok(/has passed\. If they are still moving, pick a new date\. If not, set Status to Lost\./.test($('#sheet').textContent), L('the quote’s sheet says what to do'));
  click('[data-act="sheet:close"]'); await sleep(5);
  click('#view [data-act="job:open"][data-id="' + H.id + '"]'); await sleep(15);
  ok(/has passed\. If the move happened, set Status to Complete or Paid\. If not, pick a new date or set Status to Lost\./.test($('#sheet').textContent), L('the booking’s sheet too'));
  const sel = $('#sheet [data-jstatus]'); sel.value = 'lost'; sel.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(10);
  ok(H.status === 'lost' && /Marked lost\. It is in Job history now\./.test($('#toast').textContent), L('marking it Lost says it moved to Job history'));
  click('[data-act="sheet:close"]'); await sleep(10);
  ok(!names().includes('Hollis & Reed Law'), L('and it leaves Jobs'));
  await tab('today'); ok(!/past its date/.test(view()), L('Today’s alert clears'));
  O.d.moveDate = iso(5); T.render(); await tab('jobs');
  ok(!$('[data-act="filter"][data-f="late"]') && T.ui.filter === 'all', L('with nothing late, the Date passed chip goes and the list shows all'));

  /* ---------------- reports still count everything ---------------- */
  await more('reports');
  ok(/Lena Wu/.test(view()) || /Devon Reyes/.test(view()), L('Reports still use past jobs'));

  /* ---------------- a crew member ---------------- */
  const D = byName('Devon Reyes'), OP = byName('Owen Patel');
  const late = clone(byName('Nadia Farouk')); late.id = 'late-dee'; late.d.name = 'Wes Park'; late.d.moveDate = iso(-2); late.assign.crew = ['Dee']; st().jobs.push(late);
  await preview('crew', 'Dee');
  ok(!/Wes Park/.test(view()), L('Dee’s Today does not offer a booking whose day went by as next up'));
  click('[data-act="more:open"]'); await sleep(5);
  ok(!!$('#more [data-act="more:go"][data-tab="history"]') && /Jobs you worked/.test($('#more').textContent), L('Dee’s More has Job history'));
  click('[data-act="more:go"][data-tab="crew"]'); await sleep(15);
  ok(/Wes Park/.test(view()), L('Wes Park is still in Dee’s jobs, where the lead can start or finish it'));
  ok(!/Devon Reyes|Owen Patel/.test(view()) && /2 past jobs/.test(view()) && !/ with /.test($$('#view .secline small').map((s) => s.textContent).join(' ')), L('her old paid jobs are not on the Field screen; a line points to Job history'));
  click('#view [data-act="hist:go"]'); await sleep(15);
  const mine = $$('#view [data-act="hist:open"]').map((b) => st().jobs.find((j) => j.id === b.dataset.id).d.name);
  ok(mine.join() === 'Devon Reyes,Owen Patel', L('Dee’s history: just the jobs she worked: ' + mine.join(', ')));
  ok(!/\$/.test(view()) && !/Lost/.test(view()), L('no prices and no lost quotes for the crew'));
  click('[data-act="hist:open"][data-id="' + D.id + '"]'); await sleep(10);
  ok(!!$('#view .crewcard') && /Photos and updates/.test(view()) && /Finished\. You can still add photos and notes\./.test(view()), L('tapping a job opens the field card'));
  const note = $('#cn_' + D.id); note.value = 'Left the spare key under the mat.';
  click('[data-act="cr:note"][data-id="' + D.id + '"]'); await sleep(10);
  ok(D.crewNotes.some((n) => n.who === 'Dee' && /spare key/.test(n.text)) && T.ui.tab === 'history' && !!$('#view .crewcard') && /spare key/.test(view()), L('a note added there saves, and the screen stays on history with the card open'));
  click('[data-act="hist:open"][data-id="' + D.id + '"]'); await sleep(10);
  ok(!$('#view .crewcard'), L('tapping the job again closes the card'));
  await endPreview();

  /* ---------------- a crew lead ---------------- */
  await preview('lead', 'Marcus');
  await more('history');
  const marc = $$('#view [data-act="hist:open"]').map((b) => st().jobs.find((j) => j.id === b.dataset.id).d.name);
  ok(marc.includes('Devon Reyes') && marc.includes('Marcus Tull') && !marc.includes('Ibrahim Sayed'), L('Marcus sees the jobs he ran: ' + marc.join(', ')));
  click('[data-act="hist:open"][data-id="' + OP.id + '"]'); await sleep(10);
  ok(/Paid and closed\. You can still add photos and notes\./.test(view()), L('his card says paid and closed'));
  await endPreview();
  ok(st().ui.role === 'owner', L('back to the owner'));

  /* ---------------- wide screens: in the side bar ---------------- */
  const B = await load(file, { width: 1100 });
  ok(B.$$('nav.tabs [data-tab]').map((b) => b.dataset.tab).join() === 'today,quote,jobs,dispatch,crew,history,chat,reports,settings', L('wide screens list Job history after Field view'));
  B.click('nav.tabs [data-tab="history"]'); await sleep(15);
  ok(B.$$('#view [data-act="job:open"]').length === 6 && B.$('nav.tabs [data-tab="history"]').getAttribute('aria-current') === 'page', L('and it opens from there'));

  ok(A.errors.length === 0 && B.errors.length === 0, L('no errors (' + A.errors.concat(B.errors).slice(0, 3).join(' | ') + ')'));

  /* ---------------- hosted: a change on another phone moves a job while history is open ---------------- */
  if (/supabase/.test(file)) {
    const ORG = 'org-h';
    const jd = (id, over) => Object.assign({ id, status: 'booked', createdAt: Date.now() - 20 * 864e5,
      d: { name: id, phone: '', email: '', source: 'Google', moveDate: iso(2), time: '08:00', from: '1 A St', to: '2 B St', miles: '', flights: '', pack: false, crew: '', truckId: '', hoursOverride: '', discount: '', notes: '', custom: {}, items: [] },
      quote: { total: 1000, cf: 500, crew: 2, hours: 3, lines: [{ label: 'Movers', amt: 1000 }], deposit: 250, nte: 1150, lbs: 3500, truckId: 't26', truckName: 'Box 1', nTrucks: 1, pct: 0.3, count: 10 },
      items: [], assign: { truckId: 't26', crew: ['Marcus'] }, tally: {}, payments: {}, signed: {}, extras: {}, crewNotes: {}, photos: {}, materials: {}, costs: {}, log: {} }, over);
    const docs = [], put = (path, data) => { const [collection, doc_id] = path.split('/'); docs.push({ org_id: ORG, path, collection, doc_id, data, updated_at: new Date().toISOString() }); };
    put('meta/init', { ts: 1, mode: 'fresh' });
    put('org/settings', { company: 'Ace Moving', crew: ['Marcus', 'Dee'], leads: ['Marcus'], office: [{ name: 'Owner', kind: 'owner' }], forms: [], trucks: [{ id: 't26', name: 'Box 1 (26 ft)', cf: 1700 }] });
    put('jobs/j1', jd('j1', { d: Object.assign(jd('x').d, { name: 'Upcoming Ute' }) }));
    put('jobs/j2', jd('j2', { status: 'paid', d: Object.assign(jd('x').d, { name: 'Paid Pat', moveDate: iso(-5) }), payments: { p1: { id: 'p1', amt: 1000, method: 'Cash', date: iso(-5), ts: Date.now() - 5 * 864e5 } } }));
    put('jobs/j3', jd('j3', { status: 'lost', d: Object.assign(jd('x').d, { name: 'Lost Lou', moveDate: '' }) }));
    put('jobs/j4', jd('j4', { d: Object.assign(jd('x').d, { name: 'Late Lee', moveDate: iso(-3) }) }));
    const db = { docs, members: [{ org_id: ORG, user_id: 'u-own', email: 'o@x.com', staff: 'Owner', role: 'owner', ts: 1 }], access_requests: [] };
    const C = await load(file, { db, org: ORG, me: { uid: 'u-own', email: 'o@x.com' } });
    const cn = (sel) => C.$$(sel || '#view [data-act="job:open"]').map((b) => b.dataset.id).join();
    C.click('[data-act="tab"][data-tab="jobs"]'); await sleep(20);
    ok(cn() === 'j1,j4' || cn() === 'j4,j1', L('hosted: Jobs has the open ones (' + cn() + ')'));
    ok(/Date passed/.test(C.$('#view').textContent), L('hosted: Late Lee is flagged'));
    C.click('#view [data-act="hist:go"]'); await sleep(20);
    ok(cn() === 'j2,j3', L('hosted: history has Paid Pat and Lost Lou (' + cn() + ')'));
    const box = C.$('#hSearch'); box.focus(); box.value = 'l'; box.dispatchEvent(new C.w.Event('input', { bubbles: true })); await sleep(5);
    ok(cn() === 'j3', L('hosted: searching “l” finds Lost Lou'));
    const row = db.docs.find((r) => r.path === 'jobs/j4');
    row.data = Object.assign(clone(row.data), { status: 'paid', payments: { p2: { id: 'p2', amt: 1000, method: 'Check', date: iso(-3), ts: Date.now() } } });
    C.w.__sb.__fire('docs', { collection: 'jobs', path: 'jobs/j4' }); await sleep(700);
    ok(cn() === 'j4,j3' && C.w.document.activeElement === C.$('#hSearch') && C.$('#hSearch').value === 'l', L('hosted: the office marks Late Lee paid on another phone: it shows up here at once, and the search box keeps its text and focus'));
    C.$('#hSearch').blur();
    C.click('[data-act="tab"][data-tab="jobs"]'); await sleep(20);
    ok(cn() === 'j1' && !/Date passed/.test(C.$('#view').textContent), L('hosted: and Jobs has just the upcoming one'));
    ok(C.errors.length === 0, L('hosted: no errors (' + C.errors.slice(0, 3).join(' | ') + ')'));
  }
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
