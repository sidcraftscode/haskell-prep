/* Haskell sheet revision: page logic. Data comes from data.js, runs go through engine.js and harness.js. */
(function () {
  'use strict';
  var D = window.DATA, H = window.Harness, E = window.Engine;
  var EX = {}; D.ex.forEach(function (e) { EX[e.id] = e; });
  var TEST_DATE = new Date(2026, 10, 20);

  /* ---------- saved state (this browser only) ---------- */
  var KEY = 'haskell-sheets-v1';
  var S = { code: {}, expr: {}, partOk: {}, pred: {}, notes: {}, status: {}, flag: {}, hints: {}, sol: {}, filter: 'all', mock: null, play: null };
  try { var raw = localStorage.getItem(KEY); if (raw) { var o = JSON.parse(raw); for (var k in o) S[k] = o[k]; } } catch (e) {}
  var saveT = null, cloud = null, cloudT = null, cloudBusy = false, cloudDirty = false, cloudState = 'local';
  function paintSave() {
    var n = document.getElementById('savestate'); if (!n) return;
    n.className = 'savestate' + (cloudState === 'error' ? ' warn' : '');
    n.textContent = cloudState === 'synced' ? cloudLabel : cloudState === 'saving' ? 'Saving…' : cloudState === 'error' ? 'Saved in this browser only' : 'Saving in this browser';
  }
  function pushCloud() {
    if (!cloud) return;
    if (cloudBusy) { cloudDirty = true; return; }
    cloudBusy = true; cloudDirty = false; cloudState = 'saving'; paintSave();
    var body; try { body = { t: S.t || Date.now(), json: JSON.stringify(S) }; } catch (e) { cloudBusy = false; return; }
    cloud.set(body).then(function () { cloudState = 'synced'; }, function () { cloudState = 'error'; })
      .then(function () { cloudBusy = false; paintSave(); if (cloudDirty) pushCloud(); });
  }
  function save() {
    S.t = Date.now();
    clearTimeout(saveT); saveT = setTimeout(function () { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }, 200);
    if (cloud) { clearTimeout(cloudT); cloudT = setTimeout(pushCloud, 1500); }
  }
  /* Account storage: one private document per signed-in viewer. The page works without it. */
  /* Theme choice lives in S, so it is saved with progress; index.html also applies it early to avoid a flash. */
  function applyTheme() {
    if (S.theme === 'light' || S.theme === 'dark') document.documentElement.setAttribute('data-theme', S.theme);
    else document.documentElement.removeAttribute('data-theme');
  }
  /* Local disk storage via server.py: same get/set shape as the account doc. */
  var cloudLabel = 'Saved to your account';
  var localRef = {
    get: function () {
      return fetch('api/state', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (d) { return { exists: !!d, data: function () { return d; } }; });
    },
    set: function (body) {
      return fetch('api/state', { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); });
    }
  };
  function adopt(ref) {
    return ref.get().then(function (snap) {
      cloud = ref;
      var d = snap.exists ? snap.data() : null, remote = null;
      if (d && d.json) { try { remote = JSON.parse(d.json); } catch (e) {} }
      if (remote && (remote.t || 0) > (S.t || 0)) {
        for (var k in remote) S[k] = remote[k];
        try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
        cloudState = 'synced'; applyTheme(); paintSave(); paintTop(); route();
      } else if (S.t) pushCloud();
      else { cloudState = 'synced'; paintSave(); }
    });
  }
  function connectCloud() {
    if (!window.claude || !window.claude.use) {
      if (window.SHEETS_EMBED) return; /* inside Haskell Prep: no disk server, progress stays in this browser */
      if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
      cloudLabel = 'Saved to disk';
      adopt(localRef).catch(function () { cloud = null; cloudState = 'error'; paintSave(); });
      return;
    }
    Promise.all([window.claude.use('db'), window.claude.use('user')]).then(function (r) {
      var db = r[0], user = r[1]; if (!db || !user) return;
      return user.id().then(function (uid) {
        if (!uid) return;
        return adopt(db.doc('data/users/' + uid + '/state'));
      });
    }).catch(function () { cloudState = 'error'; paintSave(); });
  }
  window.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} if (cloud && cloudT) { clearTimeout(cloudT); cloudT = null; pushCloud(); } } });

  /* ---------- small helpers ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var a in attrs) {
      if (a === 'class') n.className = attrs[a];
      else if (a === 'html') n.innerHTML = attrs[a];
      else if (a === 'text') n.textContent = attrs[a];
      else if (a.slice(0, 2) === 'on') n.addEventListener(a.slice(2), attrs[a]);
      else if (attrs[a] !== false && attrs[a] != null) n.setAttribute(a, attrs[a]);
    }
    (kids || []).forEach(function (k) { if (k != null) n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
    return n;
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function hl(code) {
    var out = '';
    try { CodeMirror.runMode(code, 'haskell', function (text, style) { out += style ? '<span class="cm-' + style.split(' ').join(' cm-') + '">' + esc(text) + '</span>' : esc(text); }); }
    catch (e) { out = esc(code); }
    return out;
  }
  function inline(s) {
    return esc(s).replace(/\{\{(.+?)\}\}(?!\})/g, function (_, c) { return '<code>' + c + '</code>'; })
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }
  /* Tiny markup: ``` fences, "- " lists, blank-line paragraphs, {{code}}, **bold**. */
  function md(src) {
    var html = '', parts = String(src || '').split(/^```\s*$/m);
    parts.forEach(function (p, i) {
      if (i % 2) { html += '<pre class="hs"><code>' + hl(p.replace(/^\n|\n$/g, '')) + '</code></pre>'; return; }
      p.split(/\n\s*\n/).forEach(function (para) {
        para = para.replace(/^\n+|\n+$/g, ''); if (!para) return;
        var lines = para.split('\n');
        if (lines.every(function (l) { return /^- /.test(l); })) html += '<ul>' + lines.map(function (l) { return '<li>' + inline(l.slice(2)) + '</li>'; }).join('') + '</ul>';
        else html += '<p>' + lines.map(inline).join('<br>') + '</p>';
      });
    });
    return html;
  }
  function copyText(text, btn) {
    var done = function () { if (!btn) return; var t = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = t; }, 1200); };
    var fallback = function () { showDialog('Copy this text', el('textarea', { class: 'copybox', readonly: 'readonly', id: 'copy-fallback', text: text })); var ta = $('#copy-fallback'); ta.focus(); ta.select(); };
    try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
  }
  function showDialog(title, body) {
    var d = $('#dialog'); d.innerHTML = '';
    d.appendChild(el('div', { class: 'dialog-card', role: 'dialog', 'aria-label': title }, [
      el('div', { class: 'dialog-head' }, [el('h3', { text: title }), el('button', { class: 'btn ghost', type: 'button', text: 'Close', onclick: function () { d.hidden = true; } })]),
      body]));
    d.hidden = false;
  }

  /* ---------- progress ---------- */
  function isSolved(id) { return S.status[id] === 'solved'; }
  function statusOf(id) { return S.status[id] || 'new'; }
  function setStatus(id, st) {
    if (S.status[id] === 'solved' && st === 'tried') return;
    S.status[id] = st; save(); paintSidebar(); paintTop();
  }
  function sheetEx(n) { return D.ex.filter(function (e) { return e.sheet === n; }); }
  function counts(list) { var s = 0; list.forEach(function (e) { if (isSolved(e.id)) s++; }); return { solved: s, total: list.length }; }
  function nextUnsolved(list) { for (var i = 0; i < list.length; i++) if (!isSolved(list[i].id)) return list[i]; return list[0]; }
  var KIND = { code: 'Code', expr: 'Expression', predict: 'Predict', written: 'Proof' };

  /* ---------- top bar ---------- */
  function paintTop() {
    var c = counts(D.ex);
    $('#top-progress').textContent = c.solved + ' of ' + c.total + ' done';
    $('#top-bar-fill').style.width = (100 * c.solved / c.total).toFixed(1) + '%';
    var now = new Date(); now.setHours(0, 0, 0, 0);
    var days = Math.round((TEST_DATE - now) / 86400000);
    var chip = $('#countdown');
    if (days < 0) chip.hidden = true;
    else { chip.hidden = false; chip.textContent = days === 0 ? 'Test is today' : 'Test Fri 20 Nov, ' + days + (days === 1 ? ' day' : ' days') + ' to go'; }
  }
  E.onState(function (st, why) {
    var n = $('#engine'); if (!n) return;
    n.className = 'engine ' + st;
    n.textContent = st === 'ready' ? 'Haskell ready' : st === 'loading' ? 'Loading Haskell…' : st === 'failed' ? 'Haskell failed to load' : 'Haskell idle';
    n.title = why || '';
  });

  /* ---------- sidebar ---------- */
  function paintSidebar() {
    var box = $('#nav-list'); box.innerHTML = '';
    var cur = location.hash.slice(1);
    D.sheets.forEach(function (sh) {
      var list = sheetEx(sh.n), c = counts(list);
      var shown = list.filter(function (e) { return S.filter === 'all' || (S.filter === 'todo' && !isSolved(e.id)) || (S.filter === 'flag' && S.flag[e.id]); });
      var det = el('details', { class: 'nav-sheet' });
      var curEx = EX[cur];
      var mSheet = /^sheet-(\d)$/.exec(cur);
      if (mSheet ? +mSheet[1] === sh.n : curEx ? curEx.sheet === sh.n : sh.n === (nextUnsolved(D.ex).sheet)) det.open = true;
      det.appendChild(el('summary', null, [
        el('span', { class: 'nav-sheet-n', text: String(sh.n) }),
        el('span', { class: 'nav-sheet-t', text: sh.title }),
        el('span', { class: 'nav-sheet-c', text: c.solved + '/' + c.total })]));
      var ul = el('ul');
      ul.appendChild(el('li', null, [el('a', { href: '#sheet-' + sh.n, class: 'nav-whole' + (cur === 'sheet-' + sh.n ? ' current' : ''), text: 'Whole sheet ' + sh.n + ' →' })]));
      shown.forEach(function (e) {
        var st = statusOf(e.id);
        ul.appendChild(el('li', null, [el('a', { href: '#' + e.id, class: 'nav-ex ' + st + (cur === e.id ? ' current' : ''), title: KIND[e.type] + ', ' + (st === 'solved' ? 'done' : st === 'tried' ? 'attempted' : 'not started') }, [
          el('span', { class: 'dot ' + st, 'aria-hidden': 'true' }),
          el('span', { class: 'nav-ref', text: e.ref.replace(/^(Functors|Applicatives|Monads) /, function (m) { return m[0] + ' '; }) }),
          el('span', { class: 'nav-title', text: e.title }),
          S.flag[e.id] ? el('span', { class: 'flagmark', title: 'Flagged', text: '⚑' }) : null])]));
      });
      if (!shown.length) ul.appendChild(el('li', { class: 'nav-empty', text: S.filter === 'flag' ? 'Nothing flagged' : 'All done' }));
      det.appendChild(ul); box.appendChild(det);
    });
    ['all', 'todo', 'flag'].forEach(function (f) { $('#filter-' + f).setAttribute('aria-pressed', String(S.filter === f)); });
    ['home', 'mock', 'playground'].forEach(function (v) { var a = $('#link-' + v); if (a) a.classList.toggle('current', (cur || 'home') === v); });
  }

  /* ---------- editors ---------- */
  var editors = [];
  function makeEditor(host, value, opts) {
    opts = opts || {};
    var cm = CodeMirror(host, {
      value: value, mode: 'haskell', theme: 'rev', lineNumbers: opts.lineNumbers !== false, tabSize: 2, indentUnit: 2, indentWithTabs: false,
      matchBrackets: true, autoCloseBrackets: true, lineWrapping: !!opts.wrap, viewportMargin: opts.auto ? Infinity : 10,
      extraKeys: {
        Tab: function (c) { if (c.somethingSelected()) c.indentSelection('add'); else c.replaceSelection('  ', 'end'); },
        'Shift-Tab': function (c) { c.indentSelection('subtract'); },
        'Ctrl-Enter': function () { if (opts.onRun) opts.onRun(); }, 'Cmd-Enter': function () { if (opts.onRun) opts.onRun(); },
        'Ctrl-/': 'toggleComment', 'Cmd-/': 'toggleComment'
      }
    });
    if (opts.onChange) cm.on('change', function () { opts.onChange(cm.getValue()); });
    editors.push(cm);
    setTimeout(function () { cm.refresh(); }, 0);
    return cm;
  }

  /* ---------- shared panels: hints, solution, notes ---------- */
  function hintsPanel(ex, locked) {
    var box = el('section', { class: 'panel hints' }, [el('h3', { text: 'Hints' })]);
    if (locked) { box.appendChild(el('p', { class: 'muted', text: 'Hints are locked during a mock test.' })); return box; }
    var hints = ex.hints || [];
    if (!hints.length) { box.appendChild(el('p', { class: 'muted', text: ex.type === 'predict' ? 'Each expression shows its explanation once you answer it.' : 'No hints for this one. Try the model answer when you have a draft.' })); return box; }
    var list = el('ol', { class: 'hint-list' }); box.appendChild(list);
    var btn = el('button', { class: 'btn', type: 'button' }); box.appendChild(btn);
    function paint() {
      var n = Math.min(S.hints[ex.id] || 0, hints.length);
      list.innerHTML = '';
      for (var i = 0; i < n; i++) list.appendChild(el('li', { html: md(hints[i]) }));
      if (n >= hints.length) btn.hidden = true;
      else { btn.hidden = false; btn.textContent = n === 0 ? 'Show a hint (' + hints.length + ' available)' : 'Show next hint (' + (n + 1) + ' of ' + hints.length + ')'; }
    }
    btn.addEventListener('click', function () { S.hints[ex.id] = (S.hints[ex.id] || 0) + 1; save(); paint(); });
    paint(); return box;
  }
  function solutionText(ex) {
    if (ex.type === 'code') return ex.solution;
    if (ex.type === 'expr') return ex.parts.map(function (p) { return '-- ' + p.label + '\n' + p.answer; }).join('\n\n');
    return '';
  }
  function solutionPanel(ex, locked, onLoad) {
    var title = ex.type === 'written' ? 'Model proof' : 'Model answer';
    var box = el('section', { class: 'panel solution' }, [el('h3', { text: title })]);
    if (locked) { box.appendChild(el('p', { class: 'muted', text: 'The model answer is locked during a mock test.' })); return box; }
    var body = el('div'); box.appendChild(body);
    function paint() {
      body.innerHTML = '';
      if (!S.sol[ex.id]) {
        body.appendChild(el('p', { class: 'muted', text: ex.type === 'written' ? 'Write your own proof first. Then compare it line by line.' : 'Have a real go first. Reading an answer feels like knowing it; writing one shows whether you do.' }));
        body.appendChild(el('button', { class: 'btn', type: 'button', text: 'Reveal ' + title.toLowerCase(), onclick: function () { S.sol[ex.id] = true; save(); paint(); } }));
        return;
      }
      if (ex.type === 'written') body.appendChild(el('div', { class: 'prose', html: md(ex.model) }));
      else {
        var code = solutionText(ex);
        body.appendChild(el('pre', { class: 'hs' }, [el('code', { html: hl(code) })]));
        var row = el('div', { class: 'row' });
        row.appendChild(el('button', { class: 'btn ghost', type: 'button', text: 'Copy', onclick: function (ev) { copyText(code, ev.currentTarget); } }));
        if (onLoad) row.appendChild(el('button', { class: 'btn ghost', type: 'button', text: 'Load into editor', onclick: function () { onLoad(code); } }));
        body.appendChild(row);
      }
      if (ex.notes) body.appendChild(el('div', { class: 'notes prose', html: '<h4>Notes</h4>' + md(ex.notes) }));
      body.appendChild(el('button', { class: 'btn ghost small', type: 'button', text: 'Hide again', onclick: function () { S.sol[ex.id] = false; save(); paint(); } }));
    }
    paint(); return box;
  }

  /* ---------- exercise header ---------- */
  function exHeader(ex, mock) {
    var sh = D.sheets[ex.sheet - 1];
    var list = D.ex, i = list.indexOf(ex);
    var flagBtn = el('button', { class: 'btn ghost small', type: 'button', 'aria-pressed': String(!!S.flag[ex.id]), text: S.flag[ex.id] ? '⚑ Flagged' : '⚐ Flag for review' });
    flagBtn.addEventListener('click', function () { S.flag[ex.id] = !S.flag[ex.id]; save(); flagBtn.textContent = S.flag[ex.id] ? '⚑ Flagged' : '⚐ Flag for review'; flagBtn.setAttribute('aria-pressed', String(!!S.flag[ex.id])); paintSidebar(); });
    var head = el('header', { class: 'ex-head' }, [
      el('div', { class: 'ex-kicker' }, [
        el('a', { href: '#sheet-' + ex.sheet, text: 'Sheet ' + ex.sheet + ' · ' + sh.title }), el('span', { class: 'sep', text: '/' }), el('span', { text: ex.ref }),
        el('span', { class: 'pill kind-' + ex.type, text: KIND[ex.type] }),
        ex.d ? el('span', { class: 'pill diff', title: 'Difficulty ' + ex.d + ' of 3', text: '●●●'.slice(0, ex.d) + '○○○'.slice(0, 3 - ex.d) }) : null,
        el('span', { class: 'pill status ' + statusOf(ex.id), id: 'ex-status', text: statusOf(ex.id) === 'solved' ? 'Done' : statusOf(ex.id) === 'tried' ? 'Attempted' : 'Not started' })]),
      el('h1', { text: ex.title })]);
    if (!mock) head.appendChild(el('div', { class: 'row ex-nav' }, [
      i > 0 ? el('a', { class: 'btn ghost small', href: '#' + list[i - 1].id, text: '← Previous' }) : null,
      i < list.length - 1 ? el('a', { class: 'btn ghost small', href: '#' + list[i + 1].id, text: 'Next →' }) : null,
      flagBtn]));
    return head;
  }
  function markSolved(ex, yes) {
    setStatus(ex.id, yes ? 'solved' : 'tried');
    var p = $('#ex-status'); if (p) { var st = statusOf(ex.id); p.className = 'pill status ' + st; p.textContent = st === 'solved' ? 'Done' : 'Attempted'; }
  }

  /* ---------- running and showing results ---------- */
  function errorBlock(text, offset, inHarness) {
    var box = el('div', { class: 'errbox' });
    box.appendChild(el('pre', { text: H.fixErr(text, offset).trim() }));
    if (inHarness) box.appendChild(el('p', { class: 'muted', text: 'This error is in the test code, not yours. It usually means a function or constructor the tests use is missing, spelled differently, or has a different type from the one asked for.' }));
    return box;
  }
  function runningNote(host, label) {
    host.innerHTML = '';
    host.appendChild(el('div', { class: 'running' }, [el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('span', { text: label || (E.state === 'ready' ? 'Compiling and running…' : 'Loading the Haskell compiler (first run only)…') })]));
  }
  function engineFailure(host, e) {
    host.innerHTML = '';
    host.appendChild(el('div', { class: 'errbox' }, [el('p', { text: 'The in-browser Haskell compiler could not start, so tests cannot run here.' }), el('pre', { text: String(e && e.message || e) }), el('p', { class: 'muted', text: 'You can still use Copy GHCi test file and run the tests on your own machine.' })]));
  }

  function runCodeTests(ex, code, host) {
    runningNote(host);
    var checks = H.sourceChecks(ex, code), job = H.codeRun(ex, code);
    return E.run({ files: job.files, stdin: job.stdin }).then(function (r) {
      var p = H.parseOut(r.out), rows = [], pass = 0, firstMissing = true;
      ex.tests.forEach(function (t, i) {
        var x = p.results[i], row = { e: t.e, exp: t.exp };
        if (x && x.ok) { row.got = x.val; row.st = x.val === t.exp ? 'pass' : 'fail'; if (row.st === 'pass') pass++; }
        else if (x) { row.st = 'exc'; row.got = x.val; }
        else if (firstMissing && !p.ended && (r.timedOut || Object.keys(p.results).length > 0)) { row.st = r.timedOut ? 'timeout' : 'crash'; firstMissing = false; }
        else row.st = 'notrun';
        rows.push(row);
      });
      var compiled = Object.keys(p.results).length > 0 || p.ended;
      var checksOk = checks.every(function (c) { return c.ok; });
      host.innerHTML = '';
      if (!compiled && !r.timedOut) {
        host.appendChild(el('div', { class: 'result-head bad', text: 'Does not compile' }));
        host.appendChild(errorBlock(r.err || 'The compiler stopped without a message.', job.offset, /Main\.hs/.test(r.err)));
      } else {
        var total = ex.tests.length + checks.length, got = pass + checks.filter(function (c) { return c.ok; }).length;
        host.appendChild(el('div', { class: 'result-head ' + (got === total ? 'good' : 'bad') }, [
          el('span', { text: got === total ? 'All ' + total + ' checks pass' : got + ' of ' + total + ' checks pass' }),
          el('span', { class: 'muted', text: (r.ms / 1000).toFixed(1) + ' s' })]));
        var ul = el('ul', { class: 'tests' });
        rows.forEach(function (row) {
          var li = el('li', { class: 't ' + row.st });
          li.appendChild(el('span', { class: 'mark', text: row.st === 'pass' ? '✓' : row.st === 'notrun' ? '–' : '✗' }));
          var body = el('div', { class: 't-body' }); li.appendChild(body);
          body.appendChild(el('code', { class: 't-expr', html: hl(row.e) }));
          if (row.st === 'pass') body.appendChild(el('div', { class: 't-line' }, [el('span', { class: 'lab', text: 'gives' }), el('code', { text: row.got })]));
          else if (row.st === 'fail') {
            body.appendChild(el('div', { class: 't-line' }, [el('span', { class: 'lab', text: 'expected' }), el('code', { text: row.exp })]));
            body.appendChild(el('div', { class: 't-line' }, [el('span', { class: 'lab', text: 'yours' }), el('code', { text: row.got })]));
          } else if (row.st === 'exc') {
            body.appendChild(el('div', { class: 't-line' }, [el('span', { class: 'lab', text: 'expected' }), el('code', { text: row.exp })]));
            body.appendChild(el('div', { class: 't-line' }, [el('span', { class: 'lab', text: 'error' }), el('code', { text: /undefined/.test(row.got) ? 'undefined (this part is not written yet)' : row.got })]));
          } else if (row.st === 'timeout') body.appendChild(el('div', { class: 't-line' }, [el('span', { class: 'lab', text: 'stopped' }), el('span', { text: 'Ran out of time. Check for a recursion that never reaches its base case.' })]));
          else if (row.st === 'crash') body.appendChild(el('div', { class: 't-line' }, [el('span', { class: 'lab', text: 'crashed' }), el('code', { text: (r.err || 'The program stopped.').trim().split('\n').slice(-2).join(' ') })]));
          else body.appendChild(el('div', { class: 't-line muted', text: 'Not run, because an earlier test stopped the program.' }));
          ul.appendChild(li);
        });
        checks.forEach(function (c) {
          ul.appendChild(el('li', { class: 't ' + (c.ok ? 'pass' : 'fail') }, [el('span', { class: 'mark', text: c.ok ? '✓' : '✗' }), el('div', { class: 't-body' }, [el('span', { class: 't-rule', text: c.msg })])]));
        });
        host.appendChild(ul);
        if (r.timedOut && !rows.some(function (x) { return x.st === 'timeout'; })) host.appendChild(el('p', { class: 'muted', text: 'The run was stopped after 25 seconds.' }));
        if (p.stdout) host.appendChild(el('details', { class: 'stdout' }, [el('summary', { text: 'What your program printed' }), el('pre', { text: p.stdout })]));
      }
      return { pass: pass + checks.filter(function (c) { return c.ok; }).length, total: ex.tests.length + checks.length, all: compiled && pass === ex.tests.length && checksOk };
    }, function (e) { engineFailure(host, e); return { pass: 0, total: ex.tests.length, all: false, failed: true }; });
  }

  function ghciFile(ex, code) {
    var L = [code.replace(/\s+$/, ''), '', '-- Tests from the revision site. In GHCi:  :load this file, then  main', 'main :: IO ()', 'main = mapM_ putStrLn'];
    var items = ex.tests.filter(function (t) { return !t.io; }).map(function (t) { return 'check__ ' + JSON.stringify(t.e) + ' (show (' + t.e + ')) ' + JSON.stringify(t.exp); });
    L.push('  [ ' + items.join('\n  , ') + '\n  ]');
    L.push('  where check__ name got want = (if got == want then "PASS  " else "FAIL  ") ++ name ++ (if got == want then "" else "\\n        expected " ++ want ++ "\\n        got      " ++ got)');
    if (ex.aux) L.push('', ex.aux);
    var extra = (ex.imports || []).filter(function (m) { return code.indexOf('import ' + m) < 0; }).map(function (m) { return 'import ' + m; });
    var out = L.join('\n');
    if (extra.length) {
      var lines = out.split('\n'), at = 0;
      lines.forEach(function (l, i) { if (/^import\s/.test(l)) at = i + 1; });
      lines.splice(at, 0, extra.join('\n')); out = lines.join('\n');
    }
    return out + '\n';
  }

  function pasteNeeded(cm, id) {
    var src = S.code[id];
    if (!src || src === EX[id].starter) return false;
    var cur = cm.getValue(), imports = [], body = [];
    src.split('\n').forEach(function (l) { if (/^import\s/.test(l)) { if (cur.indexOf(l.trim()) < 0) imports.push(l); } else if (!/^\s*module\s/.test(l)) body.push(l); });
    var text = body.join('\n').replace(/^\n+|\n+$/g, '');
    var lines = cur.split('\n'), marker = -1, lastImport = -1;
    lines.forEach(function (l, i) { if (/^import\s/.test(l)) lastImport = i; if (marker < 0 && /^-- paste /.test(l)) marker = i; });
    if (marker >= 0) lines.splice(marker, 1, text); else lines.push('', text);
    if (imports.length) lines.splice(lastImport + 1, 0, imports.join('\n'));
    cm.setValue(lines.join('\n'));
    return true;
  }

  /* ---------- views ---------- */
  var view = $('#view');
  function clearView() { editors = []; view.innerHTML = ''; view.scrollTop = 0; }

  function codeView(ex, mock) {
    var store = mock ? S.mock.code : S.code;
    var left = el('div', { class: 'col col-read' }), right = el('div', { class: 'col col-work' });
    left.appendChild(exHeader(ex, mock));
    left.appendChild(el('div', { class: 'prose prompt', html: md(ex.prompt) }));
    var results = el('div', { class: 'results', 'aria-live': 'polite' });
    var edHost = el('div', { class: 'editor' });
    var cm;
    function run() {
      var code = cm.getValue();
      runBtn.disabled = true;
      runCodeTests(ex, code, results).then(function (res) {
        runBtn.disabled = false;
        if (mock) { S.mock.results[ex.id] = { pass: res.pass, total: res.total, code: code }; save(); paintMockBar(); }
        else if (!res.failed) markSolved(ex, res.all);
      });
    }
    var runBtn = el('button', { class: 'btn primary', type: 'button', onclick: run }, ['Run tests ', el('kbd', { text: 'Ctrl ↵' })]);
    var bar = el('div', { class: 'row toolbar' }, [runBtn,
      el('button', { class: 'btn ghost', type: 'button', text: 'Reset to starter', onclick: function () { cm.setValue(ex.starter); } }),
      el('button', { class: 'btn ghost', type: 'button', text: 'Copy GHCi test file', title: 'Your code plus these tests as one file you can load in GHCi', onclick: function (ev) { copyText(ghciFile(ex, cm.getValue()), ev.currentTarget); } })]);
    (ex.needs || []).forEach(function (id) {
      bar.appendChild(el('button', { class: 'btn ghost', type: 'button', text: 'Paste my ' + EX[id].ref.replace(/^§\d /, ''), title: 'Insert your saved answer to ' + EX[id].title, onclick: function (ev) {
        if (!pasteNeeded(cm, id)) { var b = ev.currentTarget, t = b.textContent; b.textContent = 'No saved answer yet'; setTimeout(function () { b.textContent = t; }, 1400); }
      } }));
    });
    right.appendChild(edHost); right.appendChild(bar);
    var tl = el('details', { class: 'testlist' }, [el('summary', { text: 'The ' + (ex.tests.length + ex.checks.length) + ' checks this runs' })]);
    var tul = el('ul');
    ex.tests.forEach(function (t) { tul.appendChild(el('li', null, [el('code', { html: hl(t.e) }), el('span', { class: 'lab', text: ' should give ' }), el('code', { text: t.exp })])); });
    ex.checks.forEach(function (c) { tul.appendChild(el('li', { text: c.msg })); });
    tl.appendChild(tul); right.appendChild(tl);
    right.appendChild(results);
    results.appendChild(el('p', { class: 'muted', text: 'Results appear here. Each run compiles your file in the browser and takes a few seconds.' }));
    left.appendChild(hintsPanel(ex, mock));
    left.appendChild(solutionPanel(ex, mock, function (code) { cm.setValue(code); }));
    view.appendChild(el('div', { class: 'split' }, [left, right]));
    cm = makeEditor(edHost, store[ex.id] != null ? store[ex.id] : ex.starter, { onRun: run, onChange: function (v) { store[ex.id] = v; save(); if (!mock && v !== ex.starter && statusOf(ex.id) === 'new') setStatus(ex.id, 'tried'); } });
  }

  function exprView(ex, mock) {
    var store = mock ? (S.mock.expr[ex.id] = S.mock.expr[ex.id] || {}) : (S.expr[ex.id] = S.expr[ex.id] || {});
    var oks = mock ? (S.mock.partOk[ex.id] = S.mock.partOk[ex.id] || {}) : (S.partOk[ex.id] = S.partOk[ex.id] || {});
    var left = el('div', { class: 'col col-read' }), right = el('div', { class: 'col col-work' });
    left.appendChild(exHeader(ex, mock));
    left.appendChild(el('div', { class: 'prose prompt', html: md(ex.prompt) }));
    left.appendChild(hintsPanel(ex, mock));
    left.appendChild(solutionPanel(ex, mock));
    function refresh() {
      var all = ex.parts.every(function (_, i) { return oks[i]; });
      if (mock) { S.mock.results[ex.id] = { pass: ex.parts.filter(function (_, i) { return oks[i]; }).length, total: ex.parts.length }; save(); paintMockBar(); }
      else markSolved(ex, all);
    }
    ex.parts.forEach(function (part, i) {
      var card = el('section', { class: 'part' + (oks[i] ? ' ok' : '') });
      card.appendChild(el('h3', { class: 'part-label', html: inline(part.label) }));
      var edHost = el('div', { class: 'editor mini' }), out = el('div', { class: 'part-out', 'aria-live': 'polite' }), cm;
      if (oks[i]) out.appendChild(el('span', { class: 'ok-note', text: '✓ Checked' }));
      function check() {
        var src = cm.getValue().trim();
        if (!src) { out.innerHTML = ''; out.appendChild(el('span', { class: 'muted', text: 'Type an expression first.' })); return; }
        var pre = [], clean = H.stripComments(src);
        part.checks.forEach(function (c) { var hit = H.parseRe(c.re).test(clean); if (c.kind === 'req' ? !hit : hit) pre.push(c.msg); });
        if (part.deparen) { var d = H.deparenOk(part.deparen, src); if (!d.same) pre.push('Only add parentheses. Leave the rest of the expression exactly as given.'); }
        btn.disabled = true; runningNote(out);
        var job = H.exprRun(part, src);
        E.run({ files: job.files }).then(function (r) {
          btn.disabled = false; out.innerHTML = '';
          var p = H.parseOut(r.out), v = p.results[0], c = p.results[1];
          if (!v) { out.appendChild(el('div', { class: 'result-head bad', text: r.timedOut ? 'Ran out of time' : 'Does not compile' })); if (!r.timedOut) out.appendChild(errorBlock(r.err || 'No message.', job.offset, false)); oks[i] = false; }
          else {
            var good = v.ok && c && c.ok && c.val === 'True';
            var minimal = !part.deparen || H.deparenOk(part.deparen, src).minimal;
            out.appendChild(el('div', { class: 't-line' }, [el('span', { class: 'lab', text: v.ok ? 'your value' : 'error' }), el('code', { text: v.val.length > 400 ? v.val.slice(0, 400) + ' …' : v.val })]));
            if (good && !pre.length && minimal) { out.appendChild(el('div', { class: 'result-head good', text: 'Correct' })); oks[i] = true; }
            else {
              oks[i] = false;
              if (!good) out.appendChild(el('div', { class: 'result-head bad', text: v.ok ? 'That is not the value asked for' : 'It compiles, then fails when run' }));
              pre.forEach(function (m) { out.appendChild(el('div', { class: 'result-head bad', text: m })); });
              if (good && !pre.length && !minimal) out.appendChild(el('div', { class: 'result-head bad', text: 'Right value, but it uses more parentheses than the minimum' }));
            }
          }
          card.classList.toggle('ok', !!oks[i]); save(); refresh();
        }, function (e) { btn.disabled = false; engineFailure(out, e); });
      }
      var btn = el('button', { class: 'btn primary small', type: 'button', text: 'Check', onclick: check });
      card.appendChild(edHost); card.appendChild(el('div', { class: 'row' }, [btn, part.deparen ? el('button', { class: 'btn ghost small', type: 'button', text: 'Start from the original', onclick: function () { cm.setValue(part.deparen); } }) : null]));
      card.appendChild(out); right.appendChild(card);
      setTimeout(function () {
        cm = makeEditor(edHost, store[i] != null ? store[i] : (part.deparen || ''), { lineNumbers: false, auto: true, wrap: true, onRun: check, onChange: function (v) { store[i] = v; save(); if (!mock && statusOf(ex.id) === 'new') setStatus(ex.id, 'tried'); } });
        cm.setSize(null, null);
      }, 0);
    });
    view.appendChild(el('div', { class: 'split' }, [left, right]));
  }

  function normPred(s) {
    s = s.replace(/\s+/g, '');
    if (/^typeerror$/i.test(s)) return 'TYPEERROR';
    if (/^runtimeerror$/i.test(s)) return 'RUNTIMEERROR';
    return s;
  }
  function predictView(ex) {
    var st = S.pred[ex.id] = S.pred[ex.id] || {};
    var wrap = el('div', { class: 'single' });
    wrap.appendChild(exHeader(ex));
    wrap.appendChild(el('div', { class: 'prose prompt', html: md(ex.prompt) }));
    var score = el('div', { class: 'score', 'aria-live': 'polite' });
    wrap.appendChild(el('div', { class: 'row' }, [score, el('button', { class: 'btn ghost small', type: 'button', text: 'Clear my answers', onclick: function () { S.pred[ex.id] = {}; S.status[ex.id] = 'tried'; save(); route(); } })]));
    function paintScore() {
      var n = ex.items.filter(function (_, i) { return st[i] && st[i].ok; }).length;
      score.textContent = n + ' of ' + ex.items.length + ' correct';
      var touched = Object.keys(st).length > 0;
      if (n === ex.items.length) markSolved(ex, true); else if (touched) markSolved(ex, false);
    }
    var list = el('ol', { class: 'pred-list' });
    ex.items.forEach(function (it, i) {
      var li = el('li', { class: 'pred' }), fb = el('div', { class: 'pred-fb' });
      var input = el('input', { type: 'text', id: 'pred-' + ex.id + '-' + i, class: 'pred-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'what GHCi prints', 'aria-label': 'Your prediction for ' + it.e });
      function paint() {
        var s = st[i]; li.className = 'pred' + (s ? (s.ok ? ' ok' : ' no') : ''); fb.innerHTML = '';
        if (!s) return;
        if (s.ok) fb.appendChild(el('div', { class: 'pred-verdict good' }, ['✓ ', el('code', { text: it.a === 'TYPE ERROR' ? 'type error' : it.a === 'RUNTIME ERROR' ? 'runtime error' : it.a })]));
        else if (s.shown) fb.appendChild(el('div', { class: 'pred-verdict' }, ['Answer: ', el('code', { text: it.a === 'TYPE ERROR' ? 'type error' : it.a === 'RUNTIME ERROR' ? 'runtime error' : it.a })]));
        else fb.appendChild(el('div', { class: 'pred-verdict bad' }, ['✗ Not ', el('code', { text: s.v }), '. ', el('button', { class: 'link', type: 'button', text: 'Show the answer', onclick: function () { s.shown = true; save(); paint(); } })]));
        if (s.ok || s.shown) fb.appendChild(el('div', { class: 'pred-why prose', html: '<p>' + inline(it.x) + '</p>' }));
      }
      function answer(v) {
        if (!v.trim()) return;
        var ok = normPred(v) === normPred(it.a);
        st[i] = { v: v, ok: ok, shown: false }; save(); paint(); paintScore();
        if (ok) { var nx = $('#pred-' + ex.id + '-' + (i + 1)); if (nx && document.activeElement === input) nx.focus(); }
      }
      input.value = st[i] && !/ERROR$/.test(st[i].v) ? st[i].v : '';
      input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') answer(input.value); });
      li.appendChild(el('pre', { class: 'hs pred-expr' }, [el('code', { html: hl(it.e) })]));
      li.appendChild(el('div', { class: 'row pred-row' }, [input,
        el('button', { class: 'btn small', type: 'button', text: 'Check', onclick: function () { answer(input.value); } }),
        el('button', { class: 'btn ghost small', type: 'button', text: 'Type error', onclick: function () { answer('TYPE ERROR'); } }),
        el('button', { class: 'btn ghost small', type: 'button', text: 'Runtime error', onclick: function () { answer('RUNTIME ERROR'); } })]));
      li.appendChild(fb); list.appendChild(li); paint();
    });
    wrap.appendChild(list);
    wrap.appendChild(el('p', { class: 'muted', text: 'Write values the way GHCi shows them: strings in double quotes, characters in single quotes. Spaces do not matter. To see any of these run, paste it into the Playground.' }));
    view.appendChild(wrap); paintScore();
  }

  function writtenView(ex) {
    var left = el('div', { class: 'col col-read' }), right = el('div', { class: 'col col-work' });
    left.appendChild(exHeader(ex));
    left.appendChild(el('div', { class: 'prose prompt', html: md(ex.prompt) }));
    var ta = el('textarea', { id: 'notes-' + ex.id, class: 'proofbox', spellcheck: 'false', placeholder: 'Write your proof here, one step per line with its justification.\n\nmaybeMap f (maybeMap g Nothing)\n  = -- definition of maybeMap\n...' });
    ta.value = S.notes[ex.id] || '';
    ta.addEventListener('input', function () { S.notes[ex.id] = ta.value; save(); if (statusOf(ex.id) === 'new') setStatus(ex.id, 'tried'); });
    right.appendChild(el('label', { class: 'lab block', for: 'notes-' + ex.id, text: 'Your working (saved in this browser)' }));
    right.appendChild(ta);
    right.appendChild(solutionPanel(ex));
    var mark = el('div', { class: 'panel selfmark' }, [el('h3', { text: 'Mark yourself' }), el('p', { class: 'muted', text: 'A proof cannot be auto-marked. Compare yours with the model: same cases, every step justified, hypothesis used where it should be.' })]);
    mark.appendChild(el('div', { class: 'row' }, [
      el('button', { class: 'btn primary', type: 'button', text: 'I got it', onclick: function () { S.status[ex.id] = 'solved'; save(); paintSidebar(); paintTop(); route(); } }),
      el('button', { class: 'btn', type: 'button', text: 'Needs another look', onclick: function () { S.status[ex.id] = 'tried'; S.flag[ex.id] = true; save(); paintSidebar(); paintTop(); route(); } })]));
    right.appendChild(mark);
    view.appendChild(el('div', { class: 'split' }, [left, right]));
  }

  /* ---------- home ---------- */
  function homeView() {
    var c = counts(D.ex), wrap = el('div', { class: 'home' });
    var nx = nextUnsolved(D.ex);
    var byType = {}; D.ex.forEach(function (e) { byType[e.type] = (byType[e.type] || 0) + 1; });
    wrap.appendChild(el('header', { class: 'home-head' }, [
      el('h1', { text: 'Unassessed sheets 1 to 6' }),
      el('p', { class: 'lede', text: 'Every question from your six problem sheets, with tests that run real Haskell in this page, stepped hints and the model answers.' }),
      el('div', { class: 'row' }, [
        el('a', { class: 'btn primary', href: '#' + nx.id, text: (c.solved ? 'Continue: ' : 'Start: ') + 'Sheet ' + nx.sheet + ', ' + nx.ref }),
        el('a', { class: 'btn', href: '#mock', text: 'Timed mock test' }),
        el('a', { class: 'btn', href: '#playground', text: 'Playground' })])]));
    var stats = el('div', { class: 'stats' });
    [[c.solved + ' / ' + c.total, 'questions done'], [String(byType.code), 'coding questions with tests'], [String(byType.expr + byType.predict), 'expression and prediction sets'], [String(byType.written), 'proofs to write']].forEach(function (s) {
      stats.appendChild(el('div', { class: 'stat' }, [el('div', { class: 'stat-n', text: s[0] }), el('div', { class: 'stat-l', text: s[1] })]));
    });
    wrap.appendChild(stats);
    var grid = el('div', { class: 'sheet-grid' });
    D.sheets.forEach(function (sh) {
      var list = sheetEx(sh.n), sc = counts(list), nxt = nextUnsolved(list);
      var card = el('section', { class: 'sheet-card' }, [
        el('div', { class: 'sheet-top' }, [el('span', { class: 'sheet-n', text: 'Sheet ' + sh.n }), el('span', { class: 'sheet-c', text: sc.solved + ' / ' + sc.total })]),
        el('h2', { text: sh.title }),
        el('p', { class: 'muted', text: sh.blurb }),
        el('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(sc.total), 'aria-valuenow': String(sc.solved) }, [el('div', { class: 'bar-fill', style: 'width:' + (100 * sc.solved / sc.total) + '%' })]),
        el('details', { open: 'open' }, [el('summary', { text: 'Key ideas' }), el('ul', { class: 'ideas', html: sh.ideas.map(function (i) { return '<li>' + i + '</li>'; }).join('') })]),
        el('div', { class: 'row' }, [el('a', { class: 'btn primary small', href: '#sheet-' + sh.n, text: 'Open whole sheet' }), el('a', { class: 'btn small', href: '#' + nxt.id, text: sc.solved === sc.total ? 'Review ' + nxt.ref : sc.solved ? 'Continue with ' + nxt.ref : 'Start with ' + nxt.ref })])]);
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    var about = el('section', { class: 'about prose' });
    about.innerHTML = '<h2>How the tests run</h2>' +
      '<p>Your code is compiled and run in this browser tab by <a href="https://github.com/augustss/MicroHs">MicroHs</a>, a small Haskell compiler built for WebAssembly. Nothing is sent anywhere. A run takes a few seconds; the first one also loads the compiler.</p>' +
      '<ul><li><strong>It is not GHC.</strong> The language is the same for everything on these sheets, but error messages are worded differently and are terser. Use <em>Copy GHCi test file</em> to run the same tests in GHCi, which is what you will have in the test.</li>' +
      '<li><strong>Int is 32-bit here</strong> and overflow raises an error. The tests stay within range.</li>' +
      '<li><code>Data.Set</code> and <code>Data.Map</code> are not available, so the sheet answers that use them are shown in the notes only.</li>' +
      '<li>A run is stopped after 25 seconds, which is how an infinite loop shows up.</li></ul>' +
      '<h2>Where this differs from the printed sheets</h2>' +
      '<p>Several printed model answers contain slips (a misspelled name, a wrong sign, a swapped case). Every answer here was run against its tests, the slips are fixed, and each fix is described in that question\'s notes. <strong>Sheet 6 came without model answers</strong>, so its solutions and proofs were written for this site; treat them as one correct answer, not the official one.</p>' +
      '<p>Your progress and every answer you type are saved to your Claude account when you are signed in, so they follow you across reloads and devices, and are also kept in this browser. The top bar shows which is in effect.</p>';
    var reset = el('button', { class: 'btn ghost small', type: 'button', text: 'Erase all my progress' });
    reset.addEventListener('click', function () {
      if (reset.dataset.armed) { try { localStorage.removeItem(KEY); } catch (e) {} var go = function () { location.hash = ''; location.reload(); }; if (cloud) cloud.set({ t: Date.now(), json: '{}' }).then(go, go); else go(); }
      else { reset.dataset.armed = '1'; reset.textContent = 'Click again to erase everything'; setTimeout(function () { delete reset.dataset.armed; reset.textContent = 'Erase all my progress'; }, 4000); }
    });
    about.appendChild(reset);
    wrap.appendChild(about);
    view.appendChild(wrap);
  }

  /* ---------- whole sheet ---------- */
  function sheetView(n) {
    var sh = D.sheets[n - 1], list = sheetEx(n), c = counts(list);
    var wrap = el('div', { class: 'sheetpage' });
    wrap.appendChild(el('header', { class: 'ex-head' }, [
      el('div', { class: 'ex-kicker' }, [el('span', { text: 'Unassessed exercises ' + n }), el('span', { class: 'pill', text: c.solved + ' of ' + c.total + ' done' })]),
      el('h1', { text: sh.title }),
      el('p', { class: 'lede', text: sh.blurb + ' Every question on the sheet is below, in order. Open any one to work on it.' }),
      el('div', { class: 'row' }, [
        n > 1 ? el('a', { class: 'btn ghost small', href: '#sheet-' + (n - 1), text: '← Sheet ' + (n - 1) }) : null,
        n < D.sheets.length ? el('a', { class: 'btn ghost small', href: '#sheet-' + (n + 1), text: 'Sheet ' + (n + 1) + ' →' }) : null])]));
    wrap.appendChild(el('details', { class: 'panel' }, [el('summary', { text: 'Key ideas for this sheet' }), el('ul', { class: 'ideas', html: sh.ideas.map(function (i) { return '<li>' + i + '</li>'; }).join('') })]));
    list.forEach(function (e) {
      var st = statusOf(e.id);
      var body = el('div', { class: 'prose', html: md(e.prompt) });
      if (e.type === 'predict') body.appendChild(el('pre', { class: 'hs' }, [el('code', { html: hl(e.items.map(function (it) { return it.e; }).join('\n')) })]));
      if (e.type === 'expr') body.appendChild(el('ul', { html: e.parts.map(function (p) { return '<li>' + inline(p.label) + '</li>'; }).join('') }));
      wrap.appendChild(el('section', { class: 'sheet-q ' + st }, [
        el('div', { class: 'ex-kicker' }, [el('span', { text: e.ref }), el('span', { class: 'pill kind-' + e.type, text: KIND[e.type] }),
          el('span', { class: 'pill status ' + st, text: st === 'solved' ? 'Done' : st === 'tried' ? 'Attempted' : 'Not started' }), S.flag[e.id] ? el('span', { class: 'flagmark', text: '⚑ flagged' }) : null]),
        el('h2', null, [el('a', { href: '#' + e.id, text: e.title })]),
        body,
        el('div', { class: 'row' }, [el('a', { class: 'btn ' + (st === 'solved' ? '' : 'primary ') + 'small', href: '#' + e.id, text: st === 'solved' ? 'Review' : st === 'tried' ? 'Continue' : e.type === 'written' ? 'Write the proof' : e.type === 'predict' ? 'Answer these' : 'Solve' })])]));
    });
    view.appendChild(wrap);
  }

  /* ---------- playground ---------- */
  var PLAY_DEFAULT = 'import Data.Char\nimport Data.List\n\n-- Definitions go here. Then evaluate an expression below, as you would in GHCi.\n\nsquare :: Int -> Int\nsquare x = x * x\n';
  function playView() {
    var wrap = el('div', { class: 'single wide' });
    wrap.appendChild(el('header', { class: 'ex-head' }, [el('div', { class: 'ex-kicker' }, [el('span', { text: 'Scratch space' })]), el('h1', { text: 'Playground' }),
      el('p', { class: 'muted', text: 'Definitions on top, an expression underneath. Evaluating prints the result the way GHCi would. Tick the box when the expression is an IO action, such as a do-block or putStrLn.' })]));
    var st = S.play = S.play || { code: PLAY_DEFAULT, expr: 'map square [1 .. 10]', io: false, stdin: '' };
    var edHost = el('div', { class: 'editor' }), out = el('div', { class: 'results', 'aria-live': 'polite' });
    var exprIn = el('input', { type: 'text', id: 'play-expr', class: 'play-expr', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', value: st.expr, 'aria-label': 'Expression to evaluate' });
    var ioBox = el('input', { type: 'checkbox', id: 'play-io' }); ioBox.checked = !!st.io;
    var stdinIn = el('input', { type: 'text', id: 'play-stdin', class: 'play-stdin', spellcheck: 'false', autocomplete: 'off', placeholder: 'lines for getLine, separated by \\n', value: st.stdin || '', 'aria-label': 'Standard input' });
    var cm;
    function go() {
      st.expr = exprIn.value; st.io = ioBox.checked; st.stdin = stdinIn.value; save();
      if (!st.expr.trim()) return;
      var code = cm.getValue().replace(/^\s*module\s.*$/m, '');
      var prog = code + '\n\nmain :: IO ()\nmain = ' + (st.io ? '(' + st.expr + ') >> return ()' : 'print (' + st.expr + ')') + '\n';
      runningNote(out); btn.disabled = true;
      E.run({ files: { 'Main.hs': prog }, stdin: st.stdin.replace(/\\n/g, '\n') + '\n' }).then(function (r) {
        btn.disabled = false; out.innerHTML = '';
        if (r.timedOut) out.appendChild(el('div', { class: 'result-head bad', text: 'Stopped after 25 seconds' }));
        if (r.out) out.appendChild(el('pre', { class: 'play-out', text: r.out }));
        if (r.err.trim()) out.appendChild(errorBlock(r.err, 0, false));
        if (!r.out && !r.err.trim() && !r.timedOut) out.appendChild(el('p', { class: 'muted', text: 'Finished with no output.' }));
      }, function (e) { btn.disabled = false; engineFailure(out, e); });
    }
    var btn = el('button', { class: 'btn primary', type: 'button', onclick: go }, ['Evaluate ', el('kbd', { text: 'Ctrl ↵' })]);
    exprIn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') go(); });
    wrap.appendChild(edHost);
    wrap.appendChild(el('div', { class: 'prompt-line' }, [el('span', { class: 'ghci', text: 'ghci>' }), exprIn, btn]));
    wrap.appendChild(el('div', { class: 'row play-opts' }, [el('label', { class: 'check', for: 'play-io' }, [ioBox, ' IO action']), el('label', { class: 'lab', for: 'play-stdin', text: 'Input' }), stdinIn]));
    wrap.appendChild(out);
    view.appendChild(wrap);
    cm = makeEditor(edHost, st.code, { onRun: go, onChange: function (v) { st.code = v; save(); } });
  }

  /* ---------- mock test ---------- */
  var mockTimer = null;
  function mockLeft() { return S.mock ? Math.max(0, S.mock.ends - Date.now()) : 0; }
  function fmt(ms) { var s = Math.ceil(ms / 1000), m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); }
  function paintMockBar() {
    var bar = $('#mockbar');
    if (!S.mock || S.mock.done) { bar.hidden = true; clearInterval(mockTimer); mockTimer = null; return; }
    bar.hidden = false; bar.innerHTML = '';
    var cur = location.hash.slice(1);
    bar.appendChild(el('span', { class: 'mock-label', text: 'Mock test' }));
    var nav = el('div', { class: 'mock-nav' });
    S.mock.ids.forEach(function (id, i) {
      var r = S.mock.results[id], cls = r ? (r.pass === r.total ? 'good' : 'part') : '';
      nav.appendChild(el('a', { href: '#' + id, class: 'mock-q ' + cls + (cur === id ? ' current' : ''), text: String(i + 1), title: EX[id].title }));
    });
    bar.appendChild(nav);
    var clock = el('span', { class: 'mock-clock', id: 'mock-clock', text: fmt(mockLeft()) });
    bar.appendChild(clock);
    bar.appendChild(el('button', { class: 'btn small', type: 'button', text: 'Finish and see results', onclick: finishMock }));
    if (!mockTimer) mockTimer = setInterval(function () {
      var c = $('#mock-clock'); if (!S.mock || S.mock.done) return;
      var left = mockLeft(); if (c) { c.textContent = fmt(left); c.classList.toggle('low', left < 5 * 60000); }
      if (left <= 0) finishMock();
    }, 1000);
  }
  function finishMock() { if (!S.mock) return; S.mock.done = true; S.mock.finished = Date.now(); save(); paintMockBar(); if (location.hash === '#mock') route(); else location.hash = '#mock'; }
  function startMock(sheets, n, minutes) {
    var pool = D.ex.filter(function (e) { return (e.type === 'code' || e.type === 'expr') && sheets.indexOf(e.sheet) >= 0; });
    var fresh = pool.filter(function (e) { return !isSolved(e.id); }), seen = pool.filter(function (e) { return isSolved(e.id); });
    function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
    var pick = shuffle(fresh).concat(shuffle(seen)).slice(0, n);
    pick.sort(function (a, b) { return D.ex.indexOf(a) - D.ex.indexOf(b); });
    if (!pick.length) return;
    S.mock = { ids: pick.map(function (e) { return e.id; }), started: Date.now(), ends: Date.now() + minutes * 60000, minutes: minutes, code: {}, expr: {}, partOk: {}, results: {}, done: false };
    save(); location.hash = '#' + S.mock.ids[0];
  }
  function mockView() {
    var wrap = el('div', { class: 'single' });
    if (S.mock && S.mock.done) {
      var m = S.mock, full = 0;
      wrap.appendChild(el('header', { class: 'ex-head' }, [el('div', { class: 'ex-kicker' }, [el('span', { text: 'Mock test' })]), el('h1', { text: 'Results' })]));
      var tb = el('tbody');
      m.ids.forEach(function (id, i) {
        var e = EX[id], r = m.results[id], stale = r && r.code != null && m.code[id] !== r.code;
        if (r && r.pass === r.total && !stale) full++;
        var keep = e.type === 'code' && m.code[id] != null ? el('button', { class: 'btn ghost small', type: 'button', text: 'Keep as my answer', onclick: function (ev) { S.code[id] = m.code[id]; if (r && r.pass === r.total && !stale) S.status[id] = 'solved'; else if (!isSolved(id)) S.status[id] = 'tried'; save(); paintSidebar(); paintTop(); ev.currentTarget.textContent = 'Kept'; ev.currentTarget.disabled = true; } }) : null;
        tb.appendChild(el('tr', null, [el('td', { text: String(i + 1) }), el('td', null, [el('a', { href: '#' + id, text: 'Sheet ' + e.sheet + ' ' + e.ref + ': ' + e.title })]),
          el('td', { class: 'num ' + (r ? (r.pass === r.total && !stale ? 'good' : 'bad') : 'muted'), text: r ? r.pass + ' / ' + r.total + (stale ? ' (edited after last run)' : '') : 'never run' }), el('td', null, [keep])]));
      });
      var used = Math.min(m.minutes * 60000, (m.finished || Date.now()) - m.started);
      wrap.appendChild(el('p', { class: 'lede', text: full + ' of ' + m.ids.length + ' questions fully passing, in ' + fmt(used) + ' of ' + m.minutes + ' minutes.' }));
      wrap.appendChild(el('div', { class: 'tablewrap' }, [el('table', { class: 'mock-table' }, [el('thead', null, [el('tr', null, [el('th', { text: '#' }), el('th', { text: 'Question' }), el('th', { text: 'Checks passed at last run' }), el('th', { text: '' })])]), tb])]));
      wrap.appendChild(el('p', { class: 'muted', text: 'Open any question to see its hints and model answer. The scores come from the last time you ran each one during the mock.' }));
      wrap.appendChild(el('div', { class: 'row' }, [el('button', { class: 'btn primary', type: 'button', text: 'Set up another mock', onclick: function () { S.mock = null; save(); route(); } })]));
      view.appendChild(wrap); return;
    }
    if (S.mock) {
      wrap.appendChild(el('header', { class: 'ex-head' }, [el('h1', { text: 'A mock test is running' })]));
      wrap.appendChild(el('div', { class: 'row' }, [el('a', { class: 'btn primary', href: '#' + S.mock.ids[0], text: 'Go to question 1' }), el('button', { class: 'btn', type: 'button', text: 'Abandon it', onclick: function () { S.mock = null; save(); paintMockBar(); route(); } })]));
      view.appendChild(wrap); return;
    }
    wrap.appendChild(el('header', { class: 'ex-head' }, [el('div', { class: 'ex-kicker' }, [el('span', { text: 'Exam practice' })]), el('h1', { text: 'Timed mock test' }),
      el('p', { class: 'lede', text: 'A random set of coding questions against the clock. You can run the tests as often as you like, but hints and model answers stay locked until you finish. Questions you have not solved yet are picked first.' })]));
    var form = el('form', { class: 'mock-form', onsubmit: function (ev) {
      ev.preventDefault();
      var sheets = D.sheets.filter(function (sh) { return $('#mock-s' + sh.n).checked; }).map(function (sh) { return sh.n; });
      if (!sheets.length) { $('#mock-msg').textContent = 'Pick at least one sheet.'; return; }
      startMock(sheets, +$('#mock-n').value, +$('#mock-min').value);
    } });
    var fs = el('fieldset', null, [el('legend', { text: 'Sheets to draw from' })]);
    D.sheets.forEach(function (sh) { var cb = el('input', { type: 'checkbox', id: 'mock-s' + sh.n }); cb.checked = true; fs.appendChild(el('label', { class: 'check', for: 'mock-s' + sh.n }, [cb, ' ' + sh.n + '. ' + sh.title])); });
    form.appendChild(fs);
    form.appendChild(el('div', { class: 'row' }, [
      el('label', { class: 'field', for: 'mock-n' }, ['Questions', el('select', { id: 'mock-n' }, [3, 4, 5, 6, 8].map(function (n) { var o = el('option', { value: String(n), text: String(n) }); if (n === 5) o.selected = true; return o; }))]),
      el('label', { class: 'field', for: 'mock-min' }, ['Minutes', el('select', { id: 'mock-min' }, [20, 30, 45, 60, 90].map(function (n) { var o = el('option', { value: String(n), text: String(n) }); if (n === 45) o.selected = true; return o; }))])]));
    form.appendChild(el('div', { class: 'row' }, [el('button', { class: 'btn primary', type: 'submit', text: 'Start the clock' }), el('span', { class: 'bad', id: 'mock-msg', 'aria-live': 'polite' })]));
    wrap.appendChild(form);
    view.appendChild(wrap);
  }

  /* ---------- routing ---------- */
  function route() {
    var id = location.hash.slice(1) || 'home';
    clearView();
    var inMock = S.mock && !S.mock.done && S.mock.ids.indexOf(id) >= 0;
    document.body.classList.remove('nav-open');
    if (id === 'home') homeView();
    else if (id === 'playground') playView();
    else if (id === 'mock') mockView();
    else if (/^sheet-[1-6]$/.test(id)) sheetView(+id.slice(6));
    else if (EX[id]) {
      var ex = EX[id];
      if (ex.type === 'code') codeView(ex, inMock);
      else if (ex.type === 'expr') exprView(ex, inMock);
      else if (ex.type === 'predict') predictView(ex);
      else writtenView(ex);
      document.title = ex.title + ' · Haskell Sheet Revision';
    } else homeView();
    if (!EX[id]) document.title = 'Haskell Sheet Revision';
    paintSidebar(); paintMockBar();
  }

  /* ---------- wiring ---------- */
  ['all', 'todo', 'flag'].forEach(function (f) { $('#filter-' + f).addEventListener('click', function () { S.filter = f; save(); paintSidebar(); }); });
  $('#nav-toggle').addEventListener('click', function () { document.body.classList.toggle('nav-open'); });
  $('#dialog').addEventListener('click', function (ev) { if (ev.target === $('#dialog')) $('#dialog').hidden = true; });
  $('#theme').addEventListener('click', function () {
    var root = document.documentElement, dark = root.getAttribute('data-theme') ? root.getAttribute('data-theme') === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    S.theme = dark ? 'light' : 'dark'; save(); applyTheme();
  });
  window.addEventListener('hashchange', route);
  applyTheme(); paintTop(); paintSave(); route();
  connectCloud();
  E.init().catch(function () {});
})();
