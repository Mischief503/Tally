// Local and mileage moves: which kind a move is, how each is priced, and the final bill from the
// crew's times and the miles driven. Run against either edition: node tests/ui/pricing.js <file> <label>
const { load, ok, sleep, summary } = require('./lib');
const file = process.argv[2] || __dirname + '/../../build/tally-artifact.html', label = process.argv[3] || 'pricing';
const H = 36e5;
(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, T } = A;
  const st = () => T.state();
  const L = (m) => label + ': ' + m;
  const more = async (tab) => { click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:go"][data-tab="' + tab + '"]'); await sleep(15); };
  const type = (sel, v, blur) => { const e = typeof sel === 'string' ? $(sel) : sel; e.value = v; e.dispatchEvent(new w.Event('input', { bubbles: true })); if (blur) e.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const toastTxt = () => $('#toast').textContent;
  const blank = (o) => Object.assign({ name: 'X', phone: '', email: '', source: 'Google', moveDate: '', time: '08:00', from: '', to: '', miles: '', milesOut: '', milesBack: '', flights: '', pack: false, crew: '', truckId: '', hoursOverride: '', discount: '', notes: '', custom: {}, items: {}, editId: '', moveKind: '' }, o);
  const S = (o) => Object.assign(JSON.parse(JSON.stringify(st().settings)), o || {});
  const lineOf = (q, k) => q.lines.filter((l) => l.k === k);
  const txt = (q) => q.lines.map((l) => l.label + ' ' + l.amt).join(' | ');

  // ---------- which kind of move, and the price ----------
  // 180 cu ft, 2 movers: 2 h of loading and unloading
  let q = T.calc(blank({ miles: '15', items: { boxm: 60 } }), S());
  ok(q.kind === 'local' && !lineOf(q, 'miles').length && q.hours === 3 && /2 movers, 3 hr at \$140\/hr 420/.test(txt(q)) && q.total === 465, L('15 mi move, 20-mile radius: local, by the hour (2 h + 0.5 h drive, 3 h minimum), no mileage: ' + txt(q)));
  q = T.calc(blank({ miles: '20', items: { boxm: 60 } }), S());
  ok(q.kind === 'local', L('exactly on the radius is still local'));
  q = T.calc(blank({ miles: '25', items: { boxm: 60 } }), S());
  ok(q.kind === 'mileage' && q.miles === 25 && /2 movers, 3 hr loading and unloading at \$140\/hr 420/.test(txt(q)) && /Mileage: 25 mi at \$1\.50\/mi 38/.test(txt(q)) && q.total === 503, L('25 mi: mileage, per mile plus loading and unloading only, the drive is not in the hours: ' + txt(q)));
  q = T.calc(blank({ miles: '45', items: { boxm: 60 } }), S({ includedMiles: 50 }));
  ok(q.kind === 'local' && !lineOf(q, 'miles').length, L('each company sets its own radius: 45 mi is local on a 50-mile radius'));
  q = T.calc(blank({ miles: '195', items: { boxm: 60 } }), S({ includedMiles: 0 }));
  ok(q.kind === 'local' && !lineOf(q, 'miles').length && q.hours === 8.5, L('radius 0: every move is local, the 195 mi drive in the hours (2 + 6.5 h): ' + txt(q)));
  // with a shop, the radius is measured from it: where the pickup and the delivery are
  const SHOP = { shopAddress: '1200 Industrial Blvd, Austin' };
  q = T.calc(blank({ milesOut: '12.3', miles: '22.4', milesBack: '18.1', items: { boxm: 60 } }), S(SHOP));
  ok(q.kind === 'local' && !lineOf(q, 'miles').length && q.hours === 4, L('pickup 12.3 and delivery 18.1 mi from the shop: local even though the move itself is 22.4 mi; 52.8 mi of driving in the hours (2 + 1.76 → 4 h)'));
  q = T.calc(blank({ milesOut: '12.3', miles: '22.4', milesBack: '25', items: { boxm: 60 } }), S(SHOP));
  ok(q.kind === 'mileage' && q.miles === 59.7 && /Mileage: 59\.7 mi from the shop and back at \$1\.50\/mi 90/.test(txt(q)) && q.hours === 3, L('delivery 25 mi from the shop: mileage, the whole drive from the shop and back per mile: ' + txt(q)));
  q = T.calc(blank({ milesOut: '30', miles: '22.4', milesBack: '18.1', items: { boxm: 60 } }), S(SHOP));
  ok(q.kind === 'mileage', L('pickup past the radius is mileage too'));
  q = T.calc(blank({ milesOut: '12.3', miles: '22.4', milesBack: '25', items: { boxm: 60 } }), S(Object.assign({ shopTravel: false }, SHOP)));
  ok(q.kind === 'mileage' && q.miles === 22.4 && /Mileage: 22\.4 mi at \$1\.50\/mi 34/.test(txt(q)), L('drive from the shop not counted: mileage on the move miles only'));
  q = T.calc(blank({ miles: '25', items: { boxm: 60 } }), S(SHOP));
  ok(q.kind === 'mileage', L('shop set but its drives not in yet: the move distance decides for now'));
  q = T.calc(blank({ miles: '5', moveKind: 'mileage', items: { boxm: 60 } }), S());
  ok(q.kind === 'mileage' && /Mileage: 5 mi at \$1\.50\/mi 8/.test(txt(q)), L('the office can make a short move a mileage move by hand'));
  q = T.calc(blank({ miles: '195', moveKind: 'local', items: { boxm: 60 } }), S());
  ok(q.kind === 'local' && !lineOf(q, 'miles').length && q.hours === 8.5, L('and a long one local by hand'));
  ok(!T.calc(blank({ miles: '25' }), S()).lines.length, L('no items: no price lines, as before'));
  // a drive from the shop that isn't in yet: at least the move less the other drive
  let dd = blank({ milesOut: '5', miles: '110', items: { boxm: 60 } });
  ok(T.calc(dd, S(SHOP)).kind === 'mileage' && /^<b>Mileage move<\/b>: .*The delivery is at least 105 mi from the shop, past your 20-mile radius\.$/.test(T.kindLine(dd, S(SHOP))), L('pickup 5 mi out, a 110 mi move, the drive back not in yet: the delivery is at least 105 mi out, so mileage: ' + T.kindLine(dd, S(SHOP))));
  dd = blank({ milesOut: '5', miles: '10', items: { boxm: 60 } });
  ok(T.calc(dd, S(SHOP)).kind === 'local' && /The pickup is 5 mi from the shop, inside your 20-mile radius\. Waiting on the drive from the delivery back to the shop\.$/.test(T.kindLine(dd, S(SHOP))), L('pickup 5 mi out and a 10 mi move: local for now, waiting on the drive back: ' + T.kindLine(dd, S(SHOP))));
  // the miles on the bill are the miles the quote charged: no $1 line from rounding
  q = T.calc(blank({ miles: '33.66', items: { boxm: 60 } }), S());
  const p0 = 1e12, same = T.clockBill({ quote: q, startedAt: p0, phases: { loadStart: p0, loadEnd: p0 + 1.5 * H, unloadStart: p0 + 2 * H, unloadEnd: p0 + 3.5 * H }, extras: [] });
  ok(q.miles === 33.66 && lineOf(q, 'miles')[0].amt === 50 && same.total === q.total && same.adj === 0, L('33.66 mi quoted, 3 h worked as quoted: the bill is the quote, to the dollar'));
  // the board: a mileage move's day is its hours plus the drive
  q = T.calc(blank({ miles: '195', items: { boxm: 60 } }), S());
  ok(q.kind === 'mileage' && q.hours === 3 && q.driveH === 6.5, L('195 mi: 3 h of loading and unloading, and 6.5 h of driving the board still counts'));

  // ---------- the quote screen ----------
  click('#fab'); await sleep(15);
  type('[data-d="name"]', 'Long haul');
  type('[data-d="miles"]', '110'); await sleep(5);
  const kn1 = $('#kindNote').textContent;
  ok(kn1 === 'Mileage move: per mile for the drive, plus loading and unloading time. The move is 110 mi, past your 20-mile radius. Add the shop address in Setup › Company to measure from the shop.', L('step 1 says it is a mileage move, and why: ' + kn1));
  type('[data-d="miles"]', '8'); await sleep(5);
  ok(/^Local move: by the hour with the drive included, no mileage\. The move is 8 mi, inside your 20-mile radius\./.test($('#kindNote').textContent), L('typing 8 mi makes it local at once: ' + $('#kindNote').textContent));
  type('[data-d="miles"]', '110'); await sleep(5);
  st().draft.items = { boxm: 190 };   // 570 cu ft
  click('[data-act="q:step"][data-s="3"]'); await sleep(20);
  type('[data-d="crew"]', '2'); await sleep(5);
  let lines = $('#qLines').textContent;
  ok(/2 movers, 6\.5 hr loading and unloading at \$140\/hr\$910/.test(lines) && /Truck and fuel\$45/.test(lines) && /Mileage: 110 mi at \$1\.50\/mi\$165/.test(lines) && /Total\$1,120/.test(lines), L('step 3: 6.5 h loading and unloading, 110 mi at $1.50, total $1,120: ' + lines));
  ok(/^Mileage move: per mile/.test($('#kindNote').textContent), L('step 3 says the kind under the price'));
  ok(/Adjust move type, crew, truck, hours or discount/.test($('#view').textContent) && $('[data-d="moveKind"]') && $('[data-d="moveKind"]').options[0].textContent === 'Auto, by your 20-mile radius', L('Adjust has a Move type choice, auto by default'));
  type('[data-d="moveKind"]', 'local'); await sleep(5);
  lines = $('#qLines').textContent;
  ok(/2 movers, 10 hr at \$140\/hr\$1,400/.test(lines) && !/Mileage/.test(lines), L('set to Local by hand: by the hour with the 110 mi drive in the hours (6.33 + 3.67 = 10 h), no mileage: ' + lines));
  ok($('#kindNote').textContent === 'Local move, set by hand: by the hour with the drive included, no mileage. By your 20-mile radius it would be a mileage move.', L('and the note says so: ' + $('#kindNote').textContent));
  type('[data-d="moveKind"]', ''); await sleep(5);
  ok(/Mileage: 110 mi/.test($('#qLines').textContent), L('back to Auto: mileage again'));
  click('[data-act="q:book"]'); await sleep(30);
  const J = st().jobs.find((x) => x.d.name === 'Long haul');
  ok(J && J.quote.kind === 'mileage' && J.quote.hours === 6.5 && J.quote.miles === 110 && J.quote.total === 1120 && J.quote.rate === 140 && J.quote.mileRate === 1.5 && J.quote.fixed === 45, L('booked: the quote keeps the kind and what the bill is worked out from'));
  ok(/· mileage move/.test($('#sheet .sheet-head').textContent) && /Mileage move/.test($('#sheet').textContent) && /The final bill comes from the crew’s times and the miles driven\./.test($('#sheet').textContent), L('job sheet: mileage move, billed from the crew’s times and miles'));
  click('[data-act="sheet:close"]'); await sleep(5);

  // ---------- the crew: miles driven, then finish (the user's example) ----------
  // 4 h loading, a 2 h drive, 3 h unloading, 120 miles driven: billed 7 h and 120 mi
  const t0 = Date.now() - 10 * H;
  Object.assign(J, { status: 'active', startedAt: t0, phases: { loadStart: t0 + 0.5 * H, loadEnd: t0 + 4.5 * H, unloadStart: t0 + 6.5 * H, unloadEnd: t0 + 9.5 * H } });
  J.assign = { truckId: 't20', crew: ['Marcus', 'Dee'] };
  st().ui.me = 'Marcus';
  await more('crew');
  const md = $('[data-mdrive="' + J.id + '"]');
  ok(md && md.value === '' && md.placeholder === 'Quoted 110 mi' && /Mileage move: the bill is the miles driven plus loading and unloading time/.test(md.closest('.crewcard').textContent), L('the lead gets a Miles driven box on a mileage move'));
  const priya = st().jobs.find((x) => x.d.name === 'Nadia Farouk');
  priya.status = 'active'; priya.assign.crew = ['Marcus']; T.render(); await sleep(10);
  ok(!$('[data-mdrive="' + priya.id + '"]'), L('a local move has no miles box'));
  priya.status = 'booked'; priya.assign.crew = ['Marcus', 'Kim'];
  type('[data-mdrive="' + J.id + '"]', '120', true); await sleep(10);
  ok(J.milesDriven === 120 && /Saved 120 mi\. They go on the bill when the job is finished\./.test(toastTxt()) && !J.extras.some((e) => e.id === 'clock'), L('miles saved on the job; nothing billed until it is finished'));
  ok(J.log.some((l) => /Miles driven: 120 mi \(Marcus\)/.test(l.ev)), L('the miles are in the job history'));
  click('[data-act="cr:finish"][data-id="' + J.id + '"]'); await sleep(20);
  let cl = J.extras.find((e) => e.id === 'clock');
  ok(cl && cl.amt === 85 && cl.label === 'By the clock: 7h 0m loading and unloading, billed 7 h, 120 mi driven (quoted 6.5 h, 110 mi)', L('finishing bills 7 h and 120 mi: one line, +$85 on the $1,120 quote: ' + (cl && cl.label + ' ' + cl.amt)));
  ok(Math.abs(J.quote.total + J.extras.reduce((a, e) => a + e.amt, 0) - 1205) < 0.01, L('bill: 7 h × $140 + 120 mi × $1.50 + $45 truck = $1,205'));
  ok(/Billed by the clock: \$1,205\./.test(toastTxt()) && !$('#flow').hidden, L('the lead is told the bill before the customer signs for it: ' + toastTxt()));
  // sign: the job closes, and the bill is worked out once
  $('#sigName').value = 'Long haul'; $('#sigAgree').checked = true; $('#sigPad').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  click('#flow [data-act="flow:sign"]'); await sleep(15);
  ok(/Payment/.test($('#flow').textContent) && /\$1,205/.test($('#flow').textContent), L('after signing, the payment screen asks for $1,205'));
  click('#flow [data-act="flow:close"]'); await sleep(10);
  ok(J.status === 'done' && J.log.filter((l) => /^Billed by the clock/.test(l.ev)).length === 1, L('signed and closed; "Billed by the clock" logged once, not again on closing: ' + J.log.filter((l) => /Billed/.test(l.ev)).map((l) => l.ev).join(' / ')));
  ok(J.log.some((l) => l.ev === 'Billed by the clock: 7 h, 120 mi, $1,205'), L('history says what was billed'));
  // the crew's bill panel
  const card = $$('.crewcard').find((c) => c.querySelector('[data-mdrive="' + J.id + '"]'));
  ok(card && /By the clock: 7h 0m loading and unloading, billed 7 h, 120 mi driven \(quoted 6\.5 h, 110 mi\)\$85/.test(card.textContent) && /Balance\$1,205/.test(card.textContent), L('the bill out panel shows the line and a $1,205 balance'));
  // the lead fixes the miles after finishing: the bill follows
  type('[data-mdrive="' + J.id + '"]', '130', true); await sleep(10);
  ok(J.milesDriven === 130 && Math.abs(J.extras.find((e) => e.id === 'clock').amt - 100) < 0.01 && /Bill updated: \$1,220\./.test(toastTxt()), L('130 mi after finishing: bill $1,220: ' + toastTxt()));
  type('[data-mdrive="' + J.id + '"]', '120', true); await sleep(10);
  ok(J.milesDriven === 120 && J.extras.find((e) => e.id === 'clock').amt === 85, L('and back to 120'));

  // ---------- the office: the job sheet, and corrections ----------
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
  click('[data-act="job:open"][data-id="' + J.id + '"]'); await sleep(15);
  let sh = $('#sheet').textContent;
  ok(/Loading 4h 0m and unloading 3h 0m: 7h 0m, billed 7 h\. 120 mi driven, from the crew\. Bill \$1,205 \(\+\$85 on the quote\)\./.test(sh), L('the sheet explains the bill: ' + (sh.match(/Mileage move[^]*?quote\)\./) || [''])[0]));
  ok(!!$('#clkH_' + J.id) && $('#clkH_' + J.id).placeholder === '7' && $('#clkMi_' + J.id).placeholder === '120' && /Update the bill/.test($('[data-act="clk:set"]').textContent), L('the office can change the hours and miles'));
  $('#clkH_' + J.id).value = '6'; click('[data-act="clk:set"][data-id="' + J.id + '"]'); await sleep(10);
  cl = J.extras.find((e) => e.id === 'clock');
  ok(cl && cl.amt === -55 && /Bill updated: \$1,065\./.test(toastTxt()) && /Hours set by the office: 6 h\./.test($('#sheet').textContent), L('6 h set by the office: $840 + $180 + $45 = $1,065, a $55 credit on the quote'));
  ok(cl.label === 'By the clock: 6 h set by the office, 120 mi driven (quoted 6.5 h, 110 mi)', L('the bill line says the office set it: ' + cl.label));
  $('#clkMi_' + J.id).value = '115'; click('[data-act="clk:set"][data-id="' + J.id + '"]'); await sleep(10);
  ok(Math.abs(J.quote.total + J.extras.reduce((a, e) => a + e.amt, 0) - 1058) < 0.01 && /115 mi set by the office/.test($('#sheet').textContent), L('miles set by the office too: $840 + $173 + $45 = $1,058'));
  ok(J.log.some((l) => /^Billed by the clock: 6 h, 115 mi, \$1,058 \(changed by /.test(l.ev)), L('the change is in the history with who made it'));
  click('[data-act="clk:reset"][data-id="' + J.id + '"]'); await sleep(10);
  ok(J.extras.find((e) => e.id === 'clock').amt === 85 && !$('[data-act="clk:reset"]'), L('Use the clock again: back to $1,205'));
  $('#clkH_' + J.id).value = '-2'; click('[data-act="clk:set"][data-id="' + J.id + '"]'); await sleep(10);
  ok(/Enter the hours to bill/.test(toastTxt()) && J.extras.find((e) => e.id === 'clock').amt === 85, L('a bad number is refused'));
  // paid in full, then the bill goes up: it owes again; held to the not-to-exceed price
  J.payments.push({ id: 'p-cash', amt: 1205, method: 'Cash', date: '2026-10-01', ts: Date.now() }); J.status = 'paid'; T.render(); await sleep(5);
  click('[data-act="job:open"][data-id="' + J.id + '"]'); await sleep(15);
  const fin0 = J.finishedAt, ah0 = J.actualHours;
  $('#clkH_' + J.id).value = '8'; click('[data-act="clk:set"][data-id="' + J.id + '"]'); await sleep(10);
  ok(J.quote.nte === 1290 && Math.abs(J.quote.total + J.extras.reduce((a, e) => a + e.amt, 0) - 1290) < 0.01 && /held to the not-to-exceed price/.test(J.extras.find((e) => e.id === 'clock').label), L('8 h would be $1,345: held to the $1,290 not-to-exceed price'));
  ok(J.status === 'done' && /\$85/.test($('#sheet .kpis').textContent), L('a paid job whose bill went up owes again: $85 due, back to Complete'));
  ok(J.finishedAt === fin0 && J.actualHours === ah0 && fin0 > 0, L('and it keeps the time it finished (crew hours and reports unchanged)'));
  click('[data-act="clk:reset"][data-id="' + J.id + '"]'); await sleep(10);
  ok(J.status === 'paid', L('back to the clock, the $1,205 paid covers it: Paid again'));
  $('#clkH_' + J.id).value = '6.5'; click('[data-act="clk:set"][data-id="' + J.id + '"]'); await sleep(10);
  ok(/The customer has paid \$70 more than the bill\./.test($('#sheet').textContent), L('a bill that drops below what was paid says so: ' + ($('#sheet').textContent.match(/The customer has paid[^.]*\./) || [''])[0]));
  click('[data-act="clk:reset"][data-id="' + J.id + '"]'); await sleep(10);
  // editing the quote of a job billed by the clock works the bill out again
  click('[data-act="sh:requote"]'); await sleep(15);
  ok(st().draft.editId === J.id && st().draft.moveKind === '', L('Edit quote opens with the move type'));
  type('[data-d="miles"]', '100'); await sleep(5);
  click('[data-act="q:step"][data-s="3"]'); await sleep(15);
  click('[data-act="q:save"]'); await sleep(30);
  ok(J.quote.total === 1105 && J.extras.find((e) => e.id === 'clock').amt === 100 && Math.abs(J.quote.total + J.extras.reduce((a, e) => a + e.amt, 0) - 1205) < 0.01 && J.log.some((l) => l.ev === 'Billed by the clock: 7 h, 120 mi, $1,205 (quote changed)'), L('quote changed to 100 mi ($1,105): the bill is still 7 h and 120 mi driven, $1,205, now +$100 on the quote'));
  ok(J.status === 'paid', L('still covered by the $1,205 paid'));
  click('[data-act="sheet:close"]'); await sleep(5);

  // ---------- a local move: billed by the hour, the drive included ----------
  const mk = async (name, d) => {
    click('#fab'); await sleep(10);
    if ($('[data-act="q:clear"]')) { click('[data-act="q:clear"]'); await sleep(5); click('[data-act="q:clear"]'); await sleep(5); }
    Object.assign(st().draft, blank(Object.assign({ name: name }, d)));
    click('[data-act="q:step"][data-s="3"]'); await sleep(10);
    click('[data-act="q:book"]'); await sleep(30);
    click('[data-act="sheet:close"]'); await sleep(5);
    return st().jobs.find((x) => x.d.name === name);
  };
  const LJ = await mk('Local one', { miles: '8', items: { boxm: 60 } });
  ok(LJ && LJ.quote.kind === 'local' && LJ.quote.hours === 3 && LJ.quote.total === 465 && !LJ.quote.shopTravel, L('local: 3 h (the minimum), $465'));
  // no shop address: the clock runs from Start loading to Done unloading; 3h 10m is billed 3.25 h
  const t1 = Date.now() - 5 * H;
  const finish = (j, ph, started) => { Object.assign(j, { status: 'active', startedAt: started, phases: ph }); j.assign = { truckId: 't20', crew: ['Marcus'] }; j.signed.push({ id: 's-' + j.id, formId: 'f_deliv', title: 'Delivery receipt and release', name: j.d.name, sig: '', ts: Date.now(), by: 'Marcus' }); };
  finish(LJ, { loadStart: t1 + 0.5 * H, loadEnd: t1 + 1.5 * H, unloadStart: t1 + 2 * H, unloadEnd: t1 + 0.5 * H + 190 * 60000 }, t1);
  await more('crew');
  click('[data-act="cr:finish"][data-id="' + LJ.id + '"]'); await sleep(20); click('#flow [data-act="flow:close"]'); await sleep(5);
  cl = LJ.extras.find((e) => e.id === 'clock');
  ok(LJ.status === 'done' && cl && cl.amt === 35 && cl.label === 'By the clock: 3h 10m on the job, billed 3.25 h (quoted 3 h)', L('3h 10m on the clock, billed in 15-minute steps: 3.25 h, +$35: ' + (cl && cl.label)));
  ok(/Job finished|Finished in/.test(toastTxt()) && /Billed by the clock: \$500\./.test(toastTxt()), L('finished with the bill in the message: ' + toastTxt()));
  const LJ2 = await mk('Local short', { miles: '8', items: { boxm: 60 } });
  const t2 = Date.now() - 3 * H;
  finish(LJ2, { loadStart: t2, loadEnd: t2 + 0.5 * H, unloadStart: t2 + 0.75 * H, unloadEnd: t2 + 70 * 60000 }, t2);
  await more('crew');
  click('[data-act="cr:finish"][data-id="' + LJ2.id + '"]'); await sleep(20); click('#flow [data-act="flow:close"]'); await sleep(5);
  ok(LJ2.status === 'done' && !LJ2.extras.some((e) => e.id === 'clock') && LJ2.clockAt > 0 && LJ2.log.some((l) => l.ev === 'Billed by the clock: 3 h, $465'), L('1h 10m: the 3-hour minimum, the same as the quote, so no extra line'));
  const LJ3 = await mk('Local long', { miles: '8', items: { boxm: 60 } });
  const t3 = Date.now() - 7 * H;
  finish(LJ3, { loadStart: t3, loadEnd: t3 + 2 * H, unloadStart: t3 + 2.5 * H, unloadEnd: t3 + 6 * H }, t3);
  await more('crew');
  click('[data-act="cr:finish"][data-id="' + LJ3.id + '"]'); await sleep(20); click('#flow [data-act="flow:close"]'); await sleep(5);
  ok(Math.abs(LJ3.quote.total + LJ3.extras.reduce((a, e) => a + e.amt, 0) - 535) < 0.01 && LJ3.quote.nte === 535, L('6 h would be $885: held to the $535 not-to-exceed price'));
  // with a shop address: Start job (leaving the shop) to Done unloading, plus the drive back
  st().settings.shopAddress = '1200 Industrial Blvd, Austin';
  const LJ4 = await mk('Local shop', { milesOut: '10', miles: '8', milesBack: '15', items: { boxm: 60 } });
  ok(LJ4.quote.kind === 'local' && LJ4.quote.shopTravel && LJ4.quote.backH === 0.5 && LJ4.quote.hours === 3.5 && LJ4.quote.total === 535, L('with the shop: local, 2 h + 33 mi of driving = 3.5 h, the drive back is 0.5 h'));
  const t4 = Date.now() - 6 * H;
  finish(LJ4, { loadStart: t4 + 0.5 * H, loadEnd: t4 + 1.5 * H, unloadStart: t4 + 2 * H, unloadEnd: t4 + 3.5 * H }, t4);
  await more('crew');
  click('[data-act="cr:finish"][data-id="' + LJ4.id + '"]'); await sleep(20); click('#flow [data-act="flow:close"]'); await sleep(5);
  cl = LJ4.extras.find((e) => e.id === 'clock');
  ok(cl && cl.amt === 70 && cl.label === 'By the clock: 4h 0m on the job, billed 4 h (quoted 3.5 h)', L('3.5 h from leaving the shop + 0.5 h back: billed 4 h, +$70: ' + (cl && cl.label)));
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
  click('[data-act="job:open"][data-id="' + LJ4.id + '"]'); await sleep(15);
  ok(/Local move/.test($('#sheet').textContent) && /On the clock 3h 30m, plus about 30m back to the shop: billed 4 h\. Bill \$605 \(\+\$70 on the quote\)\./.test($('#sheet').textContent) && !$('#clkMi_' + LJ4.id), L('sheet: how the local bill was worked out, with no miles box'));
  click('[data-act="sheet:close"]'); await sleep(5);
  st().settings.shopAddress = '';
  // the office finishes a job from the sheet, with no load and unload taps: Start job to Finish
  const OF = await mk('Office finish', { miles: '8', items: { boxm: 60 } });
  Object.assign(OF, { status: 'active', startedAt: Date.now() - 4 * H }); OF.assign = { truckId: 't20', crew: ['Marcus'] };
  OF.signed.push({ id: 's-of', formId: 'f_deliv', title: 'Delivery receipt and release', name: OF.d.name, sig: '', ts: Date.now(), by: 'Office' });
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
  click('[data-act="job:open"][data-id="' + OF.id + '"]'); await sleep(15);
  click('#sheet [data-act="sh:next"]'); await sleep(20);
  ok(OF.status === 'done' && /Finished in 4 h\. Billed by the clock: \$535\./.test(toastTxt()) && /held to the not-to-exceed/.test(OF.extras.find((e) => e.id === 'clock').label), L('finished from the sheet: 4 h on the job timer, held to $535, and the message says so: ' + toastTxt()));
  click('#flow [data-act="flow:close"]'); await sleep(5);
  click('[data-act="sheet:close"]'); await sleep(5);

  // ---------- jobs from before move types keep their price ----------
  const OLD = await mk('Old quote', { miles: '25', items: { boxm: 60 } });
  ['kind', 'rate', 'miles', 'mileRate', 'fixed', 'taxPct', 'minHours', 'shopTravel', 'backH'].forEach((k) => delete OLD.quote[k]);
  const oldTotal = OLD.quote.total, t5 = Date.now() - 9 * H;
  finish(OLD, { loadStart: t5, loadEnd: t5 + 4 * H, unloadStart: t5 + 5 * H, unloadEnd: t5 + 8 * H }, t5);
  await more('crew');
  click('[data-act="cr:finish"][data-id="' + OLD.id + '"]'); await sleep(20); click('#flow [data-act="flow:close"]'); await sleep(5);
  ok(OLD.status === 'done' && !OLD.extras.length && !OLD.clockAt && OLD.quote.total === oldTotal && !/Billed by the clock/.test(toastTxt()), L('an older quote with no move type: finished at its quoted price, nothing added'));
  ok(T.clockBill({ quote: Object.assign({}, J.quote, { kind: undefined }), phases: J.phases, startedAt: J.startedAt, extras: [] }) === null && T.clockBill({ quote: J.quote, phases: J.phases, startedAt: J.startedAt, extras: [] }) !== null, L('the move type on the quote is what turns billing by the clock on'));
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
  click('[data-act="job:open"][data-id="' + OLD.id + '"]'); await sleep(15);
  ok(!/Mileage move|Local move/.test($('#sheet').textContent), L('and its sheet has no move-type block'));
  click('[data-act="sheet:close"]'); await sleep(5);
  // a finished job with a move type that was closed some other way: the office can bill it by the clock
  const SAMPLE = st().jobs.find((x) => x.d.name === 'Devon Reyes');
  ok(SAMPLE.quote.kind === 'mileage' && !SAMPLE.clockAt, L('sample job: a 31 mi move, mileage, closed at its quote'));
  click('[data-act="job:open"][data-id="' + SAMPLE.id + '"]'); await sleep(15);
  ok(/This job was closed at its quoted price\. By the clock it would be/.test($('#sheet').textContent) && /Bill by the clock/.test($('[data-act="clk:set"]').textContent), L('its sheet offers Bill by the clock'));
  const before = SAMPLE.extras.length;
  click('[data-act="clk:set"][data-id="' + SAMPLE.id + '"]'); await sleep(10);
  ok(SAMPLE.clockAt > 0 && SAMPLE.extras.length === before + 1 && /Bill updated/.test(toastTxt()), L('one tap bills it by the clock'));
  click('[data-act="sheet:close"]'); await sleep(5);

  // ---------- bid accuracy: a mileage move's bid is its loading and unloading ----------
  await more('reports');
  const row = $$('table.tbl tr').find((tr) => /^Long haul/.test((tr.cells[0] || {}).textContent || ''));
  ok(row && row.cells[1].textContent === '6.5 h' && row.cells[2].textContent === '7 h', L('Reports: Long haul bid 6.5 h, actual 7 h of loading and unloading (not the 9.5 h day)'));

  // ---------- review fixes: status changes, signatures pending, the board, the cap, billing at the quote ----------
  // changing the status by hand doesn't bill a job by the clock
  const CM = st().jobs.find((x) => x.d.name === 'Chloe Martin');
  const cmTotal = CM.quote.total + CM.extras.reduce((a, e) => a + e.amt, 0);
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
  click('[data-act="job:open"][data-id="' + CM.id + '"]'); await sleep(15);
  type('#sheet [data-jstatus]', 'done', true); await sleep(10);
  ok(CM.status === 'done' && !CM.extras.some((e) => e.id === 'clock') && !CM.clockAt && CM.quote.total + CM.extras.reduce((a, e) => a + e.amt, 0) === cmTotal, L('a paid sample job set to Complete by hand keeps its price'));
  type('#sheet [data-jstatus]', 'paid', true); await sleep(10);
  click('[data-act="sheet:close"]'); await sleep(5);
  // saving a quote with no change doesn't move a job between Paid and Complete
  click('[data-act="job:open"][data-id="' + LJ.id + '"]'); await sleep(15);
  type('#sheet [data-jstatus]', 'paid', true); await sleep(10);
  ok(LJ.status === 'paid' && LJ.clockAt > 0 && !LJ.payments.length, L('a job billed by the clock, marked Paid by hand'));
  click('[data-act="sh:requote"]'); await sleep(15);
  click('[data-act="q:step"][data-s="3"]'); await sleep(10);
  click('[data-act="q:save"]'); await sleep(30);
  ok(LJ.status === 'paid', L('Edit quote and save with no change: still Paid'));
  click('[data-act="sheet:close"]'); await sleep(5);
  // signatures pending: the bill line is on the bill, and the miles still change it
  const SP = await mk('Sig pending', { miles: '110', crew: '2', items: { boxm: 190 } });
  const t6 = Date.now() - 10 * H;
  Object.assign(SP, { status: 'active', startedAt: t6, phases: { loadStart: t6 + 0.5 * H, loadEnd: t6 + 4.5 * H, unloadStart: t6 + 6.5 * H, unloadEnd: t6 + 9.5 * H } }); SP.assign = { truckId: 't20', crew: ['Marcus'] };
  await more('crew');
  click('[data-act="cr:finish"][data-id="' + SP.id + '"]'); await sleep(20);
  click('#flow [data-act="flow:close"]'); await sleep(10);
  ok(SP.status === 'active' && SP.clockAt > 0 && SP.extras.find((e) => e.id === 'clock').amt === 70, L('finish tapped, customer not signed yet: the job is open, the line (+$70) is on the bill'));
  type('[data-mdrive="' + SP.id + '"]', '200', true); await sleep(10);
  ok(SP.extras.find((e) => e.id === 'clock').amt === 170 && /Bill updated: \$1,290\./.test(toastTxt()), L('200 mi typed before signing: the bill follows ($1,325, held to $1,290): ' + toastTxt()));
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
  click('[data-act="job:open"][data-id="' + SP.id + '"]'); await sleep(15);
  ok(/Bill \$1,290, held to the not-to-exceed price \(\+\$170 on the quote\)\./.test($('#sheet').textContent) && !/It goes on the bill when the job is finished/.test($('#sheet').textContent), L('the sheet says it is on the bill, not "when the job is finished"'));
  click('[data-act="sheet:close"]'); await sleep(5);
  // an undone tap works the bill out again
  await more('crew');
  click('[data-act="cr:phaseundo"][data-id="' + SP.id + '"]'); await sleep(10);
  ok(SP.phases.unloadEnd === null && !SP.extras.some((e) => e.id === 'clock') && SP.log.some((l) => l.ev === 'Bill back to the quote (times changed)'), L('Undo "Done unloading": the bill goes back to the quote until it is tapped again'));
  click($('.crewcard [data-id="' + SP.id + '"].primary')); await sleep(10);
  ok(SP.phases.unloadEnd > 0 && SP.extras.find((e) => e.id === 'clock'), L('tapped again: the line is back'));
  // a mileage bid needs the loading and unloading taps to be measured
  ok(T.bidActual({ quote: { kind: 'mileage', hours: 6.5 }, actualHours: 10, phases: {} }) === 0 && T.bidActual({ quote: { kind: 'local', hours: 3 }, actualHours: 4 }) === 4, L('bid accuracy leaves out a mileage move with no loading and unloading taps'));
  const DR = st().jobs.find((x) => x.d.name === 'Devon Reyes'), drB = T.bidActual(DR);
  ok(DR.quote.kind === 'mileage' && Math.abs(drB / (DR.quote.hours * 0.95) - 1) < 0.05 && DR.actualHours > drB + DR.quote.driveH * 0.9, L('sample mileage job: loading and unloading close to its bid (×0.95), and the day is longer by the drive: bid ' + DR.quote.hours + ' h, load+unload ' + drB + ' h, day ' + DR.actualHours + ' h'));
  // the board counts a mileage move's drive
  const B1 = await mk('Board long', { miles: '195', items: { boxm: 60 } }), B2 = await mk('Board late', { miles: '8', items: { boxm: 60 } });
  [B1, B2].forEach((b, i) => { b.d.moveDate = '2030-01-15'; b.d.time = i ? '16:00' : '08:00'; b.assign = { truckId: 't26', crew: ['Andre'] }; });
  ok(T.conflictsFor(B2).some((c) => c.other === B1), L('a 195 mi mileage move at 8 AM (3 h + 6.5 h drive) clashes with a 4 PM job on the same truck'));
  B1.status = 'lost'; B2.status = 'lost';
  // the not-to-exceed cap is the company's choice
  await more('settings');
  const capBox = $('input[data-s="nteCap"]');
  ok(capBox && capBox.checked && /Hold the final bill to the not-to-exceed price/.test(capBox.closest('label').textContent), L('Rate card: hold the bill to the not-to-exceed price, on by default'));
  capBox.checked = false; capBox.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(5);
  const NC = await mk('No cap', { miles: '8', items: { boxm: 60 } });
  ok(NC.quote.capNte === false, L('switched off: new quotes are not held to it'));
  click('#fab'); await sleep(10); Object.assign(st().draft, blank({ name: 'Peek', miles: '8', items: { boxm: 60 } })); click('[data-act="q:step"][data-s="3"]'); await sleep(10);
  ok(!/Not-to-exceed/.test($('#qLines').textContent), L('and the quote no longer shows a not-to-exceed price'));
  click('[data-act="q:clear"]'); await sleep(5); click('[data-act="q:clear"]'); await sleep(5);
  const t7 = Date.now() - 7 * H;
  finish(NC, { loadStart: t7, loadEnd: t7 + 2 * H, unloadStart: t7 + 2.5 * H, unloadEnd: t7 + 6 * H }, t7);
  await more('crew');
  click('[data-act="cr:finish"][data-id="' + NC.id + '"]'); await sleep(20); click('#flow [data-act="flow:close"]'); await sleep(5);
  ok(Math.abs(NC.quote.total + NC.extras.reduce((a, e) => a + e.amt, 0) - 885) < 0.01, L('6 h billed in full: $885 (the not-to-exceed would have been $535)'));
  st().settings.nteCap = true;
  // the office can bill a job at its quote
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
  click('[data-act="job:open"][data-id="' + NC.id + '"]'); await sleep(15);
  click('[data-act="clk:off"][data-id="' + NC.id + '"]'); await sleep(10);
  ok(!NC.extras.some((e) => e.id === 'clock') && /Billed at the quote: \$465\./.test(toastTxt()) && /Billed at the quote, set by the office\. By the clock it would be \$885 \(\+\$420 on the quote\)\./.test($('#sheet').textContent), L('Bill at the quote: the line comes off, $465, and the sheet says what the clock would have billed'));
  type('#sheet [data-jstatus]', 'active', true); await sleep(10); type('#sheet [data-jstatus]', 'done', true); await sleep(10);
  ok(NC.status === 'done' && !NC.extras.some((e) => e.id === 'clock'), L('reopened and finished again: still billed at the quote'));
  click('[data-act="clk:set"][data-id="' + NC.id + '"]'); await sleep(10);
  ok(NC.extras.find((e) => e.id === 'clock').amt === 420 && !(NC.clockFix || {}).off, L('Bill by the clock puts it back'));
  click('[data-act="sheet:close"]'); await sleep(5);
  ok(/Stairs, parking, damage credit/.test((await more('crew'), $('[id^="ce_l_"]') || {}).placeholder || ''), L('the crew\'s extra-charge box no longer suggests an extra hour (the clock bills the time)'));

  // ---------- the rate card ----------
  await more('settings');
  const rad = $('input[data-s="includedMiles"]');
  ok(rad && /Local radius \(driving miles from the shop\)/.test(rad.closest('label').textContent) && /Per mile on mileage moves \(\$\)/.test($('input[data-s="mileRate"]').closest('label').textContent), L('Rate card: the local radius and the per-mile rate'));
  ok(/charged by the hour with the drive included, and no mileage/.test($('#view').textContent) && /A radius of 0 makes every move local\./.test($('#view').textContent), L('Rate card explains local and mileage moves'));
  type(rad, '150'); await sleep(5);
  ok(st().settings.includedMiles === 150 && T.calc(blank({ miles: '110', items: { boxm: 60 } }), st().settings).kind === 'local', L('a 150-mile radius makes the 110 mi move local'));
  click('#fab'); await sleep(10);
  if ($('[data-act="q:clear"]')) { click('[data-act="q:clear"]'); await sleep(5); click('[data-act="q:clear"]'); await sleep(5); }
  type('[data-d="miles"]', '110'); await sleep(5);
  ok(/inside your 150-mile radius/.test($('#kindNote').textContent), L('the quote uses the new radius'));
  type(rad.isConnected ? rad : (await more('settings'), $('input[data-s="includedMiles"]')), '0'); await sleep(5);
  click('#fab'); await sleep(10);
  ok(/No local radius is set in Setup › Rate card, so every move is local\./.test($('#kindNote').textContent), L('radius 0: the quote says every move is local'));
  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
