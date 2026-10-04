const { load, ok, sleep, summary } = require('./lib');
(async () => {
  const A = await load(__dirname + '/../../build/tally-artifact.html', {});
  const { $, $$, click, text, T } = A;
  const st = () => T.state();
  const before = st().jobs.length;
  const more = async (tab) => { click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:go"][data-tab="' + tab + '"]'); await sleep(20); };
  await more('settings');
  ok(!!$('[data-act="st:testpack"]') && !$('[data-act="st:rmtest"]'), 'Setup › Your data offers Add 3 weeks of test jobs');
  click('[data-act="st:testpack"]'); await sleep(5);
  ok(st().jobs.length === before, 'first tap only arms it');
  click('[data-act="st:testpack"]'); await sleep(20);
  const tj = st().jobs.filter((j) => j.test);
  ok(tj.length >= 80 && tj.length <= 130, 'added ' + tj.length + ' test jobs');
  ok(st().jobs.length === before + tj.length, 'real jobs kept');
  const today = new Date(); const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const t0 = iso(today), plus = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
  const dated = tj.filter((j) => j.d.moveDate);
  const minD = dated.map((j) => j.d.moveDate).sort()[0], maxD = dated.map((j) => j.d.moveDate).sort().pop();
  ok(minD >= plus(-7) && maxD <= plus(20) && dated.some((j) => j.d.moveDate > plus(14)), 'dates run from last week to three weeks out (' + minD + ' to ' + maxD + ')');
  ok(!dated.filter((j) => j.status !== 'lost' && j.d.moveDate !== t0).some((j) => new Date(j.d.moveDate + 'T12:00').getDay() === 0), 'no work on Sundays (except today, so there is always something to try)');
  const by = (f) => tj.filter(f).length;
  const stages = {
    paid: by((j) => j.status === 'paid'), 'done, balance due': by((j) => j.status === 'done' && j.payments.length && !j.signed.length === false),
    'done, waiting on signature': by((j) => j.status === 'done' && !j.signed.length), active: by((j) => j.status === 'active'),
    'booked + some confirmed': by((j) => j.status === 'booked' && Object.keys(j.confirm || {}).length), 'needs scheduling': by((j) => j.status === 'booked' && j.d.moveDate >= t0 && (!j.assign.truckId || !j.assign.crew.length)),
    quoted: by((j) => j.status === 'quoted'), lead: by((j) => j.status === 'lead'), lost: by((j) => j.status === 'lost'),
    'short job (min pay)': by((j) => j.actualHours === 1.2),
  };
  ok(Object.values(stages).every((n) => n > 0), 'every stage is there: ' + JSON.stringify(stages));
  const active = tj.find((j) => j.status === 'active');
  ok(active && active.d.moveDate === t0 && active.phases.loadStart && !active.phases.loadEnd, 'today has a job in progress, loading');
  const clashes = tj.filter((j) => T.state && ['booked', 'active'].includes(j.status)).filter((j) => {
    return tj.some((o) => o !== j && o.d.moveDate === j.d.moveDate && o.d.time === j.d.time && ['booked', 'active'].includes(o.status) && (o.assign.truckId && o.assign.truckId === j.assign.truckId || o.assign.crew.some((c) => j.assign.crew.includes(c))));
  });
  ok(clashes.length === 0, 'nobody and no truck is double-booked (' + clashes.length + ')');
  const people = st().settings.crew.concat((st().settings.office || []).map((o) => o.name));
  ok(tj.every((j) => j.assign.crew.every((c) => people.includes(c))), 'only the company’s own people are used');
  ok(tj.every((j) => /^503-555-01\d\d$/.test(j.d.phone || '503-555-0100')), 'phone numbers are the made-up 555-01xx range');
  ok(tj.filter((j) => j.status !== 'lead').every((j) => j.quote.total > 0), 'every job has a real price');
  // tags
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(20);
  ok($$('.job').some((b) => /Test/.test(b.textContent)), 'job list tags them Test');
  click('[data-act="job:open"][data-id="' + tj.find((j) => j.status === 'booked' && j.d.moveDate > t0 && j.assign.crew.length).id + '"]'); await sleep(20);
  ok(/Test/.test($('.sheet-head').textContent), 'job sheet tags it Test');
  click('#sheet [data-act="sh:next"]'); await sleep(15);
  ok(/Test job: this is what the customer would get\. Nothing is sent\./.test($('#start').textContent) && $('#start [data-act="go:start"]').tagName === 'BUTTON', 'starting a test job never opens a text to the made-up number');
  click('[data-act="go:close"]'); click('[data-act="sheet:close"]'); await sleep(10);
  // other screens cope with a full calendar
  click('[data-act="tab"][data-tab="dispatch"]'); await sleep(20);
  ok($$('.block').length >= 3, 'Board shows today’s jobs');
  await more('reports'); ok(/Time on the job by crew/.test(text()), 'Reports render with the test jobs');
  await more('crew'); ok($$('.crewcard').length >= 3, 'field view lists jobs for the crew member');
  // remove
  await more('settings');
  ok(/Remove the \d+ test jobs/.test($('[data-act="st:rmtest"]').textContent), 'Remove button says how many');
  click('[data-act="st:rmtest"]'); await sleep(5); click('[data-act="st:rmtest"]'); await sleep(20);
  ok(st().jobs.length === before && !st().jobs.some((j) => j.test), 'Remove takes out only the test jobs');
  // shared database: adding them texts nobody and saves them as test
  const ORG = 'org-1';
  const db = { docs: [{ org_id: ORG, path: 'meta/init', collection: 'meta', doc_id: 'init', data: { ts: 1 } }, { org_id: ORG, path: 'org/settings', collection: 'org', doc_id: 'settings', data: { company: 'Ace', crew: ['Marcus', 'Dee', 'Luis'], leads: ['Marcus'], office: [{ name: 'Owner', kind: 'owner' }], contacts: {}, forms: [], trucks: [{ id: 't26', name: 'Box 1', cf: 1700 }, { id: 't20', name: 'Box 2', cf: 1000 }] } }],
    access_requests: [], comm_log: [], comm_lines: [{ org_id: ORG, phone_number: '+15125550000', enabled: true }], members: [{ org_id: ORG, user_id: 'u-owner', email: 'o@x', staff: 'Owner', role: 'owner', ts: 1 }] };
  const H = await load(__dirname + '/../../build/tally-supabase.html', { db, org: ORG, me: { uid: 'u-owner', email: 'o@x' }, fnReply: () => ({ ok: true, sent: 0 }) });
  H.T.comms.SETTLE = 30;
  H.click('[data-act="more:open"]'); await sleep(5); H.click('[data-act="more:go"][data-tab="settings"]'); await sleep(20);
  H.click('[data-act="st:testpack"]'); await sleep(5); H.click('[data-act="st:testpack"]'); await sleep(1500);
  const saved = db.docs.filter((d) => d.collection === 'jobs');
  ok(saved.length >= 60 && saved.every((d) => d.data.test === true), 'shared: ' + saved.length + ' test jobs saved, each marked test');
  ok(H.calls.fn.filter((c) => ['job', 'eta', 'remind', 'forms'].includes(c.body.action)).length === 0, 'shared: adding them sends no texts');
  ok(A.errors.length === 0 && H.errors.length === 0, 'no errors (' + A.errors.concat(H.errors).slice(0, 3).join(' | ') + ')');
  process.exit(summary('test pack') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
