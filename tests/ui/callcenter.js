// The call center (Richie, Oct 22: "I guess i also need a call center side . They will not see anything but scheduled
// jobs and being able to make quotes"; then: they book, they see the scheduled jobs' details without money and a
// calendar of how busy each day is, all open quotes, and the price but no discounts).
const { load, ok, sleep, summary } = require('./lib');
const file = process.argv[2] || __dirname + '/../../build/tally-artifact.html', label = process.argv[3] || 'callcenter';
const L = (m) => label + ': ' + m;

(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, T } = A;
  const st = () => T.state();
  const view = () => $('#view').textContent.replace(/\s+/g, ' ');
  const toast = () => ($('#toast') && !$('#toast').hidden ? $('#toast').textContent : '');
  const tap = async (sel, ms) => { click(sel); await sleep(ms || 10); };
  const type = (sel, v) => { const e = $(sel); e.value = v; e.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const day = (n) => { const d = new w.Date(); d.setDate(d.getDate() + n); return iso(d); };
  const fmtDate = (s) => { const p = s.split('-').map(Number); return new w.Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
  const t = day(0);
  const S = st().settings;
  ok(Array.isArray(S.callcenter) && S.callcenter[0] === 'Jess' && S.contacts.Jess && T.defaultSettings().callcenter.length === 0, L('the sample company has someone on the phones, Jess (a real company starts with nobody)'));

  /* ---------------- who's who ---------------- */
  await tap('[data-act="more:open"]'); await tap('[data-act="more:preview"]');
  const pvRoles = $$('#more .pvrow b').map((b) => b.textContent);
  ok(pvRoles.join('|') === 'Owner|Dispatch|Call center|Crew lead|Crew' && !!$$('#more [data-act="pv:set"]').find((b) => b.dataset.role === 'callcenter' && b.dataset.staff === 'Jess'), L('See it their way: the call center, with Jess'));
  click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === 'callcenter')); await sleep(20);
  ok(st().ui.role === 'callcenter' && T.ui.tab === 'sched' && $$('#tabs button').map((b) => b.textContent).join('|') === 'Schedule|Quotes||More' && !$('#fab').hidden, L('Jess: Schedule and Quotes, and the round button for a new quote'));
  ok(/Previewing Jess · Call center/.test($('#pvBar').textContent), L('the preview bar: Jess · Call center'));
  for (const tb of ['today', 'jobs', 'dispatch', 'crew', 'history', 'chat', 'reports', 'settings']) { T.ui.tab = tb; T.render(); await sleep(2); if (T.ui.tab !== 'sched') { ok(false, L('she can’t reach ' + tb)); break; } }
  ok(T.ui.tab === 'sched', L('Today, Jobs, the Board, the field, history, chat, money and Setup aren’t hers'));
  await tap('[data-act="more:open"]');
  const more = $('#more').textContent;
  ok(/Change the look/.test(more) && !/Truck down|Setup|Job history|Field view|New quote/.test(more), L('More: the look (and sign-out when signed in), no Truck down'));
  await tap('#more [data-act="more:close"]');

  /* ---------------- the Schedule ---------------- */
  const cells = $$('#view .cal-d'), month = new w.Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const todayCell = cells.find((c) => c.dataset.day === t), recs = T.schedRecs(), tl = T.dayLoad(t);
  ok($('#view .cal-nav h2').textContent === month && cells.length === new w.Date(new w.Date().getFullYear(), new w.Date().getMonth() + 1, 0).getDate(), L('a month of days: ' + month));
  ok(!!todayCell && todayCell.classList.contains('today') && todayCell.classList.contains('on') && todayCell.getAttribute('aria-pressed') === 'true' && todayCell.getAttribute('aria-label').indexOf(fmtDate(t) + ': ') === 0, L('today is picked: ' + (todayCell && todayCell.getAttribute('aria-label'))));
  ok(recs.length > 0 && recs.every((r) => ['booked', 'active'].indexOf(r.status) >= 0) && recs.every((r) => !r.quote.total && !r.payments && !r.extras && !r.quote.lines), L('the schedule is the booked and running jobs, with no money in them (' + recs.length + ')'));
  ok(!/\$/.test(view()), L('and no money anywhere on the screen'));
  const busy = cells.find((c) => /lvl[123]/.test(c.className));
  ok(!!busy && /^\d+$/.test(busy.querySelector('i').textContent) && /job/.test(busy.getAttribute('aria-label')), L('a day with jobs says how many, and how busy: ' + (busy && busy.getAttribute('aria-label'))));
  ok($('#calDay h2').textContent === fmtDate(t) && $$('#view details.schedcard').length === tl.jobs, L('under it, today’s jobs: ' + tl.jobs));
  // a day with a job on it
  const jday = recs.filter((r) => r.d.moveDate && r.d.moveDate.slice(0, 7) === t.slice(0, 7)).map((r) => r.d.moveDate).sort()[0];
  if (jday) {
    await tap('#view .cal-d[data-day="' + jday + '"]');
    const L2 = T.dayLoad(jday), cardsJ = $$('#view details.schedcard');
    ok(T.ui.schedDay === jday && cardsJ.length === L2.jobs && $('#view .cal-d[data-day="' + jday + '"]').classList.contains('on'), L('tap a day: its jobs (' + fmtDate(jday) + ', ' + L2.jobs + ')'));
    const c0 = cardsJ[0], r0 = L2.list.slice().sort((a, b) => (a.d.time < b.d.time ? -1 : 1))[0];
    c0.open = true;
    ok(c0.querySelector('summary b').textContent.indexOf(r0.d.name) > 0 && c0.textContent.indexOf(r0.d.from) >= 0 && /Crew: \d movers/.test(c0.textContent) && /Truck/.test(c0.textContent) && (!r0.d.phone || !!c0.querySelector('[data-act="cc:call"]')), L('a job: the time and customer, then the phone (Call), addresses, crew size and truck'));
  } else ok(true, L('(no job later this month to tap)'));
  await tap('#view [data-act="cal:mon"][data-dir="1"]');
  const nm = new w.Date(new w.Date().getFullYear(), new w.Date().getMonth() + 1, 1);
  ok($('#view .cal-nav h2').textContent === nm.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) && T.ui.schedDay === iso(nm) && !!$('#view [data-act="cal:today"]'), L('› the next month, on its 1st, with Back to today'));
  await tap('#view [data-act="cal:today"]');
  ok(T.ui.schedDay === t && $('#view .cal-nav h2').textContent === month, L('Back to today'));
  // a booked job with no date yet
  const B = st().jobs.find((j) => j.status === 'booked' && j.d.moveDate !== t);
  const keepDate = B.d.moveDate; B.d.moveDate = ''; T.render(); await sleep(10);
  ok(/Booked, no date yet/.test(view()) && !!$('#view details.schedcard[data-job="' + B.id + '"]'), L('a booked job with no date shows under “Booked, no date yet”'));
  B.d.moveDate = keepDate; T.render(); await sleep(5);
  // Call: the same ask as everywhere (show or hide the number)
  const callable = $('#view [data-act="cc:call"]');
  if (callable) { click(callable); await sleep(10); ok(!$('#call').hidden && /Call and show my number/.test($('#call').textContent), L('Call asks how to call')); click('#call [data-act="call:close"]'); await sleep(5); }
  else ok(true, L('(nobody to call today)'));

  /* ---------------- Quotes ---------------- */
  await tap('[data-act="tab"][data-tab="quotes"]', 15);
  const openQ = st().jobs.filter((j) => j.status === 'lead' || j.status === 'quoted');
  ok($$('#ccList .qcard').length === openQ.length && openQ.length >= 2, L('Quotes: every open quote and lead (' + openQ.length + ')'));
  const ord = $$('#ccList .qcard').map((c) => c.dataset.job), want = openQ.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map((j) => j.id);
  ok(ord.join(',') === want.join(','), L('newest first'));
  const Q = st().jobs.find((j) => j.status === 'quoted' && j.d.phone);
  type('#ccQ', Q.d.name.split(' ')[0].toLowerCase()); await sleep(10);
  ok($$('#ccList .qcard').length >= 1 && $$('#ccList .qcard').every((c) => c.textContent.toLowerCase().indexOf(Q.d.name.split(' ')[0].toLowerCase()) >= 0), L('search by name'));
  type('#ccQ', Q.d.phone.replace(/\D/g, '').slice(-4)); await sleep(10);
  ok($$('#ccList .qcard').some((c) => c.dataset.job === Q.id), L('or by the last digits of the phone'));
  type('#ccQ', 'zzqx'); await sleep(10);
  ok(/Nothing matches “zzqx”/.test($('#ccList').textContent), L('nothing found says so'));
  type('#ccQ', ''); await sleep(10);
  const qc = $('#ccList .qcard[data-job="' + Q.id + '"]');
  ok(qc.textContent.indexOf('$') >= 0 && /Made (today|yesterday|\d+ days ago)/.test(qc.textContent), L('a quote shows its price and when it was made'));
  // Mark lost needs a second tap
  const LQ = st().jobs.find((j) => j.status === 'lead');
  await tap('#ccList [data-act="cc:lost"][data-id="' + LQ.id + '"]');
  ok(LQ.status === 'lead' && /Tap again: not moving with us/.test($('#ccList [data-act="cc:lost"][data-id="' + LQ.id + '"]').textContent), L('Mark lost asks for a second tap'));
  await tap('#ccList [data-act="cc:lost"][data-id="' + LQ.id + '"]');
  ok(LQ.status === 'lost' && LQ.log.slice(-1)[0].ev === 'Marked lost by Jess' && !$('#ccList .qcard[data-job="' + LQ.id + '"]'), L('marked lost: off the list, and the activity says who'));

  /* ---------------- changing a quote: no discount of her own ---------------- */
  Q.d.discount = '50'; Q.quote = T.calc(Q.d, st().settings);
  const was = Q.quote.total;
  await tap('#ccList [data-act="cc:open"][data-id="' + Q.id + '"]', 15);
  ok(T.ui.tab === 'quote' && st().draft.editId === Q.id && /Editing the quote for/.test(view()), L('Open quote: into the quote builder'));
  await tap('[data-act="q:step"][data-s="3"]');
  ok(!$('[data-d="discount"]') && /Adjust move type, crew, truck, hours$/.test($('[data-k="q:adj"] summary').textContent), L('the price step: crew, truck, hours and move type, no discount'));
  const cs = $('[data-d="crew"]'); cs.value = String((Q.quote.crew || 2) + 1); cs.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(5);
  st().draft.discount = '0';   // even if a discount got into the draft, it doesn't stick
  await tap('#qSave', 15);
  ok(Q.d.discount === '50' && Q.quote.lines.some((l) => l.label === 'Discount' && l.amt === -50) && Q.quote.total !== was && T.ui.tab === 'quotes' && /Saved\. It’s in Quotes\./.test(toast()), L('saved with the new crew, and the office’s $50 discount as it was'));
  // booking needs the date
  const qd = Q.d.moveDate;
  await tap('#ccList [data-act="cc:open"][data-id="' + Q.id + '"]', 15);
  type('[data-d="moveDate"]', ''); await sleep(5);
  await tap('[data-act="q:step"][data-s="3"]'); await tap('[data-act="q:book"]');
  ok(Q.status === 'quoted' && T.state().ui && /Pick the move date first, so it goes on the schedule\./.test(toast()) && T.ui.qstep === 1, L('Book job with no date: pick the date first'));
  const bd = day(9);
  type('[data-d="moveDate"]', bd); await sleep(5);
  const dn = $('#dayNote').textContent, BL = T.dayLoad(bd, null, Q.id);
  ok(dn.indexOf(fmtDate(bd) + ': ') === 0 && (BL.jobs ? /job/.test(dn) : /nothing booked yet\./.test(dn)), L('the date says how busy it is: ' + dn));
  await tap('[data-act="q:step"][data-s="3"]'); await tap('[data-act="q:book"]', 15);
  ok(Q.status === 'booked' && Q.log.slice(-1)[0].ev === 'Booked by Jess' && T.ui.tab === 'sched' && T.ui.schedDay === bd, L('booked: by Jess, and she’s on its day on the schedule'));
  ok(toast() === 'Booked for ' + fmtDate(bd) + ' at ' + (() => { const p = Q.d.time.split(':').map(Number); return ((p[0] + 11) % 12 + 1) + ':' + String(p[1]).padStart(2, '0') + (p[0] >= 12 ? ' PM' : ' AM'); })() + '. Dispatch adds the crew and trucks.', L('“' + toast() + '”'));
  ok(!!$('#view details.schedcard[data-job="' + Q.id + '"]') && !/\$/.test(view()), L('there it is, without its price'));
  void qd;

  /* ---------------- a new quote ---------------- */
  await tap('#fab', 15);
  ok(T.ui.tab === 'quote' && $$('#tabs button').find((b) => b.dataset.tab === 'quote') === undefined, L('the round button: a new quote'));
  type('[data-d="name"]', 'Dana Whit'); type('[data-d="phone"]', '512-555-0199');
  await tap('[data-act="q:step"][data-s="2"]'); click($$('[data-act="inc"]')[0]); await sleep(5);
  await tap('[data-act="q:step"][data-s="3"]'); await tap('#qSave', 15);
  const D = st().jobs.find((j) => j.d.name === 'Dana Whit');
  ok(!!D && D.status === 'quoted' && D.createdBy === 'Jess' && D.log.some((l) => l.ev === 'Created as Quoted by Jess') && T.ui.tab === 'quotes' && /by Jess/.test($('#ccList .qcard[data-job="' + D.id + '"]').textContent), L('saved: made by Jess, and in Quotes'));
  // a quote booked by the office meanwhile can't change here
  await tap('#ccList [data-act="cc:open"][data-id="' + D.id + '"]', 15);
  D.status = 'booked';
  await tap('[data-act="q:step"][data-s="3"]'); await tap('#qSave', 15);
  ok(T.ui.tab === 'quotes' && /booked or closed meanwhile/.test(toast()) && !st().draft.editId, L('a quote booked meanwhile can’t be changed from the call center'));
  T.openJob(Q.id); await sleep(5);
  ok(!T.ui.jobId && $('#sheet').hidden, L('and the office’s job sheet never opens for her'));
  click('[data-act="pv:end"]'); await sleep(15);

  /* ---------------- the office's side ---------------- */
  T.ui.jobId = D.id; T.render(); await sleep(10);
  ok(/Quote made by Jess \(call center\)/.test($('#sheet').textContent), L('the job sheet says who made the quote'));
  click('#sheet [data-act="sheet:close"].btn'); await sleep(5);
  T.ui.tab = 'chat'; T.render(); await sleep(10);
  ok(!/Jess/.test(view()), L('the call center isn’t in the office’s chat (it has none)'));
  T.ui.tab = 'settings'; T.ui.setSec = 'roles'; T.render(); await sleep(10);
  ok(/Five levels/.test(view()) && /Call center\s*Makes quotes and books them onto the schedule/.test(view()), L('Setup › Roles: five levels, the call center among them'));
  T.ui.setSec = 'employees'; T.render(); await sleep(10);
  ok(/Jess/.test(view()) && /Call center/.test(view()), L('Setup › Employees lists Jess as Call center'));
  T.dirApply({ name: 'Riley', role: 'callcenter', active: true, info: {} });
  ok(st().settings.callcenter.indexOf('Riley') >= 0 && st().settings.crew.indexOf('Riley') < 0 && !(st().settings.office || []).some((o) => o.name === 'Riley'), L('an employee made the call center goes on its list (not the crew or the office)'));
  T.dirApply({ name: 'Riley', role: 'crew', active: true, info: {} });
  ok(st().settings.callcenter.indexOf('Riley') < 0 && st().settings.crew.indexOf('Riley') >= 0, L('and moves to the crew when that changes'));
  const roleSel = $('#role');
  ok([...roleSel.options].some((o) => o.value === 'callcenter'), L('the role picker has Call center'));

  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
