// Typed job info is saved with a button (Richie, Oct 12: "When dispatch enters new info on the job say
// job notes or material, there need to be a save button there to save the new info so everyone can see
// what was added"), and materials go on with a tap (Richie, Oct 12: "a button that says add materials
// then you click the item and it adds it to materials list each time you click on it").
// Job notes and the customer and route wait for Save; the cost form keeps what was typed until Save
// cost; Add materials opens a list where each tap puts one on the job at once; leaving with something
// unsaved asks first; the crew card says who changed the office's notes and when.
const { load, ok, sleep, summary } = require('./lib');
const file = process.argv[2] || __dirname + '/../../build/tally-artifact.html', label = process.argv[3] || 'jobedit';
const L = (m) => label + ': ' + m;

(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, T } = A;
  const st = () => T.state();
  const byName = (n) => st().jobs.find((j) => j.d.name === n);
  const sheet = () => $('#sheet').hidden ? '' : $('#sheet').textContent.replace(/\s+/g, ' ');
  const toastTxt = () => $('#toast').textContent;
  const type = (sel, v, ev) => { const el = $(sel); el.value = v; el.dispatchEvent(new w.Event(ev || 'input', { bubbles: true })); return el; };
  const bar = (sec) => $('#sheet [data-sv="' + sec + '"]');
  const leave = () => $('#sheet .leavebar');
  const P = byName('Priya Nair'), saved0 = P.d.notes || '';
  const open = async (j) => { click('[data-act="tab"][data-tab="jobs"]'); await sleep(10); click('[data-act="job:open"][data-id="' + j.id + '"]'); await sleep(20); };

  /* ---------------- job notes ---------------- */
  await open(P);
  const nb = () => $('#sheet [data-act="jed:save"][data-sec="notes"]');
  ok(!!$('#sheet textarea[data-j="notes"]') && nb() && /Save notes/.test(nb().textContent) && !nb().classList.contains('primary') && /The crew sees these but can’t change them/.test(bar('notes').textContent), L('Job notes have a Save notes button; nothing to save yet'));
  type('#sheet textarea[data-j="notes"]', 'Gate code 4411. Elevator booked 9 to 1.');
  await sleep(300);
  ok((P.d.notes || '') === saved0, L('typing saves nothing yet'));
  ok(nb().classList.contains('primary') && /Not saved yet\. Tap Save notes so everyone on the job sees it\./.test(bar('notes').textContent) && !$('#sheet [data-act="jed:undo"][data-sec="notes"]').hidden, L('the button lights up and says Not saved yet, with Undo'));
  ok(/Not saved/.test($('#sheet details[data-k="sh:Job notes"] summary').textContent), L('the Job notes header says Not saved too, while typing'));
  T.render(); await sleep(10);
  ok($('#sheet textarea[data-j="notes"]').value === 'Gate code 4411. Elevator booked 9 to 1.' && /Not saved yet/.test(bar('notes').textContent), L('a redraw (like a change arriving from another phone) keeps what was typed'));
  click('#sheet [data-act="jed:undo"][data-sec="notes"]'); await sleep(10);
  ok($('#sheet textarea[data-j="notes"]').value === saved0 && !/Not saved yet/.test(bar('notes').textContent), L('Undo puts back the saved notes'));
  type('#sheet textarea[data-j="notes"]', 'Gate code 4411. Elevator booked 9 to 1.');
  const t0 = Date.now();
  click('#sheet [data-act="jed:save"][data-sec="notes"]'); await sleep(20);
  ok(P.d.notes === 'Gate code 4411. Elevator booked 9 to 1.' && P.d.notesBy === 'Owner' && P.d.notesAt >= t0, L('Save notes saves them, with who and when'));
  ok(/Job notes saved\. Everyone on the job sees them now\./.test(toastTxt()), L('and says everyone on the job sees them now'));
  ok(/Saved\. Last changed by Owner today at \d{1,2}:\d\d [AP]M\. The crew sees these but can’t change them\./.test(bar('notes').textContent) && !nb().classList.contains('primary'), L('the line under them says who saved them and when'));
  ok(P.log.some((l) => l.ev === 'Job notes updated by Owner') && /Job notes updated by Owner/.test(sheet()), L('Activity shows the change'));
  click('#sheet [data-act="jed:save"][data-sec="notes"]'); await sleep(10);
  ok(/The job notes are saved/.test(toastTxt()), L('Save with nothing new just says they are saved'));

  /* ---------------- customer and route ---------------- */
  const cb = () => $('#sheet [data-act="jed:save"][data-sec="cust"]');
  const phone0 = P.d.phone, from0 = P.d.from;
  type('#sheet input[data-j="phone"]', '512-555-0199');
  type('#sheet input[data-j="from"]', '420 Oak St, Austin');
  type('#sheet select[data-jcf="cf1"]', 'Yes', 'change');
  ok(P.d.phone === phone0 && P.d.from === from0 && (P.d.custom.cf1 || '') !== 'Yes' && cb().classList.contains('primary') && /Not saved yet\. Tap Save/.test(bar('cust').textContent), L('the customer and route wait for Save too, custom fields included'));
  click('#sheet [data-act="jed:save"][data-sec="cust"]'); await sleep(20);
  ok(P.d.phone === '512-555-0199' && P.d.from === '420 Oak St, Austin' && P.d.custom.cf1 === 'Yes', L('Save saves the phone, pickup and Elevator reserved'));
  ok(/Saved: phone, pickup, Elevator reserved\. Everyone on the job sees it now\./.test(toastTxt()) && P.log.some((l) => l.ev === 'Customer details updated by Owner: phone, pickup, Elevator reserved'), L('the toast and Activity name what changed'));
  ok(/Saved\. The crew sees these on their job card\./.test(bar('cust').textContent), L('and the line says the crew sees it'));

  /* ---------------- leaving with something unsaved ---------------- */
  type('#sheet textarea[data-j="notes"]', 'Gate code 4411. Elevator booked 9 to 1. Bring the piano board.');
  click('#sheet [data-act="sheet:close"].btn'); await sleep(15);
  ok(!$('#sheet').hidden && leave() && /Not saved yet: the job notes\. Save so everyone on the job sees it\?/.test(leave().textContent), L('Close with unsaved notes asks first'));
  ok(['jed:saveall', 'jed:discard', 'jed:keep'].every((a) => !!$('#sheet .leavebar [data-act="' + a + '"]')), L('Save, Don’t save, Keep editing'));
  click('#sheet [data-act="jed:keep"]'); await sleep(10);
  ok(!leave() && !$('#sheet').hidden && /piano board/.test($('#sheet textarea[data-j="notes"]').value), L('Keep editing: back to the notes, text still there'));
  click('#sheet .scrim'); await sleep(10);
  ok(!!leave(), L('tapping outside the sheet asks too'));
  click('#sheet [data-act="jed:discard"]'); await sleep(15);
  ok($('#sheet').hidden && !/piano board/.test(P.d.notes), L('Don’t save: the sheet closes, the notes stay as they were'));
  await open(P);
  ok(!/piano board/.test($('#sheet textarea[data-j="notes"]').value) && !/Not saved yet/.test(bar('notes').textContent), L('opened again: the dropped text is gone'));
  type('#sheet textarea[data-j="notes"]', 'Gate code 4411. Bring the piano board.');
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);
  click('#sheet [data-act="jed:saveall"]'); await sleep(20);
  ok($('#sheet').hidden && P.d.notes === 'Gate code 4411. Bring the piano board.', L('Save from the question saves and closes'));

  // Escape, the phone's Back button, Edit quote and opening another job ask the same way
  await open(P);
  type('#sheet textarea[data-j="notes"]', 'Draft one');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(10);
  ok(!$('#sheet').hidden && !!leave(), L('Escape asks'));
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(10);
  ok(!$('#sheet').hidden && !leave(), L('Escape again goes back to editing'));
  w.TALLY_STANDALONE = true; T.render(); await sleep(10);
  w.dispatchEvent(new w.PopStateEvent('popstate', { state: null })); await sleep(15);
  ok(!$('#sheet').hidden && !!leave(), L('the phone’s Back button asks instead of closing'));
  w.TALLY_STANDALONE = false;
  click('#sheet [data-act="jed:keep"]'); await sleep(5);
  click('#sheet [data-act="sh:requote"]'); await sleep(15);
  ok(!$('#sheet').hidden && !!leave() && T.ui.tab !== 'quote', L('Edit quote asks before leaving'));
  click('#sheet [data-act="jed:saveall"]'); await sleep(20);
  ok(T.ui.tab === 'quote' && P.d.notes === 'Draft one' && st().draft.notes === 'Draft one' && st().draft.editId === P.id, L('Save, then the quote opens with the saved notes'));
  click('[data-act="q:cancel"]'); await sleep(5);
  await open(P);
  type('#sheet textarea[data-j="notes"]', 'Draft two');
  const N = byName('Nadia Farouk');
  click('[data-act="job:open"][data-id="' + N.id + '"]'); await sleep(15);
  ok(T.ui.jobId === P.id && !!leave(), L('opening another job asks first (the side panel on a wide screen)'));
  click('#sheet [data-act="jed:discard"]'); await sleep(15);
  ok(T.ui.jobId === N.id && P.d.notes === 'Draft one' && /Nadia Farouk/.test($('#sheet h2').textContent), L('Don’t save: the other job opens, nothing saved'));
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);
  ok($('#sheet').hidden, L('a job with nothing unsaved closes straight away'));

  /* ---------------- materials: Add materials, then tap an item for each one ---------------- */
  await open(P);
  const key = 's_' + P.id, costs0 = (P.costs || []).length;
  const mats = st().settings.materials, mat = mats[0], mat2 = mats[1];
  const cnt = (mid) => P.materials.filter((x) => x.itemId === mid).reduce((a, x) => a + x.qty, 0);
  const mp = () => $('#matpick');
  const tile = (mid) => { const b = $('#matpick [data-act="mp:add"][data-mid="' + mid + '"]'); return b && b.closest('.mtile'); };
  const n0 = cnt(mat.id), n02 = cnt(mat2.id), lines0 = P.materials.length;
  ok(!$('#mat_i_' + key) && /Add materials/.test(($('#sheet [data-act="mp:open"]') || {}).textContent || '') && /Save cost/.test($('#costSave_' + key).textContent), L('the sheet has an Add materials button instead of the old form; costs keep Save cost'));
  click('#sheet [data-act="mp:open"]'); await sleep(10);
  ok(!mp().hidden && /Add materials/.test(mp().textContent) && /Priya Nair · tap an item to add one/.test(mp().textContent), L('Add materials opens the list for this job'));
  ok($$('#matpick .mtile').length === mats.length && new RegExp(mat.name.replace(/[()]/g, '.') + '.*' + mat.unit.replace(/[()]/g, '.') + ' · \\$').test(tile(mat.id).textContent), L('every material on your list is a button, with its unit and (for the office) its price'));
  click('#matpick [data-act="mp:add"][data-mid="' + mat.id + '"]'); await sleep(10);
  ok(cnt(mat.id) === n0 + 1 && new RegExp(mat.name.replace(/[()]/g, '.') + ' added · ' + (n0 + 1) + ' on this job').test(toastTxt()), L('one tap: one on the job, saved right away'));
  click('#matpick [data-act="mp:add"][data-mid="' + mat.id + '"]'); await sleep(5);
  click('#matpick [data-act="mp:add"][data-mid="' + mat.id + '"]'); await sleep(5);
  ok(cnt(mat.id) === n0 + 3 && tile(mat.id).querySelector('.mcount').textContent === String(n0 + 3) && tile(mat.id).classList.contains('on'), L('each tap adds one more, and the button shows how many are on the job'));
  const mine = P.materials.filter((x) => x.itemId === mat.id && x.by === 'Owner');
  ok(mine.length === 1 && mine[0].qty === 3 && P.materials.length === lines0 + 1, L('the taps go on one line for Owner, not three'));
  click('#matpick [data-act="mp:add"][data-mid="' + mat2.id + '"]'); await sleep(5);
  ok(cnt(mat2.id) === n02 + 1, L('another item goes on its own line'));
  click('#matpick [data-act="mp:minus"][data-mid="' + mat.id + '"]'); await sleep(10);
  ok(cnt(mat.id) === n0 + 2 && new RegExp(mat.name.replace(/[()]/g, '.') + ' taken off · ' + (n0 + 2) + ' on this job').test(toastTxt()), L('− takes one off'));
  ok(/Materials and costs/.test(sheet()) && new RegExp(mat.name.replace(/[()]/g, '.') + ' × 2').test(sheet()), L('the job’s list behind it is already up to date'));
  type('#mpOq', '2'); click('#matpick [data-act="mp:other"]'); await sleep(10);
  ok(/Say what it was/.test(toastTxt()), L('something not on the list needs a name'));
  type('#mpOn', 'Mattress bag'); type('#mpOq', '2');
  click('#matpick [data-act="mp:other"]'); await sleep(10);
  ok(P.materials.some((x) => x.name === 'Mattress bag' && x.qty === 2 && x.price == null && x.by === 'Owner') && /Mattress bag × 2 added\. Set its price in the list\./.test(toastTxt()) && $('#mpOn').value === '', L('then it goes on with its quantity, for the office to price'));
  T.render(); await sleep(10);
  ok(!mp().hidden && tile(mat.id).querySelector('.mcount').textContent === String(n0 + 2), L('a redraw behind it keeps the list open and right'));
  const logs0 = P.log.length;
  click('#matpick [data-act="mp:close"].btn'); await sleep(10);
  ok(mp().hidden && P.log.length === logs0 + 1 && new RegExp('Materials added by Owner: ' + mat.name.replace(/[()]/g, '.') + ' × 2, ' + mat2.name.replace(/[()]/g, '.') + ' × 1, Mattress bag × 2').test(P.log[P.log.length - 1].ev), L('Done closes it and puts one line in Activity: ' + P.log[P.log.length - 1].ev));
  click('#sheet [data-act="mp:open"]'); await sleep(10);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(10);
  ok(mp().hidden && !$('#sheet').hidden && P.log.length === logs0 + 1, L('Escape closes it, back to the job; nothing added, nothing logged'));
  w.TALLY_STANDALONE = true; click('#sheet [data-act="mp:open"]'); await sleep(10);
  w.dispatchEvent(new w.PopStateEvent('popstate', { state: null })); await sleep(15);
  ok(mp().hidden && !$('#sheet').hidden, L('the phone’s Back button closes the list, not the job'));
  w.TALLY_STANDALONE = false;
  /* the cost form still waits for Save cost */
  type('#cost_l_' + key, 'Dump fee'); type('#cost_a_' + key, '4000');
  ok(!$('#costHint_' + key).hidden && $('#costSave_' + key).classList.contains('primary') && /Not saved/.test($('#sheet details[data-k="sh:Materials and costs"] summary').textContent), L('typing a cost says it isn’t saved yet, in the header too'));
  T.render(); await sleep(10);
  ok($('#cost_l_' + key).value === 'Dump fee' && $('#cost_a_' + key).value === '40.00', L('a redraw keeps the cost being typed'));
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);
  ok(/Not saved yet: the job cost you typed\./.test(leave().textContent), L('closing asks about the cost'));
  click('#sheet [data-act="jed:saveall"]'); await sleep(20);
  ok($('#sheet').hidden && P.costs.length === costs0 + 1 && P.costs[P.costs.length - 1].label === 'Dump fee' && P.costs[P.costs.length - 1].amt === 40, L('Save from the question saves the cost and closes'));
  await open(P);
  type('#cost_l_' + key, 'Tolls');
  type('#sheet textarea[data-j="notes"]', 'Draft three');
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);
  ok(/Not saved yet: the job notes and the job cost you typed\./.test(leave().textContent), L('two things unsaved: both named'));
  click('#sheet [data-act="jed:saveall"]'); await sleep(20);
  ok(!$('#sheet').hidden && !leave() && /Enter the amount\./.test(toastTxt()) && P.d.notes === 'Draft three', L('a cost that can’t go in yet: the notes save, the sheet stays open and says what’s missing'));
  type('#cost_a_' + key, '1250'); click('#costSave_' + key); await sleep(15);
  ok(P.costs.some((x) => x.label === 'Tolls' && x.amt === 12.5) && /Saved: Tolls, \$12\.50/.test(toastTxt()), L('then Save cost adds it'));
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);
  ok($('#sheet').hidden, L('and the sheet closes'));

  /* ---------------- the crew sees what the office added, and adds its own the same way ---------------- */
  click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5);
  click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === 'lead' && b.dataset.staff === 'Marcus')); await sleep(15);
  await A.go('crew');
  const card = () => $('#view .crewcard[data-job="' + P.id + '"]');
  const on = card() && card().querySelector('.cc-onote'), ct = on ? on.textContent.replace(/\s+/g, ' ').trim() : '';
  ok(/^From the office ?Draft three/.test(ct) && /Updated by Owner today at \d{1,2}:\d\d [AP]M/.test(ct), L('the crew card shows the notes and who updated them, and when: ' + ct));
  ok(new RegExp(mat.name.replace(/[()]/g, '.') + ' × 2').test(card() ? card().textContent : '') && /Mattress bag × 2/.test(card() ? card().textContent : ''), L('the materials the office added are on the crew’s job'));
  click('[data-act="mp:open"][data-id="' + P.id + '"]'); await sleep(10);
  ok(!mp().hidden && /\$/.test(tile(mat.id).textContent), L('Marcus (a lead) opens the same list, with prices'));
  click('#matpick [data-act="mp:add"][data-mid="' + mat.id + '"]'); await sleep(5);
  ok(cnt(mat.id) === n0 + 3 && P.materials.filter((x) => x.itemId === mat.id && x.by === 'Marcus').length === 1, L('his tap goes on his own line'));
  click('#matpick [data-act="mp:close"].btn'); await sleep(10);
  ok(/Materials added by Marcus: /.test(P.log[P.log.length - 1].ev), L('and Activity says it was Marcus'));
  click('[data-act="pv:end"]'); await sleep(10);
  // a crew member: no prices, and only takes off his own
  click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5);
  click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === 'crew' && b.dataset.staff === 'Dee')); await sleep(15);
  await A.go('crew');
  click('[data-act="mp:open"][data-id="' + P.id + '"]'); await sleep(10);
  ok(!mp().hidden && !/\$/.test(mp().textContent) && /The office prices anything not on the list/.test(mp().textContent), L('Dee sees no prices'));
  // Small box (mats[0]) was added by Owner and Marcus only
  ok(!P.materials.some((x) => x.itemId === mat.id && x.by === 'Dee'), L('(Dee has none of ' + mat.name + ' yet)'));
  const before = cnt(mat.id);
  click('#matpick [data-act="mp:minus"][data-mid="' + mat.id + '"]'); await sleep(10);
  ok(cnt(mat.id) === before && /Only the office or the crew lead can take off what someone else added\./.test(toastTxt()), L('she can’t take off what the office and Marcus added'));
  click('#matpick [data-act="mp:add"][data-mid="' + mat.id + '"]'); await sleep(5);
  ok(cnt(mat.id) === before + 1 && P.materials.some((x) => x.itemId === mat.id && x.by === 'Dee'), L('her tap goes on her own line'));
  click('#matpick [data-act="mp:minus"][data-mid="' + mat.id + '"]'); await sleep(5);
  ok(cnt(mat.id) === before && !P.materials.some((x) => x.itemId === mat.id && x.by === 'Dee'), L('and she can take off her own'));
  click('#matpick [data-act="mp:close"].btn'); await sleep(10);
  click('[data-act="pv:end"]'); await sleep(10);
  // a paid job: no Add materials
  const paid = st().jobs.find((j) => j.status === 'paid');
  click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:go"][data-tab="history"]'); await sleep(15);
  click('[data-act="job:open"][data-id="' + paid.id + '"]'); await sleep(20);
  ok(!$('#sheet [data-act="mp:open"]') && /This job is paid, so materials are locked\./.test(sheet()), L('a paid job has no Add materials'));
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);

  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
