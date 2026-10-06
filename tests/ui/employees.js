// Employee profiles: the owner's Employees list and profile editor, documents, sign-in linking,
// My profile for each person, App access approvals, expiry warnings, and the on-device copy.
const { load, ok, sleep, summary } = require('./lib');
const HOSTED = __dirname + '/../../build/tally-supabase.html';
const ARTIFACT = __dirname + '/../../build/tally-artifact.html';
const ORG = 'org-1';
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

function seed() {
  const docs = [];
  const put = (path, data) => { const [collection, doc_id] = path.split('/'); docs.push({ org_id: ORG, path, collection, doc_id, data, updated_at: new Date().toISOString() }); };
  put('meta/init', { ts: 1, mode: 'fresh' });
  put('org/settings', { company: 'Ace Moving', crew: ['Marcus', 'Dee', 'Luis'], leads: ['Marcus'], office: [{ name: 'Owner', kind: 'owner' }],
    contacts: { Owner: '512-555-0100', Marcus: '512-555-0101', Dee: '512-555-0102', Luis: '' }, trucks: [{ id: 't26', name: 'Box 1', cf: 1700 }] });
  return {
    docs,
    members: [{ org_id: ORG, user_id: 'u-owner', email: 'o@x.com', staff: 'Owner', role: 'owner', ts: 1 },
              { org_id: ORG, user_id: 'u-marcus', email: 'marcus@x.com', staff: 'Marcus', role: 'lead', ts: 1 }],
    access_requests: [{ org_id: ORG, user_id: 'u-new', email: 'dee.r@x.com', ts: 1 }],
    employees: [{ id: 'e-marcus', org_id: ORG, name: 'Marcus', role: 'lead', email: 'marcus@x.com', user_id: 'u-marcus', active: true,
      info: { phone: '512-555-0101', payType: 'Hourly', payRate: '24', title: 'Crew lead', dlExpires: day(10), medExpires: day(-3), ssnLast4: '4321' }, notes: 'Owner only: great with pianos' }],
    comm_lines: [],
  };
}
const set = (A, sel, v) => { const el = A.$(sel); el.value = v; el.dispatchEvent(new A.w.Event('input', { bubbles: true })); el.dispatchEvent(new A.w.Event('change', { bubbles: true })); };
const empText = (A) => (A.$('#emp') ? A.$('#emp').textContent.replace(/\s+/g, ' ') : '');

