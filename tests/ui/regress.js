// On-device run of either edition: the whole job lifecycle, money, themes, desktop navigation,
// and that the Twilio pieces stay switched off where they cannot work.
const { load, ok, sleep, summary } = require('./lib');
const file = process.argv[2], label = process.argv[3] || file;

(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, text, T } = A;
  let fetched = 0; w.fetch = () => { fetched++; return Promise.reject(new Error('no network')); };
  ok(!w.tallyComms, label + ': no texting service on-device');
  ok(T.state().jobs.length >= 10, label + ': sample data loads');
  ok(T.state().settings.comms && T.state().settings.comms.alerts.assigned === true, label + ': texting settings exist with defaults');

  // quote -> book
  click('#fab'); await sleep(20);
  const nm = $('[data-d="name"]'); nm.value = 'Test Customer'; nm.dispatchEvent(new w.Event('input', { bubbles: true }));
  const ph = $('[data-d="phone"]'); ph.value = '512-555-0199'; ph.dispatchEvent(new w.Event('input', { bubbles: true }));
  click('[data-act="q:step"][data-s="2"]'); await sleep(10);
  for (let i = 0; i < 3; i++) click('[data-act="inc"][data-id="sofa3"]');
  for (let i = 0; i < 10; i++) click('[data-act="inc"][data-id="boxm"]');
  click('[data-act="q:step"][data-s="3"]'); await sleep(10);
  ok(/\$/.test($('#qTot').textContent) && $('#qTot').textContent !== '$0', label + ': quote priced ' + $('#qTot').textContent);
  click('[data-act="q:book"]'); await sleep(30);
  const job = T.state().jobs.find((j) => j.d.name === 'Test Customer');
  ok(job && job.status === 'booked', label + ': booked');
  // schedule in the sheet
  const d = $('#sheet input[data-j="moveDate"]'); d.value = new Date().toISOString().slice(0, 10); d.dispatchEvent(new w.Event('change', { bubbles: true }));
  const tr = $('#sheet select[data-jassign="truckId"]'); tr.value = 't26'; tr.dispatchEvent(new w.Event('change', { bubbles: true }));
  click($$('#sheet [data-act="sh:crew"]').find((c) => c.dataset.n === 'Marcus'));
  click($$('#sheet [data-act="sh:crew"]').find((c) => c.dataset.n === 'Dee'));
  ok(job.assign.crew.join() === 'Marcus,Dee' && job.assign.truckId === 't26', label + ': crew and truck scheduled');
  ok(!/Calls and texts/.test($('#sheet').textContent), label + ': no call log section on-device');
  // call prompt unchanged on-device
  click('#sheet [data-act="call:cust"]'); await sleep(10);
  const cb = $$('#call .bigbtn');
  ok(cb.length === 2 && cb[0].getAttribute('href') === 'tel:5125550199' && cb[1].getAttribute('href') === 'tel:*675125550199' && !$('#call [data-act="call:company"]'), label + ': call prompt is the original two choices');
  click('#call [data-act="call:go"][data-pref="hide"]'); await sleep(10);
  ok(T.state().ui.callPrefs['5125550199'] === 'hide', label + ': private choice remembered');
  click('#sheet [data-act="call:cust"]'); await sleep(10);
  ok($$('#call .bigbtn')[0].getAttribute('href') === 'tel:*675125550199', label + ': and offered first next time');
  click('#call [data-act="call:close"]');
  // start, finish, sign, pay
  click('#sheet [data-act="sh:next"]'); await sleep(10);
  ok(!$('#start').hidden && job.status === 'booked', label + ': Start job asks about the arrival text first');
  click('#start [data-act="go:start"]'); await sleep(20);
  ok(job.status === 'active' && $('#start').hidden, label + ': started');
  click('#sheet [data-act="sh:next"]'); await sleep(10);
  ok(job.status === 'active' && !$('#flow').hidden && /Sign to close the job/.test($('#flow').textContent), label + ': finishing asks for signatures and the job stays open');
  $('#sigName').value = 'Test Customer'; $('#sigAgree').checked = true;
  $('#sigPad').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  click('#flow [data-act="flow:sign"]'); await sleep(20);
  ok(job.signed.length === 1 && job.status === 'done', label + ': signed, and only then finished');
  click('#flow [data-act="flow:method"][data-m="card"]'); await sleep(10);
  const set = (id, v) => { const e = $(id); e.value = v; e.dispatchEvent(new w.Event('input', { bubbles: true })); };
  set('#cardNum', '4242424242424242'); set('#cardExp', '1230'); set('#cardCvc', '123');
  ok($('#cardNum').value === '4242-4242-4242-4242' && $('#cardExp').value === '12/30', label + ': card fields format');
  click('#flow [data-act="flow:pay"]'); await sleep(20);
  ok(job.status === 'paid' && /Paid in full/.test($('#flow').textContent), label + ': paid in full');
  ok(!JSON.stringify(T.state()).includes('4242424242424242'), label + ': full card number never stored');
  click('#flow [data-act="flow:close"]'); await sleep(10);
  ok(fetched === 0, label + ': nothing tried to reach the network');
  ok(/#call,#start\{position:fixed/.test(w.document.querySelector('style').textContent), label + ': call and start prompts are real overlays');
  click('[data-act="sheet:close"]');

  // setup card on-device
  click('[data-act="more:open"]'); await sleep(10); click('[data-act="more:go"][data-tab="settings"]'); await sleep(20);
  ok(/Texts and calls/.test(text()) && /run on the hosted edition/.test(text()), label + ': Setup explains texting runs on the hosted edition');
  ok($$('input[data-s^="comms.alerts."]').length === 4, label + ': alert switches still editable');

  // money colours fixed across every theme, and every theme applies cleanly
  const themes = (w.document.querySelector('#themeBtn') && (click('#themeBtn'), await sleep(10), $$('[data-act="theme:set"]'))) || [];
  ok(themes.length === 24, label + ': 24 themes offered');
  for (const t of themes.map((b) => b.dataset.t)) { click($$('[data-act="theme:set"]').find((b) => b.dataset.t === t)); await sleep(2); }
  click('[data-act="theme:close"]');
  const css = w.document.querySelector('style').textContent;
  ok(/--paid:#0A7A3D/.test(css) && /\.pill\[data-s=paid\]\{background:var\(--paid\)!important/.test(css), label + ': paid stays fixed green');

  // desktop: More still reachable for themes, preview and sign-out
  w.innerWidth = 1200; w.dispatchEvent(new w.Event('resize')); await sleep(10);
  ok(!!$('nav.tabs [data-act="more:open"]') && $$('nav.tabs [data-act="tab"]').length >= 7, label + ': desktop sidebar keeps More');
  click('nav.tabs [data-act="more:open"]'); await sleep(10);
  ok(!$('#more').hidden && !!$('#more [data-act="more:preview"]'), label + ': More opens on desktop with preview');
  click('#more [data-act="more:preview"]'); await sleep(10);
  click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === 'crew')); await sleep(20);
  ok(T.state().ui.role === 'crew' && !$('#pvBar').hidden, label + ': preview as crew');
  click('[data-act="pv:end"]'); await sleep(10);
  ok(T.state().ui.role === 'owner', label + ': back to owner');

  ok(A.errors.length === 0, label + ': no errors (' + A.errors.slice(0, 3).join(' | ') + ')');
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
