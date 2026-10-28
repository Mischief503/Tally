// Dragging the move into a slot, in a real browser (Chromium), on a phone and on a computer (Richie, Oct 25: "the call
// center is a real person so it should be something they look and drag and drop to a slot . Dispatch selects the truck
// and crew members."). The rules behind it are in dayplan.js. Run: node tests/ui/dayplan-drag.js
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('playwright-core')); }
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname + '/../../build/tally-artifact.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };

async function run(width, tag) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(() => { window.__TALLY_TEST = true; });
  await p.goto(FILE);
  await sleep(400);
  const tap = async (sel) => { await p.click(sel); await sleep(90); };
  await tap('[data-act="more:open"]'); await tap('[data-act="more:preview"]');
  await tap('#more [data-act="pv:set"][data-role="callcenter"]');
  await sleep(150);
  await p.evaluate(() => document.querySelector('[data-act="fab:quote"]').click()); await sleep(120);
  // tomorrow in the sample data: Hollis & Reed Law 10–1:30 and Nadia Farouk 11–2, both on Box 2 (slot 2)
  const tom = await p.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  await p.fill('[data-d="name"]', 'Dana Whit'); await p.fill('[data-d="moveDate"]', tom); await p.fill('[data-d="time"]', '09:00');
  await tap('[data-act="q:step"][data-s="2"]');
  const inc = await p.$$('[data-act="inc"]');
  for (let i = 0; i < 14; i++) await inc[i % 6].click();
  await tap('[data-act="q:step"][data-s="3"]');
  await (await p.$('#dayPlan')).scrollIntoViewIfNeeded();
  await sleep(150);
  const st = await p.evaluate(() => +document.querySelector('#dayPlan .tl').dataset.start), span = await p.evaluate(() => +document.querySelector('#dayPlan .tl').dataset.span);
  const draft = () => p.evaluate(() => ({ time: window.__tally.state().draft.time, slots: window.__tally.state().draft.slots }));
  const msg = async () => (await p.textContent('#dayPlan')).replace(/\s+/g, ' ');
  const lanesNow = () => p.$$('#dayPlan .tl-track[data-lane]');   // drawn again after each change
  ok((await lanesNow()).length === 3 && !!(await p.$('#dayPlan .tl-tray .tl-drag')), tag + ': three slots, and the move above them to drag');
  // the page doesn't run off the side
  ok(await p.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1), tag + ': nothing runs off the side');
  // drag it from above the slots into slot 1 at about 1:30 PM
  const drag = async (fromSel, laneIx, hm, look) => {
    const bb = await (await p.$(fromSel)).boundingBox(), lb = await (await lanesNow())[laneIx].boundingBox();
    const gx = bb.x + 10, gy = bb.y + bb.height / 2, left = lb.x + (hm * 60 - st) / span * lb.width;
    await p.mouse.move(gx, gy); await p.mouse.down();
    await p.mouse.move(gx + 15, gy + 12, { steps: 3 });
    await p.mouse.move(left + 10, lb.y + lb.height / 2, { steps: 10 });
    await sleep(60);
    const seen = await p.evaluate(() => { const v = document.querySelector('#dayPlan .tl-prev'), g = document.querySelector('.tl-ghost'); return { prev: v ? v.className + '|' + v.textContent : '', ghost: !!g, lift: !!document.querySelector('#dayPlan .tl-lift') }; });
    if (look) await look(seen);
    await p.mouse.up(); await sleep(150);
    return seen;
  };
  let seen = await drag('#dayPlan .tl-tray .tl-drag', 0, 13.5);
  ok(seen.ghost && seen.lift && seen.prev === 'tl-prev ok|1:30 PM', tag + ': while dragging, the move follows the pointer and slot 1 shows where it would start, green: ' + seen.prev);
  let d = await draft();
  ok(d.time === '13:30' && d.slots.join() === 't16' && /In slot 1 from 1:30 PM to 5:00 PM\./.test(await msg()) && !(await p.$('.tl-ghost')) && !(await p.$('#dayPlan .tl-prev')) && !(await p.$('#dayPlan .tl-tray')), tag + ': let go: in slot 1 at 1:30 PM, and nothing left behind');
  const cells = await p.$$eval('#dayPlan .tl-cells span', (c) => c.map((x) => x.textContent + (x.classList.contains('over') ? '!' : '')));
  ok(cells.slice(6, 10).join(',') === '5,3,3,3' && !cells.some((c) => /!/.test(c)), tag + ': the movers each hour with it: ' + cells.join(' '));
  // drag it onto slot 2 where Hollis & Reed is: red, and it says why
  seen = await drag('#dayPlan .tl-track[data-lane] .tl-drag', 1, 10.5);
  ok(seen.prev === 'tl-prev bad|10:30 AM · no room', tag + ': over slot 2 at 10:30 the slot shows red: ' + seen.prev);
  d = await draft();
  ok(d.time === '10:30' && d.slots.join() === 't20' && /Slot 2 has Hollis & Reed Law from 10:00 AM to 1:30 PM, and 60 minutes between moves\./.test(await msg()) && !!(await p.$('#dayPlan .tl-new.bad')), tag + ': let go there: it says Hollis & Reed is in slot 2 then');
  await p.click('[data-act="q:book"]'); await sleep(150);
  ok(/It doesn’t fit in slot 2 at 10:30 AM\. Move it to a slot with room\./.test(await p.textContent('#toast')), tag + ': the call center can’t book it there');
  // a short tap on the move doesn't move it (a click right after a drag is the drag's own, and is let go)
  await sleep(300); await p.click('#dayPlan .tl-drag'); await sleep(120);
  d = await draft();
  ok(d.time === '10:30' && /Drag it onto a slot, or tap a slot where it should start\./.test(await p.textContent('#toast')), tag + ': a tap on the move says how, and leaves it');
  // tap slot 3 at about 2:00 PM
  const l3 = await (await lanesNow())[2].boundingBox();
  await p.mouse.click(l3.x + (14 * 60 + 4 - st) / span * l3.width, l3.y + l3.height / 2); await sleep(150);
  d = await draft();
  ok(d.time === '14:00' && d.slots.join() === 't26' && /In slot 3 from 2:00 PM to 5:30 PM\./.test(await msg()), tag + ': tap slot 3 at about 2: it starts there, to the quarter hour');
  await p.click('[data-act="q:book"]'); await sleep(300);
  const booked = await p.evaluate(() => { const j = window.__tally.state().jobs.find((x) => x.d.name === 'Dana Whit'); return j && { status: j.status, slots: j.d.slots, truck: j.assign.truckId }; });
  ok(booked && booked.status === 'booked' && booked.slots.join() === 't26' && !booked.truck && /in slot 3\. Dispatch adds the truck and crew\./.test(await p.textContent('#toast')), tag + ': booked in slot 3, no truck put on it');
  ok(errors.length === 0, tag + ': no errors (' + errors.slice(0, 2).join(' | ') + ')');
  await b.close();
}

(async () => {
  await run(390, 'phone');
  await run(1000, 'computer');
  console.log(`\ndayplan-drag: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
