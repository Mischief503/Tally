// Drivers (Richie, Oct 15: "what about showing the drivers in the system so the dispatch knows they have a
// driver per truck on every job"): the owner marks who drives in Setup › Fleet and drivers; a job can hold
// several trucks, each with its driver; a truck without one makes the job need scheduling; the Board shows
// each truck's driver and who's free to drive; the crew's card and job message say who drives; Truck down
// starts on the truck you drive; the switch in Options turns it all off.
const { load, ok, sleep, summary } = require('./lib');
const file = process.argv[2] || __dirname + '/../../build/tally-artifact.html', label = process.argv[3] || 'drivers';
const L = (m) => label + ': ' + m;

(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, T, go } = A;
  const st = () => T.state(), S = () => st().settings;
  const J = (n) => st().jobs.find((j) => j.d.name === n);
  const pick = (sel, v) => { const el = typeof sel === 'string' ? $(sel) : sel; el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const toast = () => ($('#toast').hidden ? '' : $('#toast').textContent);
  const sheet = async (n) => { T.ui.jobId = J(n).id; T.render(); await sleep(10); };
  const close = async () => { T.ui.jobId = null; T.render(); await sleep(5); };
  const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();

  /* ---------------- the sample company ---------------- */
  ok(JSON.stringify(S().drivers) === JSON.stringify(['Marcus', 'Tanya', 'Luis', 'Andre']), L('the sample company has four drivers: ' + S().drivers.join(', ')));
  ok(J('Priya Nair').assign.drivers.t26 === 'Marcus' && J('Hollis & Reed Law').assign.drivers.t20 === 'Tanya', L('sample jobs have their drivers: Marcus on Priya Nair’s truck, Tanya on Hollis & Reed’s'));
  const NF = J('Nadia Farouk');
  ok(!Object.keys(NF.assign.drivers || {}).length && T.needsSched(NF), L('Nadia Farouk’s truck has no driver yet, so her job needs scheduling'));

  /* ---------------- Setup › Fleet and drivers ---------------- */
  await go('settings');
  ok(/Fleet and drivers/.test($('[data-sec="fleet"]').textContent) && /4 drivers/.test($('[data-sec="fleet"]').textContent), L('Setup lists Fleet and drivers, with 4 drivers'));
  await go('settings', 'fleet');
  const chips = $$('#view [data-act="st:driver"]');
  ok(chips.length >= 6 && chips.filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.dataset.n).join() === 'Marcus,Luis,Tanya,Andre', L('Who drives: a chip for everyone, the four drivers on'));
  click(chips.find((c) => c.dataset.n === 'Kim')); await sleep(5);
  ok(S().drivers.indexOf('Kim') >= 0 && /Kim drives/.test(toast()), L('tapping Kim makes her a driver: ' + toast()));
  click($$('#view [data-act="st:driver"]').find((c) => c.dataset.n === 'Kim')); await sleep(5);
  ok(S().drivers.indexOf('Kim') < 0, L('and tapping again takes her off'));
  await go('settings', 'employees');
  ok($$('#view .emprow').filter((r) => /Drives/.test(r.textContent)).length === 4, L('Employees: the four drivers are tagged Drives'));

  /* ---------------- the job sheet ---------------- */
  await sheet('Nadia Farouk');
  const dsel = $('#sheet select[data-drv="sh"]');
  ok(dsel && dsel.classList.contains('need') && /No driver for Box 2 \(20 ft\) yet/.test($('#sheet').textContent), L('Nadia’s sheet: the driver box is marked and says no driver yet'));
  const opts = Array.from(dsel.querySelectorAll('optgroup')).map((g) => g.label + ': ' + Array.from(g.querySelectorAll('option')).map((o) => o.value).join(','));
  ok(opts[0] === 'On this job: Marcus' && /^Add to the crew: /.test(opts[1] || '') && !/Kim|Dee/.test(opts.join()), L('the picker offers the drivers on the crew first, then other drivers; not Kim or Dee, who don’t drive: ' + opts.join(' | ')));
  pick(dsel, 'Andre'); await sleep(5);
  ok(NF.assign.drivers.t20 === 'Andre' && NF.assign.crew.indexOf('Andre') >= 0 && /Andre added to the crew, driving Box 2 \(20 ft\)/.test(toast()), L('picking Andre adds him to the crew and he drives: ' + toast()));
  ok(!T.needsSched(NF) && !$('#sheet select.need'), L('so the job no longer needs scheduling'));
  click($$('#sheet [data-act="sh:crew"]').find((c) => c.dataset.n === 'Andre')); await sleep(5);
  ok(!NF.assign.drivers.t20 && T.needsSched(NF) && /Pick someone else to drive/.test(toast()), L('taking Andre off the crew leaves the truck without a driver: ' + toast()));
  pick('#sheet select[data-drv="sh"]', 'Marcus'); await sleep(5);
  ok(NF.assign.drivers.t20 === 'Marcus' && NF.assign.crew.join() === 'Marcus,Kim', L('Marcus, already on the crew, drives'));
  await close();

  // a second truck for a big move
  const PN = J('Priya Nair');
  await sheet('Priya Nair');
  click('#sheet [data-act="trk:add"]'); await sleep(5);
  ok(T.jobTrucks(PN).join() === 't26,t20' && PN.assign.more.join() === 't20' && PN.assign.truckId === 't26', L('Add another truck puts Box 2 on the job as truck 2'));
  ok(PN.assign.drivers.t20 === 'Luis' && /Box 2 \(20 ft\) added\. Luis driving/.test(toast()), L('Luis, the one driver on the crew not driving yet, takes it: ' + toast()));
  ok($$('#sheet select[data-trk="sh"]').length === 2 && $$('#sheet select[data-drv="sh"]').length === 2, L('the sheet shows two trucks, each with a driver'));
  ok(!Array.from($$('#sheet select[data-trk="sh"]')[1].options).some((o) => o.value === 't26'), L('truck 2’s list leaves out the truck already on the job'));
  pick($$('#sheet select[data-drv="sh"]')[1], 'Marcus'); await sleep(5);
  ok(/Marcus \(now on Box 1 \(26 ft\)\)/.test($$('#sheet select[data-drv="sh"]')[1].textContent) || PN.assign.drivers.t20 === 'Marcus', L('truck 2’s list shows Marcus is on Box 1 now'));
  ok(PN.assign.drivers.t20 === 'Marcus' && PN.assign.drivers.t26 === 'Luis' && /Marcus driving Box 2 \(20 ft\)\. Luis driving Box 1 \(26 ft\)\./.test(toast()), L('one person drives one truck: picking Marcus for truck 2 swaps them, Luis to truck 1: ' + toast()));
  pick($$('#sheet select[data-drv="sh"]')[0], ''); await sleep(5);
  ok(T.needsSched(PN) && T.trucksNoDriver(PN).join() === 't26' && /No driver for Box 1/.test(toast()), L('clearing truck 1’s driver on purpose leaves it empty (nobody is filled back in)'));
  pick($$('#sheet select[data-drv="sh"]')[0], 'Luis'); await sleep(5);
  pick($$('#sheet select[data-trk="sh"]')[1], 't16'); await sleep(5);
  ok(T.jobTrucks(PN).join() === 't26,t16' && PN.assign.drivers.t16 === 'Marcus' && !PN.assign.drivers.t20, L('swapping truck 2 for the van keeps its driver'));
  ok(T.conflictsFor(PN).length === 0, L('no clash: the van is free today'));
  pick($$('#sheet select[data-trk="sh"]')[1], ''); await sleep(5);
  ok(T.jobTrucks(PN).join() === 't26' && !PN.assign.drivers.t16 && PN.assign.drivers.t26 === 'Luis', L('taking truck 2 off leaves Box 1 and its driver'));
  await close();

  // a truck on two jobs at once is a clash, whichever slot it's in
  const HR = J('Hollis & Reed Law');
  HR.assign.truckId = 't16'; HR.assign.more = ['t20']; HR.assign.drivers = { t16: 'Tanya', t20: 'Andre' };
  ok(T.conflictsFor(NF).some((c) => /Box 2/.test(c.what) && c.other === HR), L('a second truck on another job at the same time is a clash'));
  HR.assign.truckId = 't20'; HR.assign.more = []; HR.assign.drivers = { t20: 'Tanya' };

  /* ---------------- the Board ---------------- */
  T.ui.tab = 'dispatch'; T.ui.day = tomorrow; T.ui.weekStart = (() => { const d = new Date(tomorrow + 'T12:00:00'); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  NF.assign.drivers = {}; T.render(); await sleep(10);
  const need = $('[data-k="d:need"]');
  ok(need && /Nadia Farouk/.test(need.textContent) && /Missing a driver for Box 2 \(20 ft\)/.test(need.textContent) && need.querySelector('select[data-drv="dq"]'), L('Board › Needs scheduling: Nadia is missing a driver, with the picker right there'));
  const lane = $$('#view .lane').find((l) => /Box 2 \(20 ft\)/.test(l.querySelector('.lh').textContent));
  ok(lane && /Driver: Tanya/.test(lane.textContent) && /No driver/.test(lane.textContent), L('Box 2’s lane: Hollis & Reed with Driver: Tanya, Nadia with No driver'));
  ok(/Drivers free: Luis of 4/.test($('#view').textContent), L('the day’s line says which drivers are free: Luis of 4'));
  pick(need.querySelector('select[data-drv="dq"]'), 'Marcus'); await sleep(10);
  ok(NF.assign.drivers.t20 === 'Marcus' && !$('[data-k="d:need"]') && T.ui.tab === 'dispatch', L('picking Marcus there schedules her, and the Board stays'));

  /* ---------------- Today and Jobs ---------------- */
  PN.assign.drivers = {}; click('[data-act="tab"][data-tab="today"]'); await sleep(10);
  const row = $$('#view .job').find((b) => /Priya Nair/.test(b.textContent));
  ok(row && /No driver/.test(row.textContent), L('Today: Priya Nair’s row says No driver'));
  ok($$('#view .alert').some((a) => /1 job needs? scheduling/.test(a.textContent) && /Priya Nair/.test(a.textContent)), L('and Needs you counts her as needing scheduling'));
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
  ok(/No driver/.test($$('#view .job').find((b) => /Priya Nair/.test(b.textContent)).textContent), L('Jobs: the same badge'));
  PN.assign.drivers = { t26: 'Marcus' }; T.render(); await sleep(5);

  /* ---------------- the crew ---------------- */
  PN.assign.truckId = 't26'; PN.assign.more = ['t20']; PN.assign.drivers = { t26: 'Marcus', t20: 'Luis' };
  click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5);
  click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === 'lead' && b.dataset.staff === 'Marcus')); await sleep(15);
  click('[data-act="tab"][data-tab="crew"]'); await sleep(10);
  const trucksOn = () => { const c = $('#view .crewcard[data-job="' + PN.id + '"]'); return c ? Array.from(c.querySelectorAll('.cc-truck')).map((d) => d.textContent).join(' | ') : 'no card'; };
  const crewOn = () => { const c = $('#view .crewcard[data-job="' + PN.id + '"]'); return c ? (Array.from(c.querySelectorAll('.cc-sub')).find((d) => /^Crew: /.test(d.textContent)) || {}).textContent : ''; };
  ok(trucksOn() === 'Truck: Box 1 (26 ft), you drive | Truck: Box 2 (20 ft), Luis drives', L('Marcus’s card: a line for each truck, with who drives: ' + trucksOn()));
  ok(/^Crew: Marcus \(lead\), Dee, Luis$/.test(crewOn()), L('and everyone on the job: ' + crewOn()));
  click('[data-act="tab"][data-tab="chat"]'); await sleep(10);
  click('[data-act="chat:open"][data-t="jobs"]'); await sleep(10);
  const msg = $$('.jmsg').find((m) => /Priya Nair/.test(m.textContent));
  ok(msg && /Trucks: Box 1 \(26 ft\), you drive · Box 2 \(20 ft\), Luis drives/.test(msg.textContent), L('his job message lists both trucks and who drives'));
  click('[data-act="pv:end"]'); await sleep(15);
  // Richie, Oct 21: "When dispatched with more than 1 truck the crew should see both trucks being used and all crew mates"
  click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5);
  click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === 'crew' && b.dataset.staff === 'Dee')); await sleep(15);
  ok(trucksOn() === 'Truck: Box 1 (26 ft), Marcus drives | Truck: Box 2 (20 ft), Luis drives' && /^Crew: Marcus \(lead\), Dee, Luis$/.test(crewOn()), L('Dee, who drives neither, sees both trucks, both drivers and all her crewmates: ' + trucksOn()));
  click('[data-act="pv:end"]'); await sleep(15);

  /* ---------------- Job history finds every truck ---------------- */
  PN.status = 'paid'; PN.d.moveDate = '2026-01-05';
  T.ui.tab = 'history'; T.ui.hq = 'van'; T.render(); await sleep(10);
  PN.assign.more = ['t16']; T.render(); await sleep(10);
  ok($$('#view [data-act="hist:open"],#view [data-act="job:open"]').some((b) => b.dataset.id === PN.id), L('searching Job history for “van” finds a job whose second truck was the van'));
  PN.status = 'booked'; PN.d.moveDate = today; PN.assign.more = []; T.ui.hq = ''; T.ui.tab = 'today'; T.render(); await sleep(5);

  /* ---------------- the switch ---------------- */
  S().opt = Object.assign({}, S().opt, { drivers: false }); PN.assign.drivers = {}; T.render(); await sleep(5);
  ok(!T.needsSched(PN), L('switched off: no driver needed to be scheduled'));
  await sheet('Priya Nair');
  ok(!$('#sheet select[data-drv]') && /Trucks/.test($('#sheet').textContent) && !/and drivers/.test($('#sheet').textContent), L('the sheet keeps its trucks but has no driver boxes'));
  await close();
  await go('settings', 'fleet');
  ok(!$('#view [data-act="st:driver"]') && !/Who drives/.test($('#view').textContent), L('and Setup hides Who drives'));
  delete S().opt.drivers;

  /* ---------------- a company that hasn't picked drivers yet ---------------- */
  S().drivers = [];
  ok(T.canDrive('Dee') && T.canDrive('Kim'), L('with nobody on the list, anyone can drive'));
  await sheet('Priya Nair');
  const any = Array.from($('#sheet select[data-drv="sh"]').querySelectorAll('optgroup')).map((g) => g.label + ': ' + Array.from(g.querySelectorAll('option')).map((o) => o.value).join(','));
  ok(any.length === 1 && /^On this job: Marcus,Dee,Luis$/.test(any[0]), L('the picker lists the whole crew: ' + any.join(' | ')));
  await close();

  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
