// Typed job info is saved with a button (Richie, Oct 12: "When dispatch enters new info on the job say
// job notes or material, there need to be a save button there to save the new info so everyone can see
// what was added"). Job notes and the customer and route wait for Save; the material and cost forms keep
// what was picked until Save material / Save cost; leaving with something unsaved asks first; the crew
// card says who changed the office's notes and when.
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

  /* ---------------- materials and costs ---------------- */
  await open(P);
  const key = 's_' + P.id, mats0 = (P.materials || []).length, costs0 = (P.costs || []).length;
  const mat = st().settings.materials[0];
  ok(/Save material/.test($('#matSave_' + key).textContent) && /Save cost/.test($('#costSave_' + key).textContent) && $('#matHint_' + key).hidden, L('the forms have Save material and Save cost'));
  type('#mat_i_' + key, mat.id, 'change'); type('#mat_q_' + key, '3');
  ok(!$('#matHint_' + key).hidden && $('#matSave_' + key).classList.contains('primary') && /Not saved yet\. Tap Save material so everyone on the job sees it\./.test($('#matHint_' + key).textContent), L('picking a material says it isn’t saved yet'));
  ok(/Not saved/.test($('#sheet details[data-k="sh:Materials and costs"] summary').textContent), L('and so does the Materials and costs header'));
  T.render(); await sleep(10);
  ok($('#mat_i_' + key).value === mat.id && $('#mat_q_' + key).value === '3' && !$('#matHint_' + key).hidden, L('a redraw keeps the pick and the quantity'));
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);
  ok(!!leave() && /Not saved yet: the material you picked\./.test(leave().textContent), L('closing asks about the material'));
  click('#sheet [data-act="jed:keep"]'); await sleep(5);
  click('#matSave_' + key); await sleep(15);
  const m = P.materials[P.materials.length - 1];
  ok(P.materials.length === mats0 + 1 && m.name === mat.name && m.qty === 3 && m.by === 'Owner', L('Save material puts it on the job, from Owner'));
  ok(new RegExp('Saved: ' + mat.name.replace(/[()]/g, '.') + ' × 3\\. Everyone on the job sees it\\.').test(toastTxt()) && $('#mat_i_' + key).value === '' && $('#matHint_' + key).hidden, L('it says so, and the form is ready for the next one'));
  type('#cost_l_' + key, 'Dump fee'); type('#cost_a_' + key, '4000');
  ok(!$('#costHint_' + key).hidden && $('#costSave_' + key).classList.contains('primary'), L('typing a cost says it isn’t saved yet'));
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);
  ok(/Not saved yet: the job cost you typed\./.test(leave().textContent), L('closing asks about the cost'));
  click('#sheet [data-act="jed:saveall"]'); await sleep(20);
  ok($('#sheet').hidden && P.costs.length === costs0 + 1 && P.costs[P.costs.length - 1].label === 'Dump fee' && P.costs[P.costs.length - 1].amt === 40, L('Save from the question saves the cost and closes'));
  await open(P);
  type('#mat_i_' + key, 'other', 'change');
  type('#sheet textarea[data-j="notes"]', 'Draft three');
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);
  ok(/Not saved yet: the job notes and the material you picked\./.test(leave().textContent), L('two things unsaved: both named'));
  click('#sheet [data-act="jed:saveall"]'); await sleep(20);
  ok(!$('#sheet').hidden && !leave() && /Say what the material was\./.test(toastTxt()) && P.d.notes === 'Draft three', L('a material that can’t go in yet: the notes save, the sheet stays open and says what’s missing'));
  type('#mat_n_' + key, 'Mattress bag');
  click('#matSave_' + key); await sleep(15);
  ok(P.materials.some((x) => x.name === 'Mattress bag' && x.price == null), L('then Save material adds it, for the office to price'));
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);
  ok($('#sheet').hidden, L('and the sheet closes'));

  /* ---------------- the crew sees what the office added ---------------- */
  click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5);
  click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === 'lead' && b.dataset.staff === 'Marcus')); await sleep(15);
  await A.go('crew');
  const card = $$('.crewcard').find((c) => c.querySelector('[data-segs="' + P.id + '"]'));
  const ct = card ? card.textContent.replace(/\s+/g, ' ') : '';
  ok(/From the office: Draft three/.test(ct) && /Updated by Owner today at \d{1,2}:\d\d [AP]M/.test(ct), L('the crew card shows the notes and who updated them, and when'));
  ok(P.materials.some((x) => x.name === mat.name) && card && /Materials/.test(card.textContent), L('the materials the office saved are on the crew’s job'));
  // a lead's own material form on the card keeps its pick too
  const ck = 'c_' + P.id;
  click('[data-act="cr:seg"][data-id="' + P.id + '"][data-k="mats"]'); await sleep(5);
  type('#mat_i_' + ck, mat.id, 'change'); type('#mat_q_' + ck, '2');
  T.render(); await sleep(10);
  ok($('#mat_i_' + ck) && $('#mat_i_' + ck).value === mat.id && $('#mat_q_' + ck).value === '2' && !$('#matHint_' + ck).hidden, L('on the crew card, a redraw keeps the lead’s pick'));
  click('#matSave_' + ck); await sleep(15);
  ok(P.materials.filter((x) => x.name === mat.name).length === 2 && P.materials[P.materials.length - 1].by === 'Marcus', L('and Save material adds it from Marcus'));
  click('[data-act="pv:end"]'); await sleep(10);

  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
