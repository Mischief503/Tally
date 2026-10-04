const { load, ok, sleep, summary } = require('./lib');
const file = process.argv[2], label = process.argv[3] || 'minpay';
(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, text, T } = A;
  const st = () => T.state();
  const more = async (tab) => { click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:go"][data-tab="' + tab + '"]'); await sleep(15); };
  const deeRow = () => { const r = $$('table.tbl tr').find((tr) => /^Dee/.test((tr.cells[0] || {}).textContent || '')); return r ? Array.from(r.cells).map((c) => c.textContent.trim()) : null; };
  await more('reports');
  const before = deeRow();
  ok(before && before.length === 6, label + ': hours table has Clock, On jobs, Min. top-up, Pay hours, Late notes: ' + before);

  // a job that takes one hour
  const finishShort = async (name, mins) => {
    const j = st().jobs.find((x) => x.d.name === name);
    j.status = 'active'; j.startedAt = Date.now() - mins * 60000; j.phases = { loadStart: j.startedAt + 5e5, loadEnd: j.startedAt + 1e6, unloadStart: j.startedAt + 1.5e6, unloadEnd: Date.now() - 1000 };
    click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
    click('[data-act="job:open"][data-id="' + j.id + '"]'); await sleep(15);
    click('#sheet [data-act="sh:next"]'); await sleep(15);
    if (!$('#flow').hidden && $('#sigPad')) { $('#sigName').value = name; $('#sigAgree').checked = true; $('#sigPad').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true })); click('#flow [data-act="flow:sign"]'); await sleep(15); }
    click('#flow [data-act="flow:close"]'); await sleep(10);
    return j;
  };
  const j = await finishShort('Priya Nair', 60);
  ok(j.status === 'done' && j.actualHours === 1 && j.minPaid === 3, label + ': 1-hour job finished, 3-hour minimum stored with it');
  ok(/Crew paid 3 h each \(the 3-hour minimum; the job took 1 h\)/.test($('#sheet').textContent), label + ': job sheet says crew paid 3 h each');
  ok(T.jobDoc(j).minPaid === 3, label + ': the minimum syncs with the job');
  click('[data-act="sheet:close"]');

  await more('reports');
  const after = deeRow();
  ok(after[3] === '+2.0', label + ': Dee gets a 2-hour top-up: ' + after);
  ok(Math.abs(parseFloat(after[4]) - parseFloat(before[4]) - 3) < 0.05, label + ': her pay hours go up by 3 (' + before[4] + ' → ' + after[4] + ')');
  ok(/1-hour job on a 3-hour minimum pays 3/.test(text()), label + ': the report explains it');

  // Dee sees it on her phone
  click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5);
  click($$('#more [data-act="pv:set"]').find((b) => b.dataset.staff === 'Dee')); await sleep(10);
  await more('crew');
  ok(/You’re paid 3 h \(the 3-hour minimum; the job took 1 h\)/.test(text()), label + ': Dee sees she is paid 3 h for it');
  click('[data-act="pv:end"]'); await sleep(10);

  // a long job is paid as worked
  const long = await finishShort('Hollis & Reed Law', 250);
  ok(long.actualHours > 4 && /\(job time\)/.test($('#sheet').textContent) && !/minimum; the job took/.test($('#sheet').textContent), label + ': a 4+ hour job is paid as worked');
  click('[data-act="sheet:close"]');

  // switch it off: new short jobs pay as worked; finished ones keep their minimum
  await more('settings');
  const cb = $('input[data-s="payMin"]');
  ok(cb && cb.checked && /Pay the crew the 3-hour minimum when a job runs short/.test(text()), label + ': Setup has the switch, on');
  ok(/Minimum hours \(billed, and paid to the crew\)/.test(text()), label + ': rate card says the minimum is paid too');
  cb.checked = false; cb.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(5);
  const n3 = await finishShort('Nadia Farouk', 60);
  ok(n3.minPaid === 0 && /Crew paid 1 h each \(job time\)/.test($('#sheet').textContent), label + ': with it off, a 1-hour job pays 1 h');
  ok(/Crew paid 3 h each/.test((click('[data-act="sheet:close"]'), click('[data-act="job:open"][data-id="' + j.id + '"]'), await sleep(15), $('#sheet').textContent)), label + ': the earlier job still pays its 3 h');
  ok(A.errors.length === 0, label + ': no errors (' + A.errors.slice(0, 3).join(' | ') + ')');
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
