'use strict';
// What the MoveCrew window opens itself, and what it hands to the computer's own apps.
// No Electron in here, so tests/windows/rules.js checks it with plain Node.
const path = require('path');

const SCHEME = 'app';
const HOST = 'movecrew';
const ORIGIN = SCHEME + '://' + HOST;
const START = ORIGIN + '/index.html';

// the only files the app serves itself, and how each is labelled
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function parse(u) { try { return new URL(String(u)); } catch (e) { return null; } }

// MoveCrew's own pages: app://movecrew/...
function inside(u) {
  const x = parse(u);
  return !!x && x.protocol === SCHEME + ':' && x.host.toLowerCase() === HOST;
}

// The packed file an app:// address asks for, or null: another host, a folder, a name without a
// known file type, or anything that tries to climb out of the app's folder.
function fileFor(u, root) {
  const x = parse(u);
  if (!x || x.protocol !== SCHEME + ':' || x.host.toLowerCase() !== HOST) return null;
  let p;
  try { p = decodeURIComponent(x.pathname); } catch (e) { return null; }
  if (p === '' || p === '/') p = '/index.html';
  if (/[\0\\:*?"<>|]/.test(p) || p.split('/').some((s) => s === '..' || s === '.')) return null;
  if (!TYPES[path.extname(p).toLowerCase()]) return null;
  const base = path.resolve(root);
  const full = path.resolve(base, '.' + p);
  if (full.indexOf(base + path.sep) !== 0) return null;
  return full;
}

function typeOf(file) { return TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'; }

// A link leaving the app, made safe to hand to the computer: websites go to the browser, calls,
// texts and email to whatever app handles them there. Anything else (files, scripts, other apps'
// addresses) gives '' and nothing opens.
function outside(u) {
  const x = parse(u);
  if (!x) return '';
  if (x.protocol === 'https:' || x.protocol === 'http:') return x.hostname && !x.username && !x.password ? x.href : '';
  if (x.protocol === 'tel:' || x.protocol === 'sms:' || x.protocol === 'mailto:') return /^[a-z]+:[^\s<>"]+$/i.test(x.href) ? x.href : '';
  return '';
}

module.exports = { SCHEME, HOST, ORIGIN, START, TYPES, inside, fileFor, typeOf, outside };
