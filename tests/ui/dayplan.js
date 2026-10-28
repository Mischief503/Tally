// The day plan: lining a move up in a slot of the day (Richie, Oct 25: "each truck represents a crew slot and they can
// book to that but then top number of movers needs to be in there per truck and available for dispatch"; "as many as they
// can complete in like 12 hrs but maybe 4 tops per truck if all addresses are close and they can get them done . I feel
// like booking should see a timeline for each truck slot"; "if it can fit on a truck slot timeline for the day then it
// works if not than they should suggest another day or switch companys"; "if the job calls for 5 movers 1 truck then it
// should say that in scheduling"; the office marks days off; then "Call center doent actually assign the truck . They line
// up the day depending on length and distance . But the call center is a real person so it should be something they look
// and drag and drop to a slot . Dispatch selects the truck and crew members." and "If its a 2 truck it takes up 2 slots for
// that amount of time"). Dragging in a real browser is dayplan-drag.js; the hosted call center's side is in
// callcenter-hosted.js. Run against either edition: node tests/ui/dayplan.js <file> <label>
const { load, ok, sleep, summary, clone } = require('./lib');
const file = process.argv[2] || __dirname + '/../../build/tally-artifact.html', label = process.argv[3] || 'dayplan';
const L = (m) => label + ': ' + m;

