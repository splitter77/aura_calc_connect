// node test/engine.test.js
const E = require('../calc-engine.js');
const assert = require('assert');
function run(keys, opts) {
  let s = E.initialState(), forced = false;
  for (const k of keys) { const r = E.press(s, k, opts); s = r.state; forced = forced || r.forced; }
  return { s, v: E.view(s), forced };
}
const k = (str) => str.split(' ');
const cases = [
  ['1 2 + 3 =', '15'],
  ['2 + 3 * 4 =', '14'],
  ['1 0 / 4 =', '2,5'],
  ['1 / 0 =', 'Erreur'],
  ['5 0 + 1 0 % =', '55'],
  ['5 0 * 1 0 % =', '5'],
  ['1 0 % =', '0,1'],
  ['1 + 2 = = =', '7'],
  ['0 . 1 + 0 . 2 =', '0,3'],
  ['1 2 3 4 5 6 7 =', '1 234 567'],
  ['5 neg * 2 =', '−10'],
  ['9 + 1 = * 3 =', '30'],
  ['1 2 back 3 =', '13'],
  ['1 2 + back 5 =', '125'],
  ['7 + =', '7'],
  ['9 9 9 9 9 9 9 * 9 9 9 9 9 9 9 =', '99\u202f999\u202f980\u202f000\u202f001'],
  ['9 8 7 6 5 4 3 2 1 0 9 8 7 6 5 4 3 * 3 =', '296\u202f296\u202f296\u202f329\u202f629\u202f629'],
  ['1 / 3 * 3 =', '1'],
  ['1 / 7 =', '0,1428571429'],
  ['1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 + 1 =', '12\u202f345\u202f678\u202f901\u202f234\u202f567\u202f891'],
  ['2 / 3 =', '0,6666666667'],
];
let ok = 0;
for (const [keys, want] of cases) {
  const { v } = run(k(keys));
  try { assert.strictEqual(v.main, want); ok++; } catch (e) { console.log('FAIL', keys, '→', JSON.stringify(v.main), 'attendu', JSON.stringify(want)); }
}
// Affichage pendant la saisie
assert.strictEqual(run(k('1 2 + 3 . 5')).v.main, '12+3,5');
assert.strictEqual(run(k('1 2 3 4 * 5')).v.main, '1 234×5');
assert.strictEqual(run(k('1 2 + 3 =')).v.sub, '12+3');
// Plus de blocage à 12 chiffres
assert.strictEqual(run(k('1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6')).v.main, '1\u202f234\u202f567\u202f890\u202f123\u202f456');
assert.strictEqual(run(Array(150).fill('9')).s.entry.length, E.MAX_DIGITS);
// Forçage
const f = run(k('1 2 + 3 ='), { force: '1234' });
assert.strictEqual(f.v.main, '1 234'); assert.ok(f.forced); assert.ok(f.s.history[0].forced);
assert.strictEqual(E.historyView(f.s.history[0]).result, '1\u202f234');
// Historique
assert.strictEqual(run(k('1 + 1 = 2 * 2 =')).s.history.length, 2);
// Anglais : même état, autre affichage
E.setLocale('en');
const en = run(k('1 2 3 4 . 5 * 2 ='));
assert.strictEqual(en.v.main, '2,469');
assert.strictEqual(en.v.sub, '1,234.5×2');
assert.strictEqual(run(k('1 / 4 =')).v.main, '0.25');
assert.strictEqual(E.historyView(en.s.history[0]).expr, '1,234.5×2');
assert.strictEqual(E.decimalSign(), '.');
E.setLocale('fr');
assert.strictEqual(E.historyView(en.s.history[0]).expr, '1\u202f234,5×2');
console.log(`${ok}/${cases.length} cas OK + assertions supplémentaires OK`);
