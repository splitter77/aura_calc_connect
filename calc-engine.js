/*
 * Moteur de calcul façon calculatrice iOS (mode expression, iOS 18+).
 * Fonctions pures : l'état est un objet JSON, ce qui permet de le partager tel quel entre les deux iPhones.
 *
 * Calcul décimal exact (BigInt) : pas d'erreur d'arrondi, pas de limite à 12 chiffres.
 * 0,1 + 0,2 = 0,3 et 98765432109876543 × 3 = 296296296329629629, au chiffre près.
 *
 *   let s = CalcEngine.initialState();
 *   s = CalcEngine.press(s, '7').state;
 *   CalcEngine.view(s)  // { main: '7', sub: '' }
 *
 * Format des nombres : CalcEngine.setLocale('fr') → 1 234,5 ; CalcEngine.setLocale('en') → 1,234.5.
 * L'état ne contient que des nombres bruts : chaque iPhone l'affiche dans sa propre langue.
 *
 * Touches : '0'…'9', '.', '+', '-', '*', '/', '=', '%', 'neg', 'back', 'clear', 'clearHistory'.
 */
(function (root) {
  'use strict';

  var OPS = { '+': 1, '-': 1, '*': 2, '/': 2 };
  var GLYPH = { '+': '+', '-': '−', '*': '×', '/': '÷' };
  var MAX_DIGITS = 100;     // chiffres par nombre saisi (simple garde-fou : en pratique on ne s'arrête jamais)
  var DIV_DIGITS = 30;      // décimales calculées pendant une division
  var SHOW_DIGITS = 10;     // décimales significatives affichées pour un résultat qui ne tombe pas juste
  var MAX_HISTORY = 30;

  function initialState() {
    return {
      tokens: [],        // [{ raw: '12.5' }, '+', { raw: '10%' }, …] : nombres et opérateurs déjà saisis
      entry: '',         // nombre en cours de saisie (brut : '-12.50', '10%')
      done: false,       // true juste après '='
      result: null,      // résultat (chaîne décimale brute) affiché après '='
      expr: [],          // jetons de l'expression affichée en petit après '='
      error: false,
      last: null,        // { op, raw } : dernière opération, pour répéter avec '='
      history: []        // [{ expr: jetons, result: brut, forced? }], plus récent en premier
    };
  }

  function clone(s) { return JSON.parse(JSON.stringify(s)); }
  function isOp(t) { return typeof t === 'string' && OPS[t] !== undefined; }
  function digitsIn(raw) { return (raw.match(/\d/g) || []).length; }

  // ---- décimaux exacts : { m: BigInt, e: nombre de décimales } ; valeur = m / 10^e ----------

  var TEN = BigInt(10), ZERO = BigInt(0), ONE = BigInt(1), TWO = BigInt(2);
  function pow10(n) { return TEN ** BigInt(n); }
  function abs(b) { return b < ZERO ? -b : b; }

  function dec(str) {
    str = String(str).trim().replace(/\s/g, '').replace(',', '.');
    var m = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(str);
    if (!m || (m[2] === '' && (m[3] || '') === '')) return null;
    var frac = m[3] || '';
    var d = { m: BigInt((m[1] === '-' ? '-' : '') + ((m[2] || '0') + frac)), e: frac.length };
    var exp = m[4] ? parseInt(m[4], 10) : 0;
    if (exp > 0) { var k = Math.min(exp, d.e); d.e -= k; d.m *= pow10(exp - k); }
    else if (exp < 0) d.e -= exp;
    return norm(d);
  }
  function norm(d) {
    var m = d.m, e = d.e;
    while (e > 0 && m % TEN === ZERO) { m /= TEN; e--; }
    return { m: m, e: e };
  }
  function align(a, b) { var e = Math.max(a.e, b.e); return [a.m * pow10(e - a.e), b.m * pow10(e - b.e), e]; }
  function add(a, b) { var x = align(a, b); return norm({ m: x[0] + x[1], e: x[2] }); }
  function sub(a, b) { var x = align(a, b); return norm({ m: x[0] - x[1], e: x[2] }); }
  function mul(a, b) { return norm({ m: a.m * b.m, e: a.e + b.e }); }
  function div(a, b) {
    if (b.m === ZERO) return null;
    var num = a.m * pow10(b.e + DIV_DIGITS), den = b.m * pow10(a.e);
    return norm({ m: roundDiv(num, den), e: DIV_DIGITS });
  }
  function roundDiv(num, den) {                       // division entière arrondie au plus proche
    var q = num / den, r = num % den;
    if (abs(r) * TWO >= abs(den)) q += ((num < ZERO) !== (den < ZERO)) ? -ONE : ONE;
    return q;
  }
  function roundTo(d, frac) {
    if (d.e <= frac) return d;
    return norm({ m: roundDiv(d.m, pow10(d.e - frac)), e: frac });
  }
  function decToRaw(d) {
    var neg = d.m < ZERO, s = abs(d.m).toString();
    if (d.e > 0) { while (s.length <= d.e) s = '0' + s; s = s.slice(0, s.length - d.e) + '.' + s.slice(s.length - d.e); }
    return (neg ? '-' : '') + s;
  }
  /** Arrondi d'affichage : 2/3 → 0,6666666667, mais 0,000000000012 reste lisible. */
  function tidy(d) {
    if (d.e <= SHOW_DIGITS) return d;
    var s = abs(d.m).toString();
    var lead = d.e - s.length;                        // zéros entre la virgule et le premier chiffre
    return roundTo(d, Math.min(DIV_DIGITS, Math.max(SHOW_DIGITS, lead + SHOW_DIGITS)));
  }

  // ---- affichage ---------------------------------------------------------------

  var LOCALES = { fr: { group: '\u202f', dec: ',' }, en: { group: ',', dec: '.' } };
  var SEP = LOCALES.fr;
  /** 'fr' (1 234,5) ou 'en' (1,234.5). */
  function setLocale(lang) { SEP = LOCALES[lang] || LOCALES.fr; }
  function decimalSign() { return SEP.dec; }

  /** Chaîne brute → texte à la française ('-1234.50%' → '−1 234,50%'). */
  function formatRaw(raw) {
    if (raw === '' || raw === null || raw === undefined) return '';
    raw = String(raw);
    var pct = /%$/.test(raw);
    var body = raw.replace('%', '');
    if (/e/i.test(body)) { var d = dec(body); body = d ? decToRaw(d) : body; }
    var neg = body[0] === '-';
    if (neg) body = body.slice(1);
    var parts = body.split('.');
    var int = (parts[0] || '0').replace(/\B(?=(\d{3})+(?!\d))/g, SEP.group);
    return (neg ? '−' : '') + int + (parts.length > 1 ? SEP.dec + parts[1] : '') + (pct ? '%' : '');
  }

  /** Résultat → texte affiché ('Erreur' si division par zéro). Accepte une chaîne brute ou un nombre. */
  function formatNumber(v) {
    if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return 'Erreur';
    var d = dec(typeof v === 'number' ? numToStr(v) : v);
    return d ? formatRaw(decToRaw(d)) : 'Erreur';
  }
  function numToStr(n) { return n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 }); }

  // ---- évaluation --------------------------------------------------------------

  function rawDec(raw) { return dec(String(raw).replace('%', '')) || { m: ZERO, e: 0 }; }

  /** Évalue les jetons avec la priorité des opérations et les % façon iOS. Renvoie un décimal, ou null (erreur). */
  function evalDec(tokens) {
    var list = tokens.slice();
    while (list.length && isOp(list[list.length - 1])) list.pop();
    if (!list.length) return { m: ZERO, e: 0 };

    // 1. Pourcentages : « 50 + 10% » = 55, « 50 × 10% » = 5.
    var vals = [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (isOp(t)) { vals.push(t); continue; }
      var v = rawDec(t.raw);
      if (/%$/.test(t.raw)) {
        v = div(v, { m: BigInt(100), e: 0 });
        if (i >= 2 && (list[i - 1] === '+' || list[i - 1] === '-')) {
          var base = evalDec(list.slice(0, i - 1));
          if (!base) return null;
          v = mul(base, v);
        }
      }
      vals.push(v);
    }

    // 2. × et ÷ d'abord.
    var stack = [vals[0]];
    for (var j = 1; j < vals.length; j += 2) {
      var op = vals[j], b = vals[j + 1], top = stack.length - 1;
      if (op === '*') stack[top] = mul(stack[top], b);
      else if (op === '/') { stack[top] = div(stack[top], b); if (!stack[top]) return null; }
      else stack.push(op, b);
    }
    // 3. + et −.
    var acc = stack[0];
    for (var k = 1; k < stack.length; k += 2) acc = stack[k] === '+' ? add(acc, stack[k + 1]) : sub(acc, stack[k + 1]);
    return acc;
  }

  /** Version pratique pour les tests : renvoie la chaîne brute du résultat, ou null. */
  function evaluate(tokens) { var d = evalDec(tokens); return d ? decToRaw(tidy(d)) : null; }

  function exprText(tokens, entry) {
    var parts = tokens.map(function (t) { return isOp(t) ? GLYPH[t] : formatRaw(t.raw); });
    if (entry) parts.push(formatRaw(entry));
    return parts.join('');
  }

  // ---- touches -----------------------------------------------------------------

  function resetEntry(s) { s.tokens = []; s.entry = ''; s.done = false; s.error = false; s.result = null; s.expr = []; }

  /** Repart du résultat affiché pour continuer le calcul. */
  function continueFrom(s) {
    var r = s.error || s.result === null ? '0' : s.result;
    resetEntry(s);
    s.entry = r;
  }

  function commit(s) {
    if (s.entry === '' || s.entry === '-') { s.entry = ''; return; }
    s.tokens.push({ raw: s.entry.replace(/\.$/, '').replace(/\.%$/, '%') });
    s.entry = '';
  }

  function finish(s, raw, expr, forced) {
    s.result = raw;
    s.error = raw === null;
    s.expr = expr;
    s.done = true;
    var item = { expr: expr, result: raw };
    if (forced) item.forced = true;
    s.history.unshift(item);
    if (s.history.length > MAX_HISTORY) s.history.length = MAX_HISTORY;
  }

  function forceRaw(force) {
    if (force === null || force === undefined || force === '') return null;
    var d = dec(typeof force === 'number' ? (isFinite(force) ? numToStr(force) : '') : force);
    return d ? decToRaw(d) : null;
  }

  /**
   * Applique une touche. options.force : nombre (ou chaîne) à afficher au prochain '=' à la place du vrai résultat.
   * Renvoie { state, forced } (forced = true si la valeur forcée a été utilisée).
   */
  function press(state, key, options) {
    var s = clone(state);
    var force = forceRaw(options && options.force);
    var forced = false;
    var same = { state: s, forced: false };

    if (/^\d$/.test(key)) {
      if (s.done) resetEntry(s);
      if (/%$/.test(s.entry) || digitsIn(s.entry) >= MAX_DIGITS) return same;
      if (s.entry === '0') s.entry = key;
      else if (s.entry === '-0') s.entry = '-' + key;
      else s.entry += key;
    }

    else if (key === '.') {
      if (s.done) resetEntry(s);
      if (/%$/.test(s.entry) || s.entry.indexOf('.') >= 0) return same;
      s.entry = (s.entry === '' || s.entry === '-') ? s.entry + '0.' : s.entry + '.';
    }

    else if (isOp(key)) {
      if (s.done) continueFrom(s);
      commit(s);
      if (!s.tokens.length) s.tokens.push({ raw: '0' });
      if (isOp(s.tokens[s.tokens.length - 1])) s.tokens[s.tokens.length - 1] = key;
      else s.tokens.push(key);
    }

    else if (key === '=') {
      var toks;
      if (s.done) {
        if (!s.last || s.error) return same;
        toks = [{ raw: s.result }, s.last.op, { raw: s.last.raw }];
      } else {
        commit(s);
        while (s.tokens.length && isOp(s.tokens[s.tokens.length - 1])) s.tokens.pop();
        if (!s.tokens.length) return same;
        toks = s.tokens;
        var n = toks.length;
        s.last = n >= 3 ? { op: toks[n - 2], raw: toks[n - 1].raw } : null;
      }
      forced = force !== null;
      finish(s, forced ? force : evaluate(toks), clone(toks), forced);
      s.tokens = [];
    }

    else if (key === '%') {
      if (s.done) continueFrom(s);
      if (s.entry === '' || s.entry === '-' || /%$/.test(s.entry)) return same;
      s.entry = s.entry.replace(/\.$/, '') + '%';
    }

    else if (key === 'neg') {
      if (s.done) continueFrom(s);
      s.entry = /^-/.test(s.entry) ? s.entry.slice(1) : '-' + s.entry;
    }

    else if (key === 'back') {
      if (s.done) resetEntry(s);
      else if (s.entry !== '') s.entry = s.entry.slice(0, -1);
      else if (s.tokens.length) {
        s.tokens.pop();                                   // l'opérateur
        var prev = s.tokens.pop();                        // le nombre d'avant redevient la saisie
        s.entry = prev ? prev.raw : '';
      }
    }

    else if (key === 'clear') resetEntry(s);
    else if (key === 'clearHistory') s.history = [];

    return { state: s, forced: forced };
  }

  /** Ce qu'il faut afficher : main = grande ligne, sub = petite ligne au-dessus. */
  function view(s) {
    if (s.done) return { main: formatNumber(s.result), sub: exprText(s.expr || [], '') };
    return { main: exprText(s.tokens, s.entry) || '0', sub: '' };
  }

  /** Ligne d'historique prête à afficher, dans la langue courante. */
  function historyView(item) {
    return { expr: Array.isArray(item.expr) ? exprText(item.expr, '') : String(item.expr || ''),
      result: formatNumber(item.result), forced: !!item.forced };
  }

  var api = {
    initialState: initialState, press: press, view: view, historyView: historyView, evaluate: evaluate,
    setLocale: setLocale, decimalSign: decimalSign,
    formatNumber: formatNumber, formatRaw: formatRaw, GLYPH: GLYPH, MAX_DIGITS: MAX_DIGITS
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CalcEngine = api;
})(typeof self !== 'undefined' ? self : this);
