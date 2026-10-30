// MoveCrew for Windows (windows/): what the app's own address serves, which links go to the computer's
// apps, and that the installer, the update address and the app's links agree with each other.
// Plain Node: no Electron needed.
const path = require('path');
const fs = require('fs');
const R = require('../../windows/rules');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const ROOT = path.resolve(__dirname, '../../windows/app');
const rel = (f) => (f ? path.relative(ROOT, f).split(path.sep).join('/') : f);

/* ---------- app://movecrew/ serves the packed app, and nothing else ---------- */
ok(R.START === 'app://movecrew/index.html', 'the window opens app://movecrew/index.html');
ok(rel(R.fileFor('app://movecrew/index.html', ROOT)) === 'index.html', 'index.html');
ok(rel(R.fileFor('app://movecrew/', ROOT)) === 'index.html' && rel(R.fileFor('app://movecrew', ROOT)) === 'index.html', 'the bare address is index.html');
ok(rel(R.fileFor('app://movecrew/supabase.js?v=2#x', ROOT)) === 'supabase.js', 'supabase.js, with a query or a hash');
ok(rel(R.fileFor('app://movecrew/icons/icon-192.png', ROOT)) === 'icons/icon-192.png', 'a file in a folder');
ok(rel(R.fileFor('app://MoveCrew/index.html', ROOT)) === 'index.html', 'the host in capitals is the same host');
// an address with .. in it is read the way the window reads it (.. taken out first), so it stays in the app's folder
const APPSIDE = path.resolve(__dirname, '../../windows') + path.sep;
[['app://movecrew/../main.js', 'main.js'], ['app://movecrew/%2e%2e/main.js', 'main.js'], ['app://movecrew/x/%2E%2E/%2E%2E/preload.js', 'preload.js']].forEach(([u, want]) => {
  const f = R.fileFor(u, ROOT);
  ok(f === path.join(ROOT, want) && f.indexOf(path.join(ROOT, '')) === 0 && f !== APPSIDE + want, '.. stays inside the app’s folder: ' + u + ' is app/' + want + ', not windows/' + want);
});
const refused = [
  ['app://movecrew/..%2fmain.js', 'an encoded slash'],
  ['app://movecrew/..%5cmain.js', 'an encoded backslash'],
  ['app://movecrew/%00index.html', 'a NUL'],
  ['app://movecrew/C:/Windows/win.ini', 'a drive letter'],
  ['app://movecrew/CON', 'a Windows device name (no file type)'],
  ['app://movecrew/main', 'a name with no file type'],
  ['app://movecrew/notes.exe', 'a program'],
  ['app://movecrew/%E0%A4%A', 'a broken escape'],
  ['app://other/index.html', 'another host'],
  ['https://movecrew/index.html', 'https'],
  ['file:///C:/Windows/win.ini', 'a file address'],
  ['not a url', 'not an address'],
];
refused.forEach(([u, why]) => ok(R.fileFor(u, ROOT) === null, 'refused: ' + why));
ok(R.typeOf('/x/index.html') === 'text/html; charset=utf-8' && R.typeOf('/x/supabase.js') === 'text/javascript; charset=utf-8' && R.typeOf('/x/a.PNG') === 'image/png', 'files are labelled by type');

ok(R.inside('app://movecrew/index.html#messages') && R.inside('app://movecrew') && !R.inside('app://other/') && !R.inside('https://movecrew/') && !R.inside(''), 'inside: only MoveCrew’s own pages');

