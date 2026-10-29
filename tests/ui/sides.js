// The sides of the app each person sees, from switches on their profile (Richie, Oct 28: "In the employee profile it
// should have a set of switches to give access to different sides of the app . Like field view for crew members and
// leads , so off , crew or lead will be the 3 options for that switch . Then dispatch should be another switch . Then
// call center will be another switch ."; "The switches will dictate what the employee sees when they log in"; someone
// with more than one sees every tab their switches allow, together; the call center switch: "every company will have
// their own assigned call center person . Not to sure on this part so we are winging it"). The signed-in side, and the
// database's part, are in sides-hosted.js and tests/sql/callcenter.sh. Run: node tests/ui/sides.js <file> <label>
const { load, ok, sleep, summary } = require('./lib');
const file = process.argv[2] || __dirname + '/../../build/tally-artifact.html', label = process.argv[3] || 'sides';
const L = (m) => label + ': ' + m;

(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, T, go } = A;
  const st = () => T.state(), S = () => st().settings;
  const empText = () => ($('#emp') && !$('#emp').hidden ? $('#emp').textContent.replace(/\s+/g, ' ') : '');
  const toast = () => ($('#toast') && !$('#toast').hidden ? $('#toast').textContent : '');
  const tabs = () => $$('#tabs button').map((b) => b.textContent.replace(/\d+$/, '').trim()).filter(Boolean);
  const rowOf = (n) => $$('.emprow').find((r) => r.querySelector('.nm').textContent === n);
  const pills = (n) => Array.from(rowOf(n).querySelectorAll('.pill')).map((p) => p.textContent).filter((t) => t !== 'Drives').join(',');   // (Drives is the driver list's)
  const openEmp = async (n) => { click(rowOf(n)); await sleep(20); };
  const save = async () => { click('[data-act="emp:save"]'); await sleep(30); };
  const close = async () => { click('.sheet-head [data-act="emp:close"]'); await sleep(15); };
  const sides = () => ({ owner: !!($('[data-ak="owner"]') || {}).checked, field: ($$('[data-ak="field"]').find((x) => x.checked) || {}).value || '', dispatch: !!($('[data-ak="dispatch"]') || {}).checked, cc: !!($('[data-ak="cc"]') || {}).checked });
  const local = () => JSON.parse(w.localStorage.getItem('tally.employees.local') || '[]');
  const preview = async (role, staff) => { click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5); click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === role && b.dataset.staff === staff)); await sleep(25); };
  const end = async () => { click('[data-act="pv:end"]'); await sleep(15); };
  const type = (sel, v) => { const e = $(sel); e.value = v; e.dispatchEvent(new w.Event('input', { bubbles: true })); };

  /* ---------------- the switches on a profile ---------------- */
  await go('settings', 'employees');
  ok(pills('Tanya') === 'Crew lead' && pills('Dee') === 'Crew' && pills('Owner') === 'Owner', L('the list says what each person sees: ' + ['Owner', 'Tanya', 'Dee'].map((n) => n + ' ' + pills(n)).join(', ')));
  await openEmp('Tanya');
  ok(JSON.stringify(sides()) === JSON.stringify({ owner: false, field: 'lead', dispatch: false, cc: false }) && /What they see/.test(empText()) && !$('[data-ek="role"]'), L('Tanya’s profile: What they see, with Field view on Lead (no role list any more)'));
  ok(Array.from($$('[data-ak="field"]')).map((x) => x.value).join() === 'off,crew,lead' && $('[data-ak="dispatch"]').getAttribute('role') === 'switch' && !!$('[data-ak="dispatch"]').closest('.sw'), L('Field view: Off, Crew or Lead; Dispatch and Call center are switches'));
  click($('[data-ak="cc"]')); await sleep(10);
  ok(/Tanya sees: the jobs they’re on \(running them and billing out\) and the time clock; the schedule, Quotes and New quote, with no money or discounts\. All in one app\./.test(empText()) && $('#emp .sheet-head small').textContent === 'Crew lead · Call center', L('Call center on: it says what she’ll see, all in one app'));
  await save();
  ok(S().ccStaff.join() === 'Tanya' && S().crew.includes('Tanya') && S().leads.includes('Tanya') && toast() === 'Tanya added.', L('saved: still a lead in the field, and on the call center list'));
  let rec = local().find((e) => e.name === 'Tanya');
  ok(rec && rec.role === 'lead' && JSON.stringify(rec.info.access) === JSON.stringify({ owner: false, field: 'lead', dispatch: false, cc: true }), L('her profile keeps the switches, and the role the database goes by (lead)'));
  await close();
  await openEmp('Kim');
  click($('[data-ak="field"][value="off"]')); await sleep(10); click($('[data-ak="cc"]')); await sleep(10);
  ok(/Kim sees: the schedule, Quotes and New quote, with no money or discounts\./.test(empText()) && !/All in one app/.test(empText()), L('Kim: Field view off, Call center on'));
  await save(); await close();
  ok(!S().crew.includes('Kim') && S().ccStaff.join() === 'Tanya,Kim' && local().find((e) => e.name === 'Kim').role === 'crew', L('Kim leaves the crew list for the call center (the database still knows her as crew, with no jobs)'));
  await openEmp('Andre');
  click($('[data-ak="dispatch"]')); await sleep(10);
  ok(/Andre sees: the jobs they’re on and the time clock; Today, Jobs, the Board and quotes\. All in one app\./.test(empText()), L('Andre: crew in the field, and dispatch'));
  await save(); await close();
  ok(S().crew.includes('Andre') && S().office.some((o) => o.name === 'Andre' && o.kind === 'dispatch') && local().find((e) => e.name === 'Andre').role === 'dispatch', L('Andre is on the crew list and the office’s (the database: dispatch)'));
  await openEmp('Luis');
  click($('[data-ak="field"][value="off"]')); await sleep(10);
  ok(/With every side off, Luis sees nothing\. Turn one on, or turn off “Can use MoveCrew”\./.test(empText()), L('every side off: it says Luis would see nothing'));
  await save();
  ok(/Turn on at least one side for them \(Field view, Dispatch or Call center\), or turn off “Can use MoveCrew”\./.test(empText()) && S().crew.includes('Luis') && !local().some((e) => e.name === 'Luis'), L('and won’t save it that way'));
  $('[data-ek="active"]').checked = false; await save();
  ok(!S().crew.includes('Luis') && local().find((e) => e.name === 'Luis').active === false, L('with Can use MoveCrew off it saves: Luis is off every list'));
  $('[data-ek="active"]').checked = true; click($('[data-ak="field"][value="crew"]')); await sleep(10); await save(); await close();
  ok(S().crew.includes('Luis') && pills('Luis') === 'Crew', L('back on as crew'));
  await openEmp('Dee');
  click($('[data-ak="owner"]')); await sleep(10);
  ok(!$('[data-ak="dispatch"]') && !$('[data-ak="field"]') && /Dee sees: everything, Setup and the money included\./.test(empText()), L('Owner on: the other switches go, the owner sees everything'));
  click($('[data-ak="owner"]')); await sleep(10);
  ok(JSON.stringify(sides()) === JSON.stringify({ owner: false, field: 'crew', dispatch: false, cc: false }), L('off again: her switches are as they were'));
  await close();
  ok(pills('Tanya') === 'Crew lead,Call center' && pills('Kim') === 'Call center' && pills('Andre') === 'Crew,Dispatch', L('the list: ' + ['Tanya', 'Kim', 'Andre'].map((n) => n + ' ' + pills(n)).join(', ')));

  /* ---------------- what each person sees ---------------- */
  click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5);
  const ccChips = $$('#more [data-act="pv:set"][data-role="callcenter"]').map((b) => b.textContent);
  ok(ccChips.join(',') === 'Tanya,Kim,MoveCrew’s team', L('See it their way › Call center: the company’s own (' + ccChips.join(', ') + ')'));
  click('#more [data-act="more:close"]'); await sleep(5);
  await preview('callcenter', 'Tanya');
  ok(st().ui.role === 'lead' && tabs().join('|') === 'Jobs|Schedule|Quotes|Chat|More' && !$('#fab').hidden && T.ui.tab === 'crew', L('Tanya (picked from either row): her Jobs first, the Schedule, Quotes, Chat, and the round button for a new quote'));
  click('#fab'); await sleep(15);
  ok(T.ui.tab === 'quote' && $$('#tabs button').some((b) => /^New quote/.test(b.textContent)) === false, L('the round button: a new quote'));
  const dt = (() => { const d = new w.Date(); d.setDate(d.getDate() + 30); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  type('[data-d="name"]', 'Gina Ruiz'); type('[data-d="moveDate"]', dt);
  click('[data-act="q:step"][data-s="2"]'); await sleep(10); click($$('[data-act="inc"]')[0]); await sleep(10);
  click('[data-act="q:step"][data-s="3"]'); await sleep(15);
  ok(!$('[data-d="discount"]') && !!$('#dayPlan .tl') && !/Other companies/.test($('#dayPlan').textContent), L('her quote: no discount, the day’s slots, no other companies'));
  click('[data-act="q:book"]'); await sleep(10);
  ok(toast() === 'Put the move in a slot first: drag it onto one under the price, or tap one.', L('she books only in a slot'));
  click($('#dayPlan [data-act="dp:time"]')); await sleep(10);
  click('[data-act="q:book"]'); await sleep(20);
  const gina = st().jobs.find((j) => j.d.name === 'Gina Ruiz');
  ok(!!gina && gina.status === 'booked' && gina.createdCC === true && gina.log.some((l) => l.ev === 'Created as Booked by Tanya (call center)') && !gina.assign.truckId && gina.d.slots.length === 1 && T.ui.tab === 'sched' && /in slot \d\. Dispatch adds the truck and crew\.$/.test(toast()),
    L('booked by Tanya (call center), in a slot, no truck: “' + toast() + '”'));
  click('[data-act="tab"][data-tab="crew"]'); await sleep(15);
  ok(T.ui.tab === 'crew' && /Tanya/.test($('#view').textContent), L('and her Jobs are still hers'));
  await end();
  await preview('callcenter', 'Kim');
  ok(st().ui.role === 'callcenter' && tabs().join('|') === 'Schedule|Quotes|Chat|More' && !$('#fab').hidden && T.ui.tab === 'sched' && !$$('#tabs button').some((b) => /Companies/.test(b.textContent)), L('Kim: the Schedule, Quotes, Chat and the round button; no Companies (that’s MoveCrew’s team), no Jobs'));
  ok(!/\$/.test($('#view').textContent), L('and no money on her screens'));
  await end();
  await preview('callcenter', '');
  ok(st().ui.role === 'callcenter' && tabs().join('|') === 'Companies|Schedule|Quotes|More', L('MoveCrew’s team as before: Companies, Schedule, Quotes'));
  await end();
  await preview('crew', 'Andre');
  ok(st().ui.role === 'dispatch' && tabs().indexOf('Board') >= 0 && tabs().indexOf('Today') >= 0, L('Andre: the office’s tabs (dispatch takes in the field)'));
  T.ui.tab = 'crew'; T.render(); await sleep(15);
  ok(/Andre/.test(($('#view').textContent || '').slice(0, 400)), L('and the Field view opens on him'));
  await end();
  await preview('crew', 'Dee');
  ok(st().ui.role === 'crew' && tabs().join('|') === 'Jobs|Chat|More' && $('#fab').hidden, L('Dee, crew only: Jobs and Chat'));
  await end();

  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
