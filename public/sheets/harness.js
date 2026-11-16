/* Builds the Haskell files for a run and reads the results back. Shared by the page and the build check. */
(function (root) {
  'use strict';
  var TFUN = [
    'enc__ :: String -> String',
    'enc__ s = unwords (map (show . fromEnum) s)',
    'rep__ :: Int -> Either E__.SomeException String -> IO ()',
    'rep__ n r = putStrLn (case r of { Left ex -> "\\n@@T " ++ show n ++ " EXC " ++ enc__ (show ex); Right v -> "\\n@@T " ++ show n ++ " OK " ++ enc__ v })',
    't__ :: Int -> String -> IO ()',
    't__ n s = do',
    '  r <- E__.try (E__.evaluate (length s `seq` s)) :: IO (Either E__.SomeException String)',
    '  rep__ n r',
    'io__ :: Show a => Int -> IO a -> IO ()',
    'io__ n act = do',
    '  r <- E__.try (act >>= \\v -> let s = show v in E__.evaluate (length s `seq` s)) :: IO (Either E__.SomeException String)',
    '  rep__ n r'
  ];

  function mainFile(opts, tests) {
    var L = ['module Main where'];
    if (opts.hide && opts.hide.length) L.push('import Prelude hiding (' + opts.hide.join(', ') + ')');
    L.push('import qualified Control.Exception as E__');
    (opts.imports || []).forEach(function (m) { L.push('import ' + m); });
    if (!opts.noSheet) L.push('import Sheet');
    if (opts.aux) L.push(opts.aux);
    L = L.concat(TFUN);
    L.push('main :: IO ()');
    L.push('main = do');
    tests.forEach(function (t, i) {
      L.push(t.io ? '  io__ ' + i + ' (' + t.e + ')' : '  t__ ' + i + ' (show (' + t.e + '))');
    });
    L.push('  putStrLn "\\n@@END"');
    return L.join('\n') + '\n';
  }

  function stripComments(src) {
    return src.replace(/\{-[\s\S]*?-\}/g, ' ').replace(/--.*$/gm, '');
  }

  function parseRe(spec) {
    var m = /^\/(.*)\/([a-z]*)$/.exec(spec);
    return new RegExp(m[1], m[2]);
  }

  function codeRun(ex, code) {
    var body = code.replace(/^\s*module\s+[\w.]+(\s*\([^)]*\))?\s+where\s*$/m, '');
    return {
      files: {
        'Sheet.hs': 'module Sheet where\n' + body + '\n',
        'Main.hs': mainFile({ hide: ex.hide, imports: ex.imports, aux: ex.aux }, ex.tests)
      },
      stdin: ex.stdin || '',
      offset: 1
    };
  }

  function exprRun(part, expr) {
    var ind = expr.replace(/\t/g, '  ').split('\n').map(function (l) { return '  ' + l; }).join('\n');
    return {
      files: {
        'Sheet.hs': 'module Sheet where\nimport Data.Char\nimport Data.List\nanswer__ =\n' + ind + '\n',
        'Main.hs': mainFile({ imports: ['Data.Char', 'Data.List'] },
          [{ e: 'answer__' }, { e: '(' + part.check + ') answer__' }])
      },
      stdin: '',
      offset: 4
    };
  }

  function predictRun(ex) {
    var items = ex.items.filter(function (it) { return !/ERROR$/.test(it.a); });
    return {
      items: items,
      files: {
        'Main.hs': mainFile({ imports: ['Data.Char', 'Data.List'], aux: ex.aux, noSheet: true },
          items.map(function (it) { return { e: it.e }; }))
      },
      stdin: ''
    };
  }

  function playRun(code) {
    return { files: { 'Main.hs': code + '\n' }, stdin: '', offset: 0 };
  }

  function dec(s) {
    s = s.trim();
    if (!s) return '';
    return s.split(/\s+/).map(function (n) { return String.fromCodePoint(+n); }).join('');
  }

  /* Reads marker lines out of stdout. Returns {results: {i: {ok, val}}, ended, stdout}. */
  function parseOut(out) {
    var res = {}, ended = false, rest = [];
    out.split('\n').forEach(function (line) {
      var m = /^@@T (\d+) (OK|EXC) ?(.*)$/.exec(line);
      if (m) res[+m[1]] = { ok: m[2] === 'OK', val: dec(m[3]) };
      else if (line === '@@END') ended = true;
      else rest.push(line);
    });
    return { results: res, ended: ended, stdout: rest.join('\n').replace(/\n{2,}/g, '\n').trim() };
  }

  /* Rewrites "Sheet.hs:12:3" and the "12 | code" gutter so line numbers match the editor. */
  function fixErr(err, offset) {
    if (!offset) return err.replace(/\x1b\[[0-9;]*m/g, '');
    return err.replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/(?:\.\/)?Sheet\.hs:(\d+):/g, function (_, n) { return 'line ' + Math.max(1, n - offset) + ':'; })
      .replace(/^(\s*)(\d+)( \|)/gm, function (_, a, n, b) {
        var s = String(Math.max(1, n - offset)); return a + s + ' '.repeat(Math.max(0, n.length - s.length)) + b;
      });
  }

  function sourceChecks(ex, code) {
    var src = stripComments(code);
    return (ex.checks || []).map(function (c) {
      var hit = parseRe(c.re).test(src);
      return { msg: c.msg, ok: c.kind === 'req' ? hit : !hit };
    });
  }

  function deparenOk(orig, ans) {
    var strip = function (s) { return s.replace(/[()\s]/g, ''); };
    var count = function (s) { return (s.match(/\(/g) || []).length; };
    return { same: strip(orig) === strip(ans), minimal: count(ans) === count(orig) + 1 };
  }

  var api = { mainFile: mainFile, codeRun: codeRun, exprRun: exprRun, predictRun: predictRun, playRun: playRun,
    parseOut: parseOut, fixErr: fixErr, sourceChecks: sourceChecks, parseRe: parseRe, stripComments: stripComments, deparenOk: deparenOk };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Harness = api;
})(typeof self !== 'undefined' ? self : this);