/* ---------- links leaving the app ---------- */
const out = [
  ['https://connect.stripe.com/setup/e/acct_1/abc', 'https://connect.stripe.com/setup/e/acct_1/abc', 'Stripe’s pages go to the browser'],
  ['https://www.google.com/maps/dir/?api=1&destination=30.2,-97.7', 'https://www.google.com/maps/dir/?api=1&destination=30.2,-97.7', 'maps go to the browser'],
  ['http://example.com/', 'http://example.com/', 'plain http too'],
  ['tel:5125550101', 'tel:5125550101', 'calls go to the computer’s calling app'],
  ['tel:*675125550101', 'tel:*675125550101', 'a private-number call keeps its *67'],
  ['sms:5125550101?&body=Hi%20Dana%2C%20get%20MoveCrew', 'sms:5125550101?&body=Hi%20Dana%2C%20get%20MoveCrew', 'texts, with their words'],
  ['mailto:office@acemoving.com', 'mailto:office@acemoving.com', 'email'],
];
out.forEach(([u, want, m]) => ok(R.outside(u) === want, m));
const notOut = [
  ['javascript:alert(1)', 'a script'], ['file:///C:/Windows/System32/calc.exe', 'a file on the computer'], ['app://movecrew/index.html', 'MoveCrew’s own page'],
  ['ms-settings:privacy', 'Windows settings'], ['search-ms:query=x', 'a Windows search'], ['data:text/html,hi', 'a data address'], ['https://user:pw@example.com/', 'an address with a password in it'],
  ['https://', 'an address with no host'], ['', 'nothing'], ['smb://server/share', 'a network share'], ['\\\\server\\share\\x.exe', 'a Windows network path'],
];
notOut.forEach(([u, m]) => ok(R.outside(u) === '', 'not opened: ' + m));

/* ---------- the pieces agree with each other ---------- */
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../windows/package.json'), 'utf8'));
const page = fs.readFileSync(path.join(__dirname, '../../web/index.html'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '../../windows/main.js'), 'utf8');
const feed = pkg.build.publish[0].url, setup = pkg.build.nsis.artifactName;
const winLink = (/var DEFAULT_WIN_LINK='([^']+)'/.exec(page) || [])[1];
ok(winLink === feed + '/' + setup, 'the app’s Windows link is the installer the update feed publishes (' + winLink + ')');
const wf = fs.readFileSync(path.join(__dirname, '../../.github/workflows/windows.yml'), 'utf8');
const tag = (/releases\/download\/([^/]+)$/.exec(feed) || [])[1];
ok(tag && new RegExp('gh release create ' + tag + ' ').test(wf) && new RegExp('--latest=false').test(wf), 'the workflow publishes to that release (' + tag + '), never as the Latest release the phone app uses');
ok(setup === 'MoveCrew-Setup.exe' && !/\s/.test(setup), 'the installer’s name has no spaces (GitHub would rename it)');
ok(pkg.build.nsis.oneClick === true && pkg.build.nsis.perMachine === false, 'it installs for the person, with no administrator needed');
ok(pkg.build.appId === 'com.movecrew.desktop' && /APP_ID = 'com\.movecrew\.desktop'/.test(main), 'the app’s ID is the same in the installer and the app (Windows notices need that)');
const stripeJs = (/var STRIPE_JS='([^']+)'/.exec(page) || [])[1];
ok(stripeJs && main.indexOf("s.src = '" + stripeJs + "'") > 0, 'the build check loads the Stripe.js the app uses (' + stripeJs + ')');
ok(page.indexOf("function cardOpts(cents,save){return {mode:'payment',currency:'usd',amount:Math.max(MIN_PAY,cents),allowedPaymentMethodTypes:['card'],paymentMethodOptions:{card:{setup_future_usage:save?'off_session':'none'}}}}") >= 0 &&
  /mode: 'payment', currency: 'usd', amount: 5000, allowedPaymentMethodTypes: \['card'\], paymentMethodOptions: \{ card: \{ setup_future_usage: 'none' \} \}/.test(main), 'and makes the card box the way the app does');
ok(/"electron": "\d+\.\d+\.\d+"/.test(JSON.stringify(pkg.devDependencies, null, 1).replace(/\n/g, '')) && /^\d+\.\d+\.\d+$/.test(pkg.dependencies['electron-updater']), 'exact versions, so every build is the same');

console.log(`\nwindows rules: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
