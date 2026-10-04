// The crew lead's day on one job: start with an arrival text, four load/unload taps, sign to close, and the crew timing report.
const { load, ok, sleep, summary } = require('./lib');
const file = process.argv[2], label = process.argv[3] || 'field';
(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, text, T } = A;
  const st = () => T.state();
  const job = st().jobs.find((j) => j.d.name === 'Priya Nair');
  const go = async (tab) => { click('[data-act="more:open"]'); await sleep(10); click('[data-act="more:go"][data-tab="' + tab + '"]'); await sleep(20); };
  await go('crew');
  ok(/Working as/.test(text()) && !!$('[data-act="cr:start"][data-id="' + job.id + '"]'), label + ': Priya Nair is on the field screen with Start job');

  // ---- the start prompt
  click('[data-act="cr:start"][data-id="' + job.id + '"]'); await sleep(10);
  ok(!$('#start').hidden && job.status === 'booked', label + ': Start job opens the prompt without starting yet');
  ok($('#etaOn').checked && $('#etaOut').textContent.trim() === '30min', label + ': arrival text on, 30 minutes by default');
  ok(/^Your Moving Co\.: Hi Priya, your crew is on the way and should arrive in about 30 minutes, around \d{1,2}:\d\d [AP]M\.$/.test($('#etaMsg').textContent), label + ': message preview: ' + $('#etaMsg').textContent);
  click('[data-act="go:mins"][data-d="5"]'); await sleep(5);
  ok(/about 35 minutes/.test($('#etaMsg').textContent), label + ': +5 makes it 35');
  click('[data-act="go:mins"][data-d="-5"]'); click('[data-act="go:mins"][data-d="-5"]'); await sleep(5);
  ok(/about 25 minutes/.test($('#etaMsg').textContent), label + ': −5 twice makes it 25');
  click('[data-act="go:set"][data-m="45"]'); await sleep(5);
  const link = $('#start [data-act="go:start"]');
  ok(link.tagName === 'A' && /^sms:5125550142\?&body=/.test(link.getAttribute('href')) && decodeURIComponent(link.getAttribute('href').split('body=')[1]).includes('about 45 minutes'), label + ': no company line, so the button opens the texting app with the message');
  ok(/Opens your texting app/.test($('#start').textContent) && !!$('[data-act="go:copy"]'), label + ': says it comes from your own number, with a copy button');
  const cb = $('#etaOn'); cb.checked = false; cb.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(5);
  ok($('#start [data-act="go:start"]').tagName === 'BUTTON' && /^Start job$/.test($('#start [data-act="go:start"]').textContent) && !$('#etaMsg'), label + ': unticked, it just starts the job');
  const cb2 = $('#etaOn'); cb2.checked = true; cb2.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(5);
  click('[data-act="go:close"]'); await sleep(5);
  ok($('#start').hidden && job.status === 'booked', label + ': Cancel leaves the job booked');
  click('[data-act="cr:start"][data-id="' + job.id + '"]'); await sleep(10);
  ok(/about 30 minutes/.test($('#etaMsg').textContent), label + ': cancelled choice is not remembered');
  click('[data-act="go:set"][data-m="45"]'); await sleep(5);
  click('#start [data-act="go:start"]'); await sleep(20);
  ok(job.status === 'active' && job.startedAt > 0 && $('#start').hidden, label + ': job started and the prompt closes');
  ok(job.log.some((l) => /Arrival text opened .*about 45 min/.test(l.ev)) && st().ui.etaMins === 45, label + ': logged on the job, and 45 is offered next time');

  // ---- the four steps
  const btn = () => $('.crewcard [data-id="' + job.id + '"].primary');
  ok(btn() && btn().textContent === 'Start loading' && !$('[data-act="cr:finish"][data-id="' + job.id + '"]'), label + ': next step is Start loading, no Finish yet');
  ok(/On the way.*since/.test($('.phz').textContent.replace(/\s+/g, ' ')), label + ': timeline shows On the way, running');
  click(btn()); await sleep(5);
  ok(job.phases.loadStart > 0 && btn().textContent === 'Done loading', label + ': Start loading recorded');
  click(btn()); await sleep(5);
  ok(job.phases.loadEnd > 0 && btn().textContent === 'Start unloading', label + ': Done loading recorded');
  click('[data-act="cr:phaseundo"][data-id="' + job.id + '"]'); await sleep(5);
  ok(!job.phases.loadEnd && btn().textContent === 'Done loading', label + ': Undo takes back the last tap');
  click(btn()); await sleep(5);
  // a stale double-tap of the same step does nothing
  const stale = w.document.createElement('button'); stale.dataset.act = 'cr:phase'; stale.dataset.id = job.id; stale.dataset.k = 'loadStart'; stale.dataset.who = 'Marcus'; w.document.body.appendChild(stale);
  const before = JSON.stringify(job.phases); click(stale); await sleep(5);
  ok(JSON.stringify(job.phases) === before, label + ': a stale tap cannot skip or repeat a step'); stale.remove();
  click(btn()); await sleep(5); click(btn()); await sleep(5);
  ok(job.phases.unloadStart && job.phases.unloadEnd && btn().textContent === 'Get signatures and finish', label + ': after Done unloading, finishing needs signatures');
  ok(job.phases.loadStart <= job.phases.loadEnd && job.phases.loadEnd <= job.phases.unloadStart && job.phases.unloadStart <= job.phases.unloadEnd, label + ': times are in order');
  ok(job.log.filter((l) => /Loading started|Loading done|Unloading started|Unloading done/.test(l.ev)).length >= 4, label + ': each step logged');

  // ---- signatures before closing
  click(btn()); await sleep(20);
  ok(!$('#flow').hidden && /Sign to close the job/.test($('#flow').textContent) && job.status === 'active', label + ': Finish opens signing; the job is still open');
  click('#flow [data-act="flow:close"]'); await sleep(20);
  ok(job.status === 'active' && /stays open until the customer signs/.test($('#toast').textContent), label + ': leaving without signing keeps it open');
  click('[data-act="tab"][data-tab="today"]'); await sleep(20);
  ok(/Unloaded, waiting on a signature/.test(text()) && /Unloaded, needs sign-off/.test(text()), label + ': Today shows it waiting on a signature');
  click('[data-act="job:open"][data-id="' + job.id + '"]'); await sleep(20);
  const ss = $('#sheet select[data-jstatus]'); ss.value = 'done'; ss.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(10);
  ok(job.status === 'active' && /has to sign Delivery receipt and release before this job can close/.test($('#toast').textContent), label + ': the office cannot mark it complete either');
  ok(/On-site times/.test($('#sheet').textContent) && /Loading.*–.*·/.test($('#sheet').textContent.replace(/\s+/g, ' ')), label + ': office sheet shows on-site times');
  ok(/Get signatures and finish/.test($('#sheet').textContent), label + ': office button says what finishing needs');
  click('#sheet [data-act="sh:next"]'); await sleep(20);
  $('#sigName').value = 'Priya Nair'; $('#sigAgree').checked = true;
  $('#sigPad').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  click('#flow [data-act="flow:sign"]'); await sleep(20);
  ok(job.status === 'done' && job.finishedAt > 0 && /Collect payment/.test($('#flow').textContent), label + ': signed, finished, straight to payment');
  click('#flow [data-act="flow:close"]'); click('[data-act="sheet:close"]'); await sleep(10);

  // ---- reports
  await go('reports');
  const rep = $$('section.card, details.acc.card').find((c) => /Time on the job by crew/.test(c.textContent));
  ok(!!rep, label + ': Reports has Time on the job by crew');
  const rows = rep ? rep.querySelectorAll('tr') : [];
  const mrow = Array.from(rows).find((r) => /Marcus’s crew/.test(r.textContent));
  ok(mrow && mrow.querySelectorAll('td').length === 7 && /\d+h|\d+m/.test(mrow.textContent) && /\d/.test(mrow.lastElementChild.textContent), label + ': Marcus’s crew row: ' + (mrow && mrow.textContent));
  ok(Array.from(rows).some((r) => /All crews/.test(r.textContent)), label + ': company-wide row');

  // ---- a job with no phone
  const nf = st().jobs.find((j) => j.d.name === 'Hollis & Reed Law'); nf.d.phone = '';
  await go('crew');
  const ms = $('#meSel'); ms.value = 'Tanya'; ms.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(10);
  click('[data-act="cr:start"][data-id="' + nf.id + '"]'); await sleep(10);
  ok(/No phone number on this job/.test($('#start').textContent) && $('#start [data-act="go:start"]').textContent === 'Start job', label + ': no phone, just Start job');
  click('[data-act="go:close"]');

  // ---- crew who aren't leads only see where things are
  click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5);
  click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === 'crew' && b.dataset.staff === 'Dee')); await sleep(10);
  const pj = st().jobs.find((j) => j.d.name === 'Ortega family'); pj.status = 'active'; pj.assign.crew = ['Dee', 'Marcus']; pj.startedAt = Date.now() - 6e5; pj.phases = { loadStart: Date.now() - 3e5 };
  await go('crew');
  ok(/Loading · \d+m/.test(text()) && !$('[data-act="cr:phase"]'), label + ': base crew see "Loading · 5m" and no step buttons');

  ok(A.errors.length === 0, label + ': no errors (' + A.errors.slice(0, 3).join(' | ') + ')');
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
