// Job messages: crew confirm in the app; office sees who has; moving or removing resets it.
const { load, ok, sleep, summary } = require('./lib');
const file = process.argv[2], label = process.argv[3] || 'confirm';
(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, text, T } = A;
  const st = () => T.state();
  const job = st().jobs.find((j) => j.d.name === 'Priya Nair');
  const more = async (tab) => { click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:go"][data-tab="' + tab + '"]'); await sleep(15); };
  const preview = async (role, staff) => { click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5); click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === role && b.dataset.staff === staff)); await sleep(15); };
  const endPreview = async () => { click('[data-act="pv:end"]'); await sleep(15); };

  // ---- office sees nobody has confirmed
  ok(/Not confirmed yet/.test(text()) && /Marcus, Dee, Luis · Priya Nair today/.test(text()), label + ': Today lists who has not confirmed today’s job');
  ok(/Tanya, Andre · Hollis & Reed Law tomorrow/.test(text()), label + ': and tomorrow’s');
  click('[data-act="job:open"][data-id="' + job.id + '"]'); await sleep(15);
  ok(/Waiting on: Marcus, Dee, Luis/.test($('#sheet').textContent) && !/✓/.test($('#sheet').textContent), label + ': job sheet shows who it is waiting on');
  ok(!$('[data-act="jm:remind"]'), label + ': no text-a-reminder button without a company line');
  click('[data-act="sheet:close"]'); await sleep(5);
  click('[data-act="tab"][data-tab="dispatch"]'); await sleep(15);
  ok(/0\/3 confirmed/.test(text()), label + ': Board shows 0/3 confirmed');

  // ---- Dee's side
  await preview('crew', 'Dee');
  const badge = () => { const b = $('nav.tabs [data-tab="chat"] .badge'); return b ? +b.textContent : 0; };
  ok(badge() >= 1, label + ': Dee’s Chat tab shows a badge (' + badge() + ')');
  ok(/Confirm your jobs/.test(text()) && !!$('[data-act="jm:confirm"][data-id="' + job.id + '"]'), label + ': Dee’s Today starts with the job to confirm');
  click('[data-act="tab"][data-tab="chat"]'); await sleep(15);
  ok(/Job messages/.test(text()) && /1 job to confirm/.test(text()), label + ': Chat has a Job messages spot at the top');
  click('[data-act="chat:open"][data-t="jobs"]'); await sleep(15);
  const card = $('.jmsg');
  ok(card && /Booked today/.test(card.textContent) && /You’re on Priya Nair today at 8:00 AM\.\s*Pickup: 418 Oak St, Austin\s*Truck: Box 1 \(26 ft\)\s*Lead: Marcus\s*With: Marcus, Luis/.test(card.textContent), label + ': the message reads right: ' + (card && card.textContent.replace(/\s+/g, ' ')));
  // a forged tap for someone else does nothing
  const forged = w.document.createElement('button'); forged.dataset.act = 'jm:confirm'; forged.dataset.id = job.id; forged.dataset.who = 'Luis'; w.document.body.appendChild(forged); click(forged); forged.remove(); await sleep(5);
  ok(!(job.confirm && job.confirm.Luis), label + ': Dee cannot confirm for Luis');
  click('[data-act="jm:confirm"][data-id="' + job.id + '"]'); await sleep(15);
  ok(job.confirm.Dee && job.confirm.Dee.for === job.d.moveDate + ' 08:00', label + ': Dee confirmed for this day and time');
  ok(/Confirmed/.test($('.jmsg').textContent) && !$('[data-act="jm:confirm"]'), label + ': the message now says Confirmed');
  ok(/Confirmed\. See you today\./.test($('#toast').textContent), label + ': toast: ' + $('#toast').textContent);
  ok(job.log.some((l) => /Dee confirmed/.test(l.ev)), label + ': logged on the job');
  await endPreview();

  // ---- office sees it
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
  click('[data-act="job:open"][data-id="' + job.id + '"]'); await sleep(15);
  ok(/Dee ✓/.test($('#sheet').textContent) && /Confirmed: Dee/.test($('#sheet').textContent) && /Waiting on: Marcus, Luis/.test($('#sheet').textContent), label + ': office sees Dee ✓');

  // ---- moving the job asks again
  const tm = $('#sheet input[data-j="time"]'); tm.value = '09:30'; tm.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(15);
  ok(/Waiting on: Marcus, Dee, Luis/.test($('#sheet').textContent), label + ': new start time, Dee has to confirm again');
  // ---- taking someone off drops their confirmation
  job.confirm.Luis = { ts: 1, for: job.d.moveDate + ' 09:30' };
  click($$('#sheet [data-act="sh:crew"]').find((c) => c.dataset.n === 'Luis')); await sleep(10);
  ok(!job.confirm.Luis && job.assign.crew.indexOf('Luis') < 0, label + ': removing Luis drops his confirmation');
  click($$('#sheet [data-act="sh:crew"]').find((c) => c.dataset.n === 'Luis')); await sleep(10);
  ok(/Waiting on: Marcus, Dee, Luis/.test($('#sheet').textContent), label + ': adding him back asks again');
  click('[data-act="sheet:close"]');
  await preview('crew', 'Dee');
  click('[data-act="tab"][data-tab="chat"]'); await sleep(10); click('[data-act="chat:open"][data-t="jobs"]'); await sleep(10);
  ok(/The day or time changed\./.test($('.jmsg').textContent) && /today at 9:30 AM/.test($('.jmsg').textContent), label + ': Dee’s message says the time changed');
  await endPreview();

  // ---- Setup
  await more('settings');
  ok(!!$('input[data-s="comms.alerts.tomorrow"]') && /evening before/.test(text()), label + ': Setup has the evening-before switch');

  // ---- a text link opens Job messages
  const B = await load(file, { hash: '#messages' });
  ok(B.T.state() && B.$('#view') && /Job messages/.test(B.$('#view').textContent), label + ': a link ending #messages opens Job messages');

  ok(A.errors.length === 0 && B.errors.length === 0, label + ': no errors (' + A.errors.concat(B.errors).slice(0, 3).join(' | ') + ')');
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