(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, T, go } = A;
  const st = () => T.state(), S = () => st().settings;
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const addDays = (day, n) => { const d = new w.Date(day + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); };
  const fmtDate = (day) => new w.Date(day + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const toast = () => ($('#toast') && !$('#toast').hidden ? $('#toast').textContent : '');
  const plan = () => ($('#dayPlan') ? $('#dayPlan').textContent.replace(/\s+/g, ' ') : '');
  const view = () => $('#view').textContent.replace(/\s+/g, ' ');
  const type = (sel, v) => { const e = typeof sel === 'string' ? $(sel) : sel; e.value = v; e.dispatchEvent(new w.Event('input', { bubbles: true })); e.dispatchEvent(new w.Event('change', { bubbles: true })); };
  // days with nothing on them: a Monday, the Tuesday after it (when the sample Bluebonnet has no trucks booked), a Wednesday, a Thursday and a Friday
  const D1 = (() => { for (let i = 22; i < 30; i++) { const d = addDays(iso(new w.Date()), i); if (new w.Date(d + 'T12:00').getDay() === 2) return d; } })();
  const D = addDays(D1, -1), D2 = addDays(D1, 1), D3 = addDays(D1, 2), D4 = addDays(D1, 3);
  ok(T.schedRecs().every((r) => [D, D1, D2, D3, D4, addDays(D1, 4)].indexOf(r.d.moveDate) < 0), L('days with nothing booked: ' + [D, D1, D2, D3, D4].map(fmtDate).join(', ')));
  const tid = (name) => S().trucks.find((t) => t.name.indexOf(name) === 0).id;
  const VAN = tid('Van'), BOX2 = tid('Box 2'), BOX1 = tid('Box 1');
  const base = st().jobs.find((j) => j.status === 'booked');
  let seq = 0;
  const mk = (name, day, time, hours, crew, truckId, slots) => {
    const j = clone(base); j.id = 'dp' + (++seq); j.status = 'booked'; j.startedAt = 0; j.log = []; j.signed = []; j.payments = [];
    j.d = Object.assign(j.d, { name, moveDate: day, time, slots: slots || [] });
    j.quote = Object.assign(j.quote, { hours, crew, kind: 'local', driveH: 0, truckId: truckId || VAN, nTrucks: 1 });
    j.assign = { truckId: truckId || '', more: [], crew: [] };
    st().jobs.push(j); return j;
  };

  /* ---------------- the slots: a truck's day ---------------- */
  let P = T.planDay(D, T.schedRecs(), S());
  ok(P.trucks.map((t) => t.id).join() === [VAN, BOX2, BOX1].join() && T.slotNo(S(), VAN) === 1 && T.slotNo(S(), BOX1) === 3 && P.trucks.every((t) => P.lanes[t.id].length === 0) && P.cfg.start === 420 && P.cfg.hours === 12 && P.cfg.jobs === 4 && P.cfg.gap === 60 && P.movers.n === 6,
    L('an empty day: a slot per truck, smallest first, each empty, from 7:00 AM for 12 hours, 4 moves at most, an hour between, 6 movers on'));
  const need = (o) => T.needOf(Object.assign({ hours: 3, crew: 2, truckId: VAN, nTrucks: 1, kind: 'local' }, o), S());
  ok(JSON.stringify(need({})) === JSON.stringify({ hours: 3, crew: 2, trucks: 1, cf: 800 }), L('what a move needs: its hours, its movers, its trucks and how big (the quoted truck’s size)'));
  ok(need({ kind: 'mileage', driveH: 1.5 }).hours === 4.5 && need({ truckId: '', cf: 2400, nTrucks: 2 }).cf === 1200 && need({ truckId: '', cf: 2400, nTrucks: 2 }).trucks === 2, L('a mileage move counts the drive in; a two-truck move needs two of half its load each'));
  const at = (h) => T.hmMin(h);
  const why = (P0, nd, h) => { const f = T.fitAt(P0, nd, at(h)); return f.ok ? 'ok:' + f.trucks.join('+') : f.why; };
  ok(why(P, need({}), '06:30') === 'early' && why(P, need({}), '16:30') === 'late' && why(P, need({}), '16:00') === 'ok:' + VAN && why(P, need({ truckId: BOX1 }), '08:00') === 'ok:' + BOX1,
    L('a slot free at a time: before 7:00 AM is too early; a 3-hour move from 4:30 PM would end after 7:00 PM; from 4:00 PM, the smallest slot big enough'));
  ok(why(P, Object.assign(need({}), { cf: 2000 }), '08:00') === 'size' && why(P, Object.assign(need({}), { trucks: 4 }), '08:00') === 'size', L('no slot big enough, or not that many'));
  const a1 = mk('Alpha Co', D, '08:00', 3, 3, BOX2), b1 = mk('Bravo Co', D, '12:00', 3, 2, BOX1);
  P = T.planDay(D, T.schedRecs(), S());
  ok(P.lanes[BOX2].map((b) => b.r.id).join() === a1.id && P.lanes[BOX1].map((b) => b.r.id).join() === b1.id && !P.lanes[VAN].length, L('jobs with trucks (dispatch’s) in those trucks’ slots'));
  const n2 = need({ truckId: BOX2 });   // Box 2's size: slot 2 or 3
  ok(why(P, n2, '08:00') === 'ok:' + BOX1 && why(P, n2, '09:00') === 'busy' && why(P, n2, '11:30') === 'busy' && why(P, n2, '12:00') === 'ok:' + BOX2,
    L('slot 2 has Alpha from 8 to 11: at 8 slot 3 is free (done by 11, an hour before Bravo); at 9 it hasn’t that hour; at 11:30 slot 2 hasn’t its hour after Alpha; at 12 it has'));
  const fm = T.fitAt(P, need({ crew: 4 }), at('09:00'));
  ok(fm.why === 'movers' && fm.busy === 3 && why(P, need({ crew: 3 }), '09:00') === 'ok:' + VAN, L('the movers: with Alpha’s 3 out, 4 more at 9:00 would be 7 of 6; 3 more fit'));
  // put in a slot (dragged, or the slot tapped)
  const inn = (P0, nd, h, ids) => { const f = T.fitIn(P0, nd, at(h), ids); return f.ok ? 'ok:' + f.trucks.join('+') : f.why + (f.lane ? '@' + f.lane : ''); };
  ok(inn(P, n2, '09:00', [VAN]) === 'small@' + VAN && inn(P, n2, '09:00', [BOX2]) === 'taken@' + BOX2 && inn(P, n2, '13:00', [BOX2]) === 'ok:' + BOX2 && inn(P, n2, '09:00', []) === 'noslot' && inn(P, n2, '06:00', [BOX1]) === 'early',
    L('put in a slot: slot 1 is too small for Box 2’s load; slot 2 is taken at 9 (Alpha); from 1:00 PM it fits; none picked; too early'));
  const two = { hours: 3, crew: 2, trucks: 2, cf: 800 };
  ok(inn(P, two, '07:00', [VAN]) === 'ok:' + VAN + '+' + BOX1 && inn(P, two, '16:00', [BOX1]) === 'ok:' + BOX1 + '+' + BOX2 && inn(P, two, '09:00', [VAN]) === 'slots@' + VAN,
    L('a move of two trucks takes two slots for its time: put in slot 1 at 7, slot 3 with it (slot 2 has Alpha); in slot 3 at 4 PM, slot 2 beside it; at 9 only one is free'));
  ok(T.fitWhy({ why: 'taken', lane: BOX2 }, P, n2, at('09:00')) === 'Slot 2 has Alpha Co from 8:00 AM to 11:00 AM, and 60 minutes between moves.' && T.fitWhy({ why: 'small', lane: VAN }, P, n2, at('09:00')) === 'Slot 1 is for loads up to 800 cu ft, and this one needs a truck of 1,000 cu ft. Try a bigger slot.' && T.fitWhy({ why: 'slots', lane: VAN }, P, two, at('09:00')) === 'It takes 2 slots for its time, and no other slot big enough is free then.',
    L('the words: “' + T.fitWhy({ why: 'taken', lane: BOX2 }, P, n2, at('09:00')) + '”'));
  S().truckDay.jobs = 1; P = T.planDay(D, T.schedRecs(), S());
  ok(why(P, n2, '16:00') === 'busy' && why(P, need({}), '16:00') === 'ok:' + VAN && inn(P, n2, '16:00', [BOX2]) === 'full@' + BOX2, L('a slot’s most moves (set to 1): slots 2 and 3 have theirs (“' + T.fitWhy({ why: 'full', lane: BOX2 }, P, n2, at('16:00')) + '”), slot 1 is free'));
  S().truckDay.jobs = 4; S().truckDay.gap = 0; P = T.planDay(D, T.schedRecs(), S());
  ok(why(P, n2, '11:00') === 'ok:' + BOX2, L('no time between moves: slot 2 takes one from 11:00, as Alpha ends'));
  S().truckDay.gap = 60; S().truckDay.start = '06:00'; S().truckDay.hours = 10; P = T.planDay(D, T.schedRecs(), S());
  ok(why(P, need({}), '06:30') === 'ok:' + VAN && why(P, need({}), '13:30') === 'late' && why(P, need({}), '13:00') === 'ok:' + VAN, L('a day from 6:00 AM for 10 hours: 6:30 fits, and a 3-hour move from 1:30 PM would end after 4:00 PM'));
  S().truckDay.start = '07:00'; S().truckDay.hours = 12; P = T.planDay(D, T.schedRecs(), S());
  const ft = T.fitTimes(P, n2).map((f) => T.minHm(f.s));
  ok(ft[0] === '07:00' && ft.indexOf('08:00') >= 0 && ft.indexOf('08:30') < 0 && ft.indexOf('12:00') >= 0 && ft[ft.length - 1] === '16:00', L('every half hour with a slot free: ' + ft.join(' ')));
  // jobs lined up in slots, with no truck yet; and one in no slot
  const s1 = mk('Slotted Co', D4, '08:00', 3, 2, '', [BOX2]), s2 = mk('Loose Co', D4, '08:00', 3, 2, '');
  const P4 = T.planDay(D4, T.schedRecs(), S());
  const b4 = (j) => P4.blocks.find((b) => b.r.id === j.id);
  ok(b4(s1).slotted && b4(s1).lanes.join() === BOX2 && b4(s2).placed && b4(s2).lanes.join() === VAN, L('a job lined up in slot 2 sits there (no truck yet); one in no slot sits in the first free'));
  // a day with slots 2 and 3 booked all day
  mk('Charlie Co', D1, '07:00', 12, 2, BOX2); mk('Delta Co', D1, '07:00', 12, 2, BOX1);
  const P1 = T.planDay(D1, T.schedRecs(), S());
  const nx = T.nextRoom(D1, n2, T.schedRecs(), S(), '', 2);
  ok(!T.fitTimes(P1, n2).length && why(P1, need({}), '07:00') === 'ok:' + VAN && nx.length === 2 && nx[0].day === D2 && T.minHm(nx[0].s) === '07:00' && nx[1].day === D3,
    L('slots 2 and 3 booked all day: no time for Box 2’s size (slot 1 still has room), and the next days with room are ' + nx.map((o) => o.day + ' ' + T.minHm(o.s)).join(', ')));

  /* ---------------- the movers on a day ---------------- */
  S().daysOff[D] = ['Kim', 'Luis', 'Kim', 'Zed'];
  const M = T.moversOn(D, S());
  ok(M.n === 4 && M.all === 6 && M.off === 2 && M.who.join() === 'Kim,Luis', L('Kim and Luis off: 4 of 6 on (a name twice counts once; someone not on the crew not at all)'));
  ok(T.moversOn(D, { movers: { n: 5, off: { [D]: 2 } }, crew: [] }).n === 3 && T.moversOn(D, { crew: [] }) === null && T.moversOn(D, { movers: { n: 5, off: { [D]: 9 } } }).n === 0,
    L('a rate card copy: its counts (5, 2 off: 3 on) come before an empty crew list; neither: the slots alone decide'));
  P = T.planDay(D, T.schedRecs(), S());
  ok(why(P, need({}), '09:00') === 'movers' && why(P, need({}), '11:00') === 'ok:' + VAN, L('4 movers on: Alpha’s 3 and 2 more is too many at 9:00; from 11:00 there are 4 with Bravo’s 2'));
  const rc = T.rateCardOf(S());
  ok(rc.movers.n === 6 && rc.movers.off[D] === 2 && rc.truckDay.jobs === 4 && !('crew' in rc) && !('daysOff' in rc) && !/\b(Kim|Luis|Marcus|Dee|Tanya|Andre)\b/.test(JSON.stringify(rc)),
    L('the rate card copy for the call center: each truck’s day and the movers counted (6, 2 off), never who'));

  /* ---------------- how busy a day is ---------------- */
  const Ld = T.dayLoad(D);
  ok(Ld.jobs === 2 && Ld.fleet === 3 && Ld.open === 3 && Ld.lvl === 1 && T.loadWords(Ld) === '2 jobs booked, room in 3 of 3 slots' && T.availWords(Ld) === '3 of 3 open', L('Monday: ' + T.loadWords(Ld)));
  let L1 = T.dayLoad(D1);
  ok(L1.open === 1 && L1.lvl === 2 && T.loadWords(L1) === '2 jobs booked, room in 1 of 3 slots', L('Tuesday: ' + T.loadWords(L1) + ' (half or fewer)'));
  mk('Echo Co', D1, '07:00', 12, 2, VAN);
  L1 = T.dayLoad(D1);
  ok(L1.open === 0 && L1.lvl === 3 && T.loadWords(L1) === '3 jobs booked, no room left' && T.availWords(L1) === 'Full', L('slot 1 booked all day too: ' + T.loadWords(L1)));
  S().daysOff[D2] = S().crew.slice();
  let L2 = T.dayLoad(D2);
  ok(L2.jobs === 0 && L2.lvl === 3 && T.loadWords(L2) === 'nothing booked, but no movers on' && T.availWords(L2) === 'No movers on', L('everyone off on Wednesday: ' + T.loadWords(L2)));
  S().daysOff[D2] = S().crew.slice(1);
  L2 = T.dayLoad(D2);
  ok(L2.lvl === 3 && T.loadWords(L2) === 'nothing booked, but only 1 mover on', L('one on: ' + T.loadWords(L2)));
  delete S().daysOff[D2];
  ok(T.dayLoad(D2).lvl === 0 && T.loadWords(T.dayLoad(D2)) === 'nothing booked yet', L('everyone back: nothing booked yet'));

  /* ---------------- the office: the slots under the price ---------------- */
  const item = S().catalog.find((i) => i.cf > 0 && i.cf < 60);
  const quote = async (o) => {
    st().draft = Object.assign({ name: 'Pat Doe', phone: '', email: '', source: 'Google', moveDate: D, time: '09:00', from: '1 A St, Austin', to: '2 B St, Austin', miles: '', milesOut: '', milesBack: '', flights: '', pack: false, crew: '2', truckId: VAN, hoursOverride: '3', discount: '', notes: '', custom: {}, items: { [item.id]: 2 }, editId: '', moveKind: '', slots: [] }, o);
    T.ui.tab = 'quote'; T.ui.qstep = 3; T.ui.armed = ''; T.render(); await sleep(15);
  };
  const lanes = () => $$('#dayPlan .tl-row').filter((r) => r.querySelector('.tl-track[data-lane]'));
  const laneOf = (n) => lanes().find((r) => r.querySelector('.tl-name b').textContent === 'Slot ' + n);
  // tapping a slot where the move should start: the slot is laid out 720 px wide for the day's 720 minutes
  const tapSlot = async (n, hm) => { const tr = laneOf(n).querySelector('.tl-track'); tr.getBoundingClientRect = () => ({ left: 0, top: 0, width: 720, height: 46, right: 720, bottom: 46 }); tr.dispatchEvent(new w.MouseEvent('click', { bubbles: true, clientX: at(hm) - 420, clientY: 20 })); await sleep(15); };
  await quote({});
  ok(!!$('#dayPlan .tl') && lanes().length === 3 && laneOf(1) && /up to 800 cu ft/.test(laneOf(1).textContent) && /0 of 4 moves/.test(laneOf(1).textContent) && laneOf(1).querySelector('.tl-name').getAttribute('title') === 'Van (16 ft)',
    L('under the price, the day: a slot for each truck, how big a load it takes and its moves'));
  const blk = laneOf(2).querySelector('.tl-job');
  ok(!!blk && /^8–11 Alpha Co$/.test(blk.querySelector('b').textContent) && blk.querySelector('small').textContent === '3 movers' && /8:00 AM–11:00 AM · Alpha Co · 3 movers/.test(blk.getAttribute('title')),
    L('each move a block in its slot: “' + (blk && blk.textContent) + '”'));
  click(blk); await sleep(5);
  ok(toast() === '8:00 AM–11:00 AM · Alpha Co · 3 movers', L('tapped, it says what it is (no hover on a phone)'));
  ok(/3 slots · 4 movers on, 2 off \(Kim, Luis\)/.test(plan()) && /This move: 3 h · 2 movers · a slot for 800 cu ft or more\./.test(plan()), L('the office sees who’s off; and what this move needs'));
  const tray = $('#dayPlan .tl-tray');
  ok(!!tray && /This move\s*3 h · 2 movers/.test(tray.textContent) && !!tray.querySelector('.tl-drag[data-act="dp:grab"]') && /^9–12 Pat Doe$/.test(tray.querySelector('.tl-drag b').textContent) && !$$('#dayPlan .tl-track[data-lane] .tl-new').length,
    L('the move sits above the slots, at the time asked for, to be dragged into one'));
  ok(/Drag the move onto a slot, or tap a slot where it should start\./.test(plan()) && $('#dayPlan .dp-msg.no').textContent === 'At 9:00 AM: 5 movers would be busy then, and 4 movers are on that day.', L('“' + $('#dayPlan .dp-msg.no').textContent + '”'));
  const chipT = () => $$('#dayPlan [data-act="dp:time"]').map((b) => b.textContent);
  ok(chipT().join(',') === '11:00 AM · slot 1,12:00 PM · slot 1,1:00 PM · slot 1,2:00 PM · slot 1,3:00 PM · slot 1,4:00 PM · slot 1' && /Times with a slot free/.test(plan()), L('the times with a slot free, an hour apart: ' + chipT().join(', ')));
  const cells = $$('#dayPlan .tl-cells span');
  ok(cells.length === 12 && cells.map((c) => c.textContent).slice(0, 9).join(',') === '0,3,3,3,0,2,2,2,0' && !$('#dayPlan .tl-cells span.n') && /of 4 on/.test(plan()), L('the movers busy each hour: ' + cells.map((c) => c.textContent).join(' ')));
  click($('#dayPlan .tl-drag')); await sleep(5);
  ok(toast() === 'Drag it onto a slot, or tap a slot where it should start.', L('tapping the move says how to place it'));
  // Book job with it in no slot, and no slot free then: the office is asked
  const nJobs = st().jobs.length;
  click('[data-act="q:book"]'); await sleep(15);
  ok(st().jobs.length === nJobs && toast() === 'No slot is free for it then. Tap Book anyway to book it.' && $('[data-act="q:book"]').textContent === 'Book anyway', L('Book job: “' + toast() + '” and the button says Book anyway'));
  // a slot tapped: too small, taken, then one with room
  await quote({ name: 'Pat Doe', truckId: BOX2 });
  await tapSlot(1, '11:00');
  ok(st().draft.slots.join() === VAN && st().draft.time === '11:00' && /Slot 1 is for loads up to 800 cu ft, and this one needs a truck of 1,000 cu ft\. Try a bigger slot\./.test(plan()) && !!laneOf(1).querySelector('.tl-new.bad'), L('Box 2’s load in slot 1: too small, shown red'));
  await tapSlot(2, '09:10');
  ok(st().draft.time === '09:15' && st().draft.slots.join() === BOX2 && /Slot 2 has Alpha Co from 8:00 AM to 11:00 AM, and 60 minutes between moves\./.test(plan()), L('slot 2 tapped at 9:10: to the quarter hour, 9:15, and Alpha is there'));
  click($('#dayPlan [data-act="dp:unslot"]')); await sleep(10);
  ok(!st().draft.slots.length && !!$('#dayPlan .tl-tray'), L('Take it out: back above the slots'));
  await quote({});
  await tapSlot(1, '11:00');
  ok(st().draft.time === '11:00' && st().draft.slots.join() === VAN && $('#dayPlan .dp-msg.ok').textContent === 'In slot 1 from 11:00 AM to 2:00 PM. 4 of 4 movers busy then. Take it out' && $('[data-act="q:book"]').textContent === 'Book job' && !$('#dayPlan .tl-tray'),
    L('slot 1 tapped at 11: “' + ($('#dayPlan .dp-msg.ok') || {}).textContent + '”'));
  const nb = laneOf(1).querySelector('.tl-new');
  ok(!!nb && !nb.classList.contains('bad') && nb.querySelector('b').textContent === '11–2 Pat Doe' && nb.querySelector('small').textContent === '2 movers' && $$('#dayPlan .tl-new').length === 1 && nb.classList.contains('tl-drag'), L('the move, dashed, in slot 1 at that time (it can be dragged again)'));
  ok($$('#dayPlan .tl-cells span.n').map((c) => c.textContent).join(',') === '2,4,4' && !$('#dayPlan .tl-cells span.over'), L('its hours lit in the movers row (2, then 4 with Bravo’s), none over'));
  click('[data-act="q:book"]'); await sleep(20);
  const pat = st().jobs.find((j) => j.d.name === 'Pat Doe');
  ok(!!pat && pat.status === 'booked' && pat.d.slots.join() === VAN && !pat.assign.truckId && !(pat.assign.more || []).length && pat.d.time === '11:00' && pat.log.some((l) => l.ev === 'Lined up in slot 1 at 11:00 AM') && toast() === 'Job booked in slot 1 at 11:00 AM. Add the truck and crew.',
    L('booked in slot 1, no truck put on it: “' + toast() + '”'));
  T.ui.jobId = null; T.render(); await sleep(10);
  // Book anyway: in no slot, no truck
  await quote({ name: 'Quinn Roe' });
  await tapSlot(2, '09:00');
  click('[data-act="q:book"]'); await sleep(10);
  ok(toast() === 'It doesn’t fit in slot 2 then. Tap Book anyway to book it.', L('in slot 2 at 9, where Alpha is: “' + toast() + '”'));
  click('[data-act="q:book"]'); await sleep(20);
  const qr = st().jobs.find((j) => j.d.name === 'Quinn Roe');
  ok(!!qr && qr.status === 'booked' && !qr.assign.truckId && !qr.d.slots.length && qr.d.time === '09:00' && toast() === 'Job booked. Add the truck and crew.', L('Book anyway: booked at 9:00 in no slot: “' + toast() + '”'));
  T.ui.jobId = null; T.render(); await sleep(10);
  P = T.planDay(D, T.schedRecs(), S());
  const qb = P.blocks.find((b) => b.r.id === qr.id), pb = P.blocks.find((b) => b.r.id === pat.id);
  ok(pb && pb.slotted && pb.lanes.join() === VAN && qb && qb.placed && qb.lanes.join() === BOX1, L('on the plan: Pat in slot 1 where it was put; Quinn in the first slot free then (slot 3)'));
  // a move of two trucks: two slots
  const big = S().catalog.filter((i) => i.cf >= 30).sort((a, b) => b.cf - a.cf)[0];
  await quote({ name: 'Wide Load', moveDate: D2, time: '08:00', items: { [big.id]: Math.ceil(900 / big.cf) } });
  ok(/2 slots, each for 800 cu ft or more/.test(plan()) && /This move\s*3 h · 2 movers\s*2 slots/.test($('#dayPlan .tl-tray').textContent), L('a load for two of the Van: “' + plan().match(/This move: [^.]*\./)[0] + '”'));
  await tapSlot(1, '08:00');
  ok(st().draft.slots.join() === VAN + ',' + BOX2 && laneOf(1).querySelector('.tl-new') && laneOf(2).querySelector('.tl-new') && !laneOf(3).querySelector('.tl-new') && /In slots 1 and 2 from 8:00 AM to 11:00 AM\./.test(plan()) && /2 movers · 2 trucks/.test(laneOf(1).querySelector('.tl-new').textContent),
    L('put in slot 1, it takes slot 2 beside it for its time (Richie: “If its a 2 truck it takes up 2 slots for that amount of time”)'));
  // nothing fits that day: the next days with room
  await quote({ name: 'Rae Fox', moveDate: D1, time: '09:00', truckId: BOX2 });
  ok(/No time on .* fits a 3-hour move for 2 movers\./.test(plan()) && /Next days with room/.test(plan()) && !/Other companies/.test(plan()), L('Tuesday is full for Box 2’s size: ' + plan().match(/No time on[^.]*\./)[0]));
  const dc = $('#dayPlan [data-act="dp:day"]');
  ok(!!dc && dc.textContent === fmtDate(D2) + ' · 7:00 AM', L('the next day with room: ' + (dc && dc.textContent)));
  click(dc); await sleep(15);
  ok(st().draft.moveDate === D2 && st().draft.time === '07:00' && st().draft.slots.join() === BOX2 && toast() === 'Moved to ' + fmtDate(D2) + ' at 7:00 AM in slot 2.' && /In slot 2 from 7:00 AM to 10:00 AM\./.test(plan()), L('tap it: moved to that day, in the slot free then'));

  /* ---------------- the call center: puts it in a slot; dispatch picks the truck ---------------- */
  click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5);
  click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === 'callcenter')); await sleep(20);
  ok(st().ui.role === 'callcenter', L('See it their way › Call center'));
  await quote({ name: 'Sam Lee', moveDate: D1, time: '09:00', truckId: BOX1, crew: '3' });
  ok(/3 slots · 6 movers on/.test(plan()) && !/Kim|Luis/.test(plan()), L('the call center sees how many movers, not who'));
  ok(/Other companies with room that day/.test(plan()), L('nothing that day for Box 1’s size: other companies with room are offered'));
  const co = $$('#dayPlan [data-act="dp:co"]').map((b) => b.textContent);
  ok(co.join(',') === 'Lone Star Haulers · 7:00 AM,Bluebonnet Moving · 7:00 AM', L('the companies with room that day for its load (Hill Country’s one truck is booked all day Tuesdays): ' + co.join(', ')));
  const nj = st().jobs.length;
  click('[data-act="q:book"]'); await sleep(15);
  ok(st().jobs.length === nj && toast() === 'Put the move in a slot first: drag it onto one under the price, or tap one.' && $('[data-act="q:book"]').textContent === 'Book job', L('Book job in no slot: “' + toast() + '”'));
  await tapSlot(3, '09:00');
  click('[data-act="q:book"]'); await sleep(15);
  ok(st().jobs.length === nj && toast() === 'It doesn’t fit in slot 3 at 9:00 AM. Move it to a slot with room, pick another day or another company.', L('in slot 3, where Delta is all day: “' + toast() + '”'));
  click($$('#dayPlan [data-act="dp:co"]').find((b) => /Bluebonnet/.test(b.textContent))); await sleep(10);
  ok(toast() === 'Bluebonnet Moving is a sample. For a company with the service, this opens its quote builder with this move filled in.', L('another company: “' + toast() + '”'));
  const carried = T.carryDraft(st().draft);
  ok(carried.name === 'Sam Lee' && carried.moveDate === D1 && carried.items[item.id] === 2 && !('truckId' in carried) && !('crew' in carried) && !('discount' in carried) && !('slots' in carried), L('what goes with the move to another company: the caller, the day and the items; not this company’s truck, crew, discount or slot'));
  click('#dayPlan [data-act="dp:day"]'); await sleep(15);
  ok(/In slot 3 from 7:00 AM to 10:00 AM\. 3 of 6 movers busy then\. Dispatch picks the truck and crew\./.test(plan()), L('the next day with room: in slot 3 at 7 (“Dispatch picks the truck and crew.”)'));
  click('[data-act="q:book"]'); await sleep(25);
  const sam = st().jobs.find((j) => j.d.name === 'Sam Lee');
  const sl = sam ? sam.log.map((l) => l.ev) : [], si = sl.indexOf('Created as Booked by the call center');
  ok(!!sam && sam.status === 'booked' && sam.d.moveDate === D2 && sam.d.slots.join() === BOX1 && !sam.assign.truckId && si >= 0 && sl[si + 1] === 'Lined up in slot 3 at 7:00 AM' && T.ui.tab === 'sched' && toast() === 'Booked for ' + fmtDate(D2) + ' at 7:00 AM in slot 3. Dispatch adds the truck and crew.',
    L('booked in slot 3, no truck: “' + toast() + '”'));
  // the Schedule: that day's slots, and each job's movers and trucks
  const srow = $$('#view .dp-card .tl-row').find((r) => r.querySelector('.tl-name b') && r.querySelector('.tl-name b').textContent === 'Slot 3');
  ok(T.ui.schedDay === D2 && !!srow && /7–10 Sam Lee/.test(srow.textContent) && !$('#view .dp-card [data-lane]'), L('the Schedule: that day’s slots, Sam in slot 3 (nothing to drag there)'));
  const sc = $('#view details.schedcard[data-job="' + sam.id + '"]');
  ok(!!sc && /3 movers · 1 truck/.test(sc.querySelector('summary').textContent), L('and it says “' + (sc && sc.querySelector('summary small:last-child').textContent) + '” (Richie: “5 movers 1 truck … it should say that in scheduling”)'));
  T.ui.schedDay = D1; T.ui.schedMon = D1.slice(0, 7); T.render(); await sleep(10);
  const cal = $('#view .cal-d[data-day="' + D1 + '"]');
  ok(!!cal && cal.classList.contains('lvl3') && /3 jobs booked, no room left/.test(cal.getAttribute('aria-label')) && /Room in most slots/.test($('#view .cal-key').textContent), L('Tuesday on the calendar: no room'));
  click('[data-act="pv:end"]'); await sleep(15);

  /* ---------------- dispatch picks the truck: the slot's, in one tap ---------------- */
  T.ui.tab = 'dispatch'; T.ui.weekStart = D; T.ui.day = D; T.render(); await sleep(15);   // D is a Monday
  const needSam = $$('#view details[data-k="d:need"] .who').find((x) => /Sam Lee/.test(x.textContent));
  ok(!!needSam && /Missing truck, crew/.test(needSam.textContent) && /Lined up in slot 3/.test(needSam.textContent) && /Use Box 1 \(26 ft\)/.test(needSam.textContent), L('Needs scheduling: Sam, lined up in slot 3, with “Use Box 1 (26 ft)”'));
  click(needSam.querySelector('[data-act="dq:slot"]')); await sleep(15);
  ok(sam.assign.truckId === BOX1 && /^Box 1 \(26 ft\) is on the job\./.test(toast()) && sam.log.some((l) => l.ev === 'Box 1 (26 ft) put on the job, from its slot'), L('one tap: dispatch puts the slot’s truck on it: “' + toast() + '”'));

  /* ---------------- the office marks who's off, on the Board ---------------- */
  T.ui.tab = 'dispatch'; T.ui.weekStart = D; T.ui.day = D; T.render(); await sleep(15);
  const off = $('#view details[data-k="d:off"]');
  ok(!!off && /Who’s off\s*Kim, Luis/.test(off.querySelector('summary').textContent) && /4 movers on, 2 off; bookings count the movers on\./.test(off.textContent), L('the Board’s Who’s off for that day: Kim, Luis'));
  click($$('#view [data-act="off:tog"]').find((b) => b.dataset.n === 'Marcus')); await sleep(15);
  ok(S().daysOff[D].join() === 'Kim,Luis,Marcus' && T.moversOn(D, S()).n === 3 && toast() === 'Marcus is off ' + fmtDate(D) + '.', L('Marcus off too: 3 on'));
  S().daysOff['2020-01-06'] = ['Kim'];
  click($$('#view [data-act="off:tog"]').find((b) => b.dataset.n === 'Marcus')); await sleep(15);
  ok(S().daysOff[D].join() === 'Kim,Luis' && toast() === 'Marcus is on ' + fmtDate(D) + '.' && !S().daysOff['2020-01-06'], L('and back on; days long gone are cleared away'));
  const loose = $$('#view .lane').find((x) => /No truck yet/.test(x.textContent));
  ok(!!loose && /Pat Doe/.test(loose.textContent) && /Lined up in slot 1/.test(loose.textContent), L('the Board’s No truck yet shows Pat lined up in slot 1'));

  /* ---------------- Setup › Fleet: each truck's day ---------------- */
  await go('settings', 'fleet');
  ok(/Each truck’s day/.test(view()) && $('[data-s="truckDay.start"]').value === '07:00' && $('[data-s="truckDay.hours"]').value === '12' && $('[data-s="truckDay.jobs"]').value === '4' && $('[data-s="truckDay.gap"]').value === '60', L('Setup › Fleet: each truck’s day (7:00 AM, 12 hours, 4 moves, 60 minutes between)'));
  type('[data-s="truckDay.jobs"]', '3'); type('[data-s="truckDay.gap"]', '45'); type('[data-s="truckDay.start"]', '06:30'); type('[data-s="truckDay.hours"]', '0');
  ok(S().truckDay.jobs === 3 && S().truckDay.gap === 45 && S().truckDay.start === '06:30' && S().truckDay.hours === 12, L('changed: 3 moves, 45 minutes, from 6:30 (an hours box of 0 keeps 12)'));
  mk('Foxtrot Co', D3, '08:00', 3, 2, BOX2);
  P = T.planDay(D3, T.schedRecs(), S());
  ok(P.cfg.start === 390 && P.cfg.jobs === 3 && P.cfg.gap === 45 && why(P, n2, '11:30') === 'ok:' + BOX1 && why(P, n2, '11:45') === 'ok:' + BOX2 && why(P, need({}), '06:30') === 'ok:' + VAN,
    L('and the plan follows: slot 2 free 45 minutes after Foxtrot, from 11:45; the day from 6:30'));

  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
