/* Runs Haskell through Haskell Prep's in-browser runtime (../hs-frame.html, browser-haskell / MicroHs).
   The sheet harness builds Sheet.hs + Main.hs; the runtime takes one Main module, so they are merged here.
   The runtime frame is sandboxed, so the browser gives it its own process: a run that never ends can't
   freeze this page, and deleting the frame kills it. */
(function () {
  'use strict';
  var state = 'idle', listeners = [], failure = null;
  var frame = null, seq = 0, pending = {}, readyP = null, current = null;

  function setState(s, detail) { state = s; failure = detail || null; listeners.forEach(function (f) { f(s, failure); }); }

  function spawn() {
    if (frame) frame.remove();
    Object.keys(pending).forEach(function (id) { pending[id]({ stdout: '', stderr: '', error: 'restarted', exitCode: 1 }); });
    pending = {};
    frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.src = '../hs-frame.html';
    frame.title = 'Haskell runtime';
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
  }

  window.addEventListener('message', function (ev) {
    if (!frame || ev.source !== frame.contentWindow) return;
    var m = ev.data || {};
    if (m.type === 'ready' && readyP) readyP.resolve();
    else if (m.type === 'boot-error' && readyP) readyP.reject(new Error(m.error || 'boot failed'));
    else if (m.type === 'done' && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
  });

  function init() {
    if (readyP) return readyP.p;
    if (state !== 'ready') setState('loading');
    var res, rej, p = new Promise(function (a, b) { res = a; rej = b; });
    readyP = { p: p, resolve: res, reject: rej };
    spawn();
    p.then(function () { setState('ready'); }, function (e) { readyP = null; setState('failed', String(e && e.message || e)); });
    return p;
  }
  /* Throw the runtime away (killing any stuck run) and boot a fresh one in the background. */
  function restart() { readyP = null; init().catch(function () {}); }

  var IMPORT = /^import\s/;
  /* One Main module: module line, all imports, then Sheet.hs's code, then Main.hs's code.
     Returns the code and how many lines precede the first line of Sheet.hs. */
  function merge(files) {
    var main = (files['Main.hs'] || '').split('\n'), sheet = files['Sheet.hs'];
    if (sheet == null) return { code: files['Main.hs'], sheetStart: 0 };
    var mainImports = [], mainRest = [];
    main.forEach(function (l) {
      if (/^module\s/.test(l) || /^import\s+Sheet\s*$/.test(l)) return;
      (IMPORT.test(l) ? mainImports : mainRest).push(l);
    });
    var sheetLines = sheet.split('\n').filter(function (l, i) { return !(i === 0 && /^module\s/.test(l)); });
    /* Imports in the student's code stay where they are (at its top), so line numbers stay put. */
    var head = ['module Main where'].concat(mainImports);
    return { code: head.concat(sheetLines, [''], mainRest).join('\n'), sheetStart: head.length };
  }

  /* Error positions in the merged file become Sheet.hs positions, which harness.fixErr maps to editor lines. */
  function remapErr(text, sheetStart) {
    text = text.split('\n').filter(function (l) { return !/undefined value: main$/.test(l); }).join('\n')
      .replace(/^\*\*\* Exception: error: /gm, '');
    /* MicroHs writes positions as "./Main.hs": line 13, col 18 */
    return text.replace(/"?(?:\.\/)?Main\.hs"?: line (\d+), col (\d+)/g, function (all, line, col) {
      var n = +line - sheetStart + 1;
      return sheetStart && n >= 1 ? 'Sheet.hs:' + n + ':' + col : 'Main.hs:' + line + ':' + col;
    });
  }

  /* job: {files, stdin, timeout}. Resolves {out, err, code, timedOut, ms}. Only one run at a time. */
  function run(job) {
    return init().then(function () {
      if (current) current.cancel();
      var m = merge(job.files), id = ++seq, t0 = Date.now();
      return new Promise(function (resolve) {
        var finished = false;
        function end(r) { if (finished) return; finished = true; delete pending[id]; current = null; resolve(r); }
        var limit = job.timeout || 25000;
        var timer = setTimeout(function () { end({ out: '', err: '', code: 'timeout', timedOut: true, ms: Date.now() - t0 }); restart(); }, limit + 2000);
        current = { cancel: function () { clearTimeout(timer); end({ out: '', err: '', code: 'cancelled', timedOut: false, ms: Date.now() - t0 }); } };
        pending[id] = function (r) {
          clearTimeout(timer);
          var timedOut = r.exitCode === 124;
          var err = [r.stderr || '', r.error && !timedOut ? r.error : ''].filter(Boolean).join('\n');
          end({ out: String(r.stdout || '').replace(/\n$/, ''), err: remapErr(err, m.sheetStart), code: r.exitCode, timedOut: timedOut, ms: Date.now() - t0 });
          if (timedOut || /disposed|restarted/.test(r.error || '')) restart();
        };
        frame.contentWindow.postMessage({ id: id, code: m.code, stdin: job.stdin || '', timeout: limit }, '*');
      });
    });
  }

  window.Engine = {
    init: init, run: run,
    onState: function (f) { listeners.push(f); f(state, failure); },
    get state() { return state; }
  };
})();