(async () => {
  /* ================= hosted: the owner ================= */
  let db = seed();
  let A = await load(HOSTED, { db, org: ORG, me: { uid: 'u-owner', email: 'o@x.com' } });
  let { w, $, $$, click, text, calls, T } = A;
  ok(calls.rpc.findIndex((c) => c.name === 'claim_invites') >= 0 && calls.rpc.findIndex((c) => c.name === 'claim_invites') < calls.rpc.findIndex((c) => c.name === 'my_orgs'), 'sign-in links profiles (claim_invites) before listing companies');

  // Today warns about Marcus's license and medical card
  click('[data-act="tab"][data-tab="today"]'); await sleep(60);
  ok(/Marcus.s driver.s license expires soon/.test(text()), 'Today: a license running out in 10 days');
  ok(/Marcus.s DOT medical card has expired/.test(text()), 'Today: a DOT medical card that has expired');
  const al = $$('.alert[data-act="emp:open"]')[0];
  click(al); await sleep(30);
  ok(!$('#emp').hidden && /Marcus/.test(empText(A)), 'tapping the warning opens Marcus\'s profile');
  click('[data-act="emp:close"]'); await sleep(10);
  ok($('#emp').hidden, 'Close shuts it');

  // Setup › Employees
  click('[data-act="more:open"]'); await sleep(10);
  click('[data-act="more:go"][data-tab="settings"]'); await sleep(60);
  ok(!!$('details[data-k="st:Employees"]'), 'Setup has an Employees card');
  ok(!$('details[data-k="st:Crew"]') && !$('details[data-k="st:Office staff"]'), 'it replaces the old Crew and Office staff cards');
  const rows = $$('.emprow');
  ok(rows.length === 4, 'everyone is listed: Marcus\'s profile plus Dee, Luis and the owner (' + rows.length + ')');
  ok(/Marcus.*Crew lead.*Signed in as marcus@x\.com/.test(rows.map((r) => r.textContent).join('|')), 'Marcus shows as signed in');
  ok(/Dee.*No profile yet/.test(rows.map((r) => r.textContent).join('|')), 'Dee has no profile yet');

  // add Mike
  click('[data-act="emp:new"]'); await sleep(20);
  ok(/New employee/.test(empText(A)) && !$('[data-ek="name"]').readOnly, 'Add employee opens a blank profile');
  click('[data-act="emp:save"]'); await sleep(20);
  ok(/Give them a name/.test(empText(A)), 'a name is required');
  set(A, '[data-ek="name"]', 'Dee');
  click('[data-act="emp:save"]'); await sleep(20);
  ok(/already someone named Dee/.test(empText(A)), 'names stay unique');
  set(A, '[data-ek="name"]', ' Mike ');
  set(A, '[data-ek="email"]', 'not an email');
  click('[data-act="emp:save"]'); await sleep(20);
  ok(/does not look right/.test(empText(A)), 'a bad email is caught');
  set(A, '[data-ek="email"]', ' Mike@X.com ');
  set(A, '[data-ek="phone"]', '503-555-0100');
  set(A, '[data-ek="payRate"]', '2250');
  ok($('[data-ek="payRate"]').value === '22.50', 'pay rate fills cents from the right');
  set(A, '[data-ek="payType"]', 'Hourly');
  set(A, '[data-ek="hireDate"]', '2026-09-01');
  set(A, '[data-ek="ssnLast4"]', '12a4');
  click('[data-act="emp:save"]'); await sleep(20);
  ok(/only the last 4 digits/.test(empText(A)), 'Social Security takes 4 digits only');
  set(A, '[data-ek="ssnLast4"]', '1234');
  set(A, '[data-ek="dlExpires"]', day(400));
  w.document.querySelector('[data-ek="notes"]').value = 'Referred by Marcus';
  click('[data-act="emp:save"]'); await sleep(40);
  const ins = calls.writes.find((x) => x.table === 'employees' && x.op === 'insert');
  ok(ins && ins.row.org_id === ORG && ins.row.name === 'Mike' && ins.row.email === 'mike@x.com' && ins.row.role === 'crew' && ins.row.active === true, 'saved to the employees table: name trimmed, email lower case, crew');
  ok(ins && ins.row.info.payRate === '22.5' && ins.row.info.payType === 'Hourly' && ins.row.info.ssnLast4 === '1234' && ins.row.info.phone === '503-555-0100' && !('dob' in ins.row.info), 'hiring details saved, empty fields left out');
  ok(ins && ins.row.notes === 'Referred by Marcus', 'owner notes saved');
  ok(T.state().settings.crew.includes('Mike') && T.state().settings.contacts.Mike === '503-555-0100', 'Mike joins the crew list with his phone, for scheduling and Call buttons');
  ok(/Waiting for their first sign-in with mike@x\.com/.test(empText(A)), 'the profile says it is waiting for Mike to sign in');
  const sms = $('#emp a[href^="sms:"]');
  ok(sms && /5035550100/.test(sms.getAttribute('href')) && /mike%40x\.com/.test(sms.getAttribute('href')) && /Tally\.apk/.test(sms.getAttribute('href')), 'Text Mike the app: an sms link with the download link and his sign-in email');
  ok($('[data-ek="name"]').readOnly, 'after saving, the name is fixed');

  // documents
  ok(/No documents yet/.test(empText(A)), 'a new profile has no documents');
  const fileIn = $('#empDocFile');
  Object.defineProperty(fileIn, 'files', { value: [new w.File(['%PDF-1.4'], 'I-9 scan (1).pdf', { type: 'application/pdf' })] });
  $('#empDocType').value = 'i9';
  click('[data-act="emp:docup"]'); await sleep(60);
  const up = calls.storage.find((x) => x.op === 'upload');
  ok(up && up.bucket === 'employee-docs' && new RegExp('^' + ORG + '/id-\\d+/\\d+_i9_I-9-scan-1-.pdf$').test(up.path) && up.type === 'application/pdf', 'upload goes to the private bucket under company/employee: ' + (up && up.path));
  ok(/I-9 · I-9-scan-1-.pdf/.test(empText(A)), 'the document is listed as an I-9');
  w.open = (u) => { w.__opened = u; return {}; };
  click('[data-act="emp:docview"]'); await sleep(30);
  ok(w.__opened === 'https://signed.example/' + up.path && calls.storage.some((x) => x.op === 'sign' && x.secs === 600), 'View opens a 10-minute private link');
  click('[data-act="emp:docdel"]'); await sleep(10);
  ok(/Tap again/.test(empText(A)) && !calls.storage.some((x) => x.op === 'remove'), 'Delete asks twice');
  click('[data-act="emp:docdel"]'); await sleep(30);
  ok(calls.storage.some((x) => x.op === 'remove') && /No documents yet/.test(empText(A)), 'second tap deletes it');
  click('[data-act="emp:close"]'); await sleep(30);
  ok(/Mike.*Crew.*Waiting for their first sign-in/.test($$('.emprow').map((r) => r.textContent).join('|')), 'Mike is on the list');

  // give Dee (no profile yet) a profile
  click($$('.emprow').find((r) => /Dee/.test(r.textContent))); await sleep(20);
  ok($('[data-ek="name"]').value === 'Dee' && $('[data-ek="name"]').readOnly && $('[data-ek="phone"]').value === '512-555-0102' && $('[data-ek="role"]').value === 'crew', 'Dee opens prefilled from the crew list: name, role, phone');
  set(A, '[data-ek="role"]', 'lead');
  click('[data-act="emp:save"]'); await sleep(40);
  ok(T.state().settings.leads.includes('Dee') && calls.writes.filter((x) => x.table === 'employees' && x.op === 'insert').some((x) => x.row.name === 'Dee' && x.row.role === 'lead'), 'saved as a crew lead, and the lead list follows');
  ok(/No sign-in email yet/.test(empText(A)), 'without an email she can\'t sign in yet, and it says so');
  click('[data-act="emp:close"]'); await sleep(20);

  // turn Mike off
  click($$('.emprow').find((r) => /Mike/.test(r.textContent))); await sleep(30);
  $('[data-ek="active"]').checked = false;
  click('[data-act="emp:save"]'); await sleep(40);
  const off = calls.writes.filter((x) => x.table === 'employees' && x.op === 'update').pop();
  ok(off && off.row.active === false && !T.state().settings.crew.includes('Mike'), 'turning off access saves it and takes Mike off the crew list');
  ok(/Access off/.test(empText(A)), 'the profile shows access is off');
  click('[data-act="emp:close"]'); await sleep(30);
  ok($$('.emprow').pop().textContent.includes('Mike'), 'people with access off sort to the bottom');

  // delete Mike
  click($$('.emprow').find((r) => /Mike/.test(r.textContent))); await sleep(30);
  click('[data-act="emp:del"]'); await sleep(10);
  ok(/Tap again to delete Mike and their documents/.test(empText(A)), 'Delete profile asks twice');
  click('[data-act="emp:del"]'); await sleep(40);
  ok(calls.writes.some((x) => x.table === 'employees' && x.op === 'delete') && $('#emp').hidden && !$$('.emprow').some((r) => /Mike/.test(r.textContent)), 'second tap deletes the profile');

  // the owner can't switch off their own access
  db.employees.push({ id: 'e-owner', org_id: ORG, name: 'Owner', role: 'owner', email: 'o@x.com', user_id: 'u-owner', active: true, info: {}, notes: '' });
  await T.loadPeople(true); await sleep(30);
  click($$('.emprow').find((r) => /^Owner/.test(r.textContent.trim()))); await sleep(30);
  ok($('[data-ek="active"]').disabled && $('[data-ek="role"]').disabled && /This is you/.test(empText(A)) && !$('[data-act="emp:del"]'), 'your own profile: role and access are locked, no delete');
  click('[data-act="emp:close"]'); await sleep(20);

  // App access: approve a join request as Luis (no profile) -> a linked profile is made
  const reqStaff = $('#accStaff_u-new');
  ok(reqStaff && Array.from(reqStaff.options).map((o) => o.value).join() === ',Dee,Luis', 'the approval list offers only people who are not signed in yet');
  reqStaff.value = 'Luis'; reqStaff.dispatchEvent(new w.Event('change', { bubbles: true }));
  click('[data-act="acc:approve"][data-uid="u-new"]'); await sleep(40);
  const lu = calls.writes.filter((x) => x.table === 'employees' && x.op === 'insert').find((x) => x.row.name === 'Luis');
  ok(lu && lu.row.user_id === 'u-new' && lu.row.email === 'dee.r@x.com' && lu.row.role === 'crew', 'approving makes Luis a profile linked to that sign-in');
  // revoke Marcus: his profile is kept, access turned off
  click('[data-act="acc:revoke"][data-uid="u-marcus"]'); await sleep(40);
  const rv = calls.writes.filter((x) => x.table === 'employees' && x.op === 'update').pop();
  ok(rv && rv.row.active === false && rv.row.name === 'Marcus', 'Revoke on a profile turns its access off and keeps the profile');
  ok(A.errors.length === 0, 'owner: no errors (' + A.errors.slice(0, 3).join(' | ') + ')');

  /* ================= hosted: Marcus sees only his own profile ================= */
  db = seed();
  A = await load(HOSTED, { db, org: ORG, me: { uid: 'u-marcus', email: 'marcus@x.com' } });
  ({ w, $, $$, click, text, calls, T } = A);
  click('[data-act="more:open"]'); await sleep(10);
  ok(!$('[data-act="more:go"][data-tab="settings"]') && !!$('[data-act="me:open"]'), 'crew get My profile in More, not Setup');
  click('[data-act="me:open"]'); await sleep(40);
  const mt = empText(A);
  ok(/My profile/.test(mt) && /Crew lead/.test(mt) && /Hourly · \$24(\.00)? an hour/.test(mt) && /•••-••-4321/.test(mt), 'Marcus sees his role, pay and SSN last 4');
  ok(!/pianos/.test(mt), 'the owner\'s notes are never shown to him');
  ok(calls.rpc.some((x) => x.name === 'my_profile' && x.args.o === ORG) && !calls.writes.some((x) => x.table === 'employees'), 'his profile comes from my_profile, never the table');
  set(A, '[data-mk="phone"]', '512-555-0199');
  set(A, '[data-mk="emergencyName"]', 'Rosa');
  set(A, '[data-mk="shirtSize"]', 'L');
  click('[data-act="me:save"]'); await sleep(40);
  const um = calls.rpc.find((x) => x.name === 'update_my_profile');
  ok(um && um.args.patch.phone === '512-555-0199' && um.args.patch.emergencyName === 'Rosa' && um.args.patch.shirtSize === 'L' && !('payRate' in um.args.patch) && !('title' in um.args.patch), 'he saves only his own contact details');
  ok(db.employees[0].info.phone === '512-555-0199' && /Your details are saved/.test(text()), 'saved');
  Object.defineProperty($('#empDocFile'), 'files', { value: [new w.File(['img'], 'license.jpg', { type: 'image/jpeg' })] });
  click('[data-act="emp:docup"]'); await sleep(50);
  ok(calls.storage.some((x) => x.op === 'upload' && new RegExp('^' + ORG + '/e-marcus/\\d+_license_license.jpg$').test(x.path)), 'he can add his own license photo');
  ok(!$('[data-act="emp:docdel"]'), 'but can\'t delete documents');
  ok(A.errors.length === 0, 'crew: no errors (' + A.errors.slice(0, 3).join(' | ') + ')');

  /* ================= hosted: Luis has no profile ================= */
  db = seed(); db.members.push({ org_id: ORG, user_id: 'u-luis', email: 'luis@x.com', staff: 'Luis', role: 'crew', ts: 1 });
  A = await load(HOSTED, { db, org: ORG, me: { uid: 'u-luis', email: 'luis@x.com' } });
  A.click('[data-act="more:open"]'); await sleep(10);
  A.click('[data-act="me:open"]'); await sleep(40);
  ok(/No profile yet/.test(empText(A)) && /Setup › Employees/.test(empText(A)), 'without a profile, My profile says to ask the owner');

  /* ================= sign-in goes straight into the only company ================= */
  db = seed(); db.members = db.members.filter((m) => m.user_id !== 'u-marcus');
  db.__claim = () => { db.members.push({ org_id: ORG, user_id: 'u-marcus', email: 'marcus@x.com', staff: 'Marcus', role: 'lead', ts: 2 }); return 1; };
  A = await load(HOSTED, { db, me: { uid: 'u-marcus', email: 'marcus@x.com' } });
  await sleep(50);
  ok(A.w.localStorage.getItem('tally.org') === ORG, 'a profile linked at sign-in takes Marcus straight into his company, no code or picker');
  ok(A.calls.rpc.map((x) => x.name).slice(0, 2).join() === 'claim_invites,my_orgs', 'claim first, then the company list');

  /* ================= on-device copy (claude.ai artifact) ================= */
  const B = await load(ARTIFACT, {});
  B.click('[data-act="more:open"]'); await sleep(10);
  B.click('[data-act="more:go"][data-tab="settings"]'); await sleep(40);
  ok(/profiles stay on this device/.test(B.text()), 'the on-device copy says profiles stay on this device');
  B.click('[data-act="emp:new"]'); await sleep(20);
  set(B, '[data-ek="name"]', 'Pat');
  set(B, '[data-ek="phone"]', '503-555-0111');
  set(B, '[data-ek="role"]', 'dispatch');
  B.click('[data-act="emp:save"]'); await sleep(30);
  const saved = JSON.parse(B.w.localStorage.getItem('tally.employees.local') || '[]');
  ok(saved.length === 1 && saved[0].name === 'Pat' && saved[0].role === 'dispatch' && saved[0].info.phone === '503-555-0111', 'saved on this device only');
  ok(B.T.state().settings.office.some((o) => o.name === 'Pat' && o.kind === 'dispatch'), 'Pat joins the office list as dispatch');
  ok(/Document uploads work in the Tally app/.test(empText(B)) && !B.$('#empDocFile'), 'no uploads in this copy, and it says why');
  ok(!/Text Pat the app/.test(empText(B)), 'no invite text without sign-in');
  ok(B.errors.length === 0, 'on-device: no errors (' + B.errors.slice(0, 3).join(' | ') + ')');

  process.exit(summary('employees') ? 1 : 0);
})().catch((e) => { console.error('FAIL crashed:', e); process.exit(1); });
