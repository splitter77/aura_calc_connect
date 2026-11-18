/*
 * Calculatrice connectée.
 *  - App Clip (invité, spectateur) : une calculatrice normale, rien ne trahit la connexion.
 *  - Aura Browser (hôte, artiste) : la même calculatrice en miroir, en direct ; le bouton en haut à droite
 *    ouvre le panneau de connexion (statut, forçage du résultat, journal des touches).
 *
 * Tout passe par AuraKit : link.shared('calc') garde l'état identique sur les deux iPhones,
 * link.send('key') informe l'artiste de chaque touche, link.shared('force') arme un résultat forcé.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var T = AuraI18n.t;   // T('français', 'English') selon la langue du téléphone ou le choix fait dans le panneau
  // Nombres au format de la langue : 1 234,5 et touche « , » en français ; 1,234.5 et touche « . » en anglais.
  CalcEngine.setLocale(AuraI18n.lang);
  document.querySelector('[data-key="."]').textContent = CalcEngine.decimalSign();
  var LABEL = { '*': '×', '/': '÷', '-': '−', '+': '+', neg: '±', back: '⌫', clear: 'AC', '.': CalcEngine.decimalSign(), '=': '=', '%': '%' };

  // ---- liaison AuraKit ---------------------------------------------------------

  // Liaison Bluetooth LE sans jumelage : pas de code de salon, l'App Clip ne rejoint que l'Aura Browser
  // de la personne dont le tag l'a ouvert. On ignore tout code mémorisé ou passé dans l'URL.
  try { localStorage.removeItem('aurakit.room'); } catch (e) { /* ignore */ }
  var link = AuraKit.link({
    room: undefined, rememberRoom: false, urlParams: false,
    joinTimeout: 10, retryDelay: 1500,
    debug: /[?&]debug/.test(location.search)
  });
  var calc = link.shared('calc', CalcEngine.initialState());
  var force = link.shared('force', { value: null });

  AuraKit.orientation.lock('portrait').catch(function () {});

  // ---- affichage ---------------------------------------------------------------

  var mainEl = $('main'), subEl = $('sub'), displayEl = mainEl.parentNode;
  var clearKey = document.querySelector('[data-key="clear"]');

  // Comme la vraie calculatrice : toujours une seule ligne. Le texte rétrécit jusqu'à une taille minimale
  // (environ 12 chiffres sur la largeur), puis le début sort par la gauche en fondu ; on peut le faire
  // défiler du doigt pour revoir le début.
  function fitLine(el, text, max, min) {
    el.textContent = text;
    el.style.fontSize = max + 'px';
    var width = el.clientWidth, size = max;
    while (el.scrollWidth > width && size > min) { size -= 1; el.style.fontSize = size + 'px'; }
    var over = el.scrollWidth > width + 1;
    el.classList.toggle('overflow', over);
    el.scrollLeft = over ? el.scrollWidth : 0;
  }

  function fitMain(text) {
    var w = displayEl.clientWidth;
    var max = Math.max(48, Math.min(96, Math.floor(displayEl.clientHeight * 0.5), Math.round(w * 0.27)));
    fitLine(mainEl, text, max, Math.round(w * 0.128));
  }
  function fitSub(text) { fitLine(subEl, text, 34, 22); }

  function render() {
    var v = CalcEngine.view(calc.get());
    fitSub(v.sub);
    fitMain(v.main);
    var st = calc.get();
    clearKey.textContent = (st.entry !== '' || st.tokens.length) ? 'C' : 'AC';   // AC devient C dès qu'on tape
    renderHistory();
  }

  calc.subscribe(function (value, info) { render(); });
  window.addEventListener('resize', render);

  // ---- touches -----------------------------------------------------------------

  function press(key) {
    var f = force.get().value;
    var r = CalcEngine.press(calc.get(), key, { force: f });
    calc.set(r.state);
    if (r.forced) force.set({ value: null });
    link.send('key', { key: key, forced: r.forced });   // l'artiste affiche l'écran dans sa propre langue
  }

  var keys = $('keys');
  keys.addEventListener('pointerdown', function (e) {
    var b = e.target.closest('.key'); if (!b) return;
    b.classList.add('down');
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (type) {
    keys.addEventListener(type, function () {
      keys.querySelectorAll('.key.down').forEach(function (b) { b.classList.remove('down'); });
    }, true);
  });
  keys.addEventListener('click', function (e) {
    var b = e.target.closest('.key'); if (b) press(b.dataset.key);
  });

  // Clavier physique (pratique pour tester sur ordinateur).
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT') return;
    var map = { Enter: '=', Backspace: 'back', Escape: 'clear', ',': '.', x: '*', X: '*' };
    var k = map[e.key] || e.key;
    if (/^[0-9.+\-*/=%]$/.test(k) || k === 'back' || k === 'clear') { e.preventDefault(); press(k); }
  });

  // ---- historique --------------------------------------------------------------

  function renderHistory() {
    var list = calc.get().history || [];
    var showForced = link.isHost;
    $('historyList').innerHTML = list.map(function (item) {
      var h = CalcEngine.historyView(item);
      return '<li><div class="h-expr">' + esc(h.expr) + '</div><div class="h-res">' +
        (h.forced && showForced ? '<span class="h-forced">' + T('forcé', 'forced') + '</span>' : '') + esc(h.result) + '</div></li>';
    }).join('');
    $('historyEmpty').hidden = list.length > 0;
  }
  $('historyBtn').onclick = function () { $('historySheet').hidden = false; };
  $('historyClose').onclick = function () { $('historySheet').hidden = true; };
  $('historyClear').onclick = function () { press('clearHistory'); };

  // ---- panneau de l'artiste (Aura Browser) ---------------------------------------

  $('modeBtn').onclick = function () {
    if (link.isHost) { $('panel').hidden = false; renderLog(); }
  };
  $('panelClose').onclick = function () { $('panel').hidden = true; };
  document.querySelectorAll('.sheet').forEach(function (sheet) {
    sheet.addEventListener('click', function (e) { if (e.target === sheet) sheet.hidden = true; });
  });

  var STATUS = {
    idle: T('Inactif', 'Idle'), starting: T('Démarrage…', 'Starting…'),
    waiting: T('En attente de l\'App Clip…', 'Waiting for the App Clip…'), searching: T('Recherche d\'Aura Browser…', 'Looking for Aura Browser…'),
    connected: T('Connecté', 'Connected'), error: T('Erreur', 'Error'), stopped: T('Arrêté', 'Stopped'), unavailable: T('Indisponible', 'Unavailable')
  };
  function renderStatus() {
    $('dot').className = 'dot ' + link.status;
    var peer = Array.from(link.peers.values()).join(', ');
    $('statusText').textContent = (STATUS[link.status] || link.status) + (peer ? ' · ' + peer : '') +
      (link.error && !link.connected ? ' — ' + link.error : '');
  }
  link.on('status', renderStatus);
  link.on('connect', function (p) {
    renderStatus();
    if (link.isHost) { toast(T('Spectateur connecté', 'Spectator connected')); }
  });
  link.on('disconnect', function () {
    renderStatus();
    if (link.isHost) { toast(T('Spectateur déconnecté', 'Spectator disconnected')); }
  });
  renderStatus();

  AuraKit.ready().then(function (env) {
    var where = env.mock ? T('Simulateur · ', 'Simulator · ') + (env.appClip ? 'App Clip' : 'Aura Browser')
      : env.appClip ? 'App Clip' : env.browser ? 'Aura Browser' : T('Hors Aura', 'Not in Aura');
    $('envText').textContent = where + (env.available ? '' : ' — ' + (env.reason || T('fonctions natives indisponibles', 'native features unavailable')));
  });

  // Forçage
  force.subscribe(function (f) {
    var armed = f.value !== null && f.value !== undefined;
    $('forceState').textContent = armed ? T('Armé : ', 'Armed: ') + CalcEngine.formatNumber(f.value) + T(' au prochain « = »', ' on the next “=”') : T('Non armé', 'Not armed');
    $('forceBtn').textContent = armed ? T('Désarmer', 'Disarm') : T('Armer', 'Arm');
    $('forceBtn').classList.toggle('armed', armed);
  });
  $('forceForm').onsubmit = function (e) {
    e.preventDefault();
    if (force.get().value !== null) { force.set({ value: null }); return; }
    var n = $('forceInput').value.replace(/[\s\u202f\u00a0]/g, '').replace('−', '-');
    // Français : « , » décimale ; anglais : « , » séparateur de milliers.
    n = AuraI18n.lang === 'en' ? n.replace(/,/g, '') : n.replace(/\./g, '').replace(',', '.');
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(n)) { toast(T('Nombre invalide', 'Invalid number')); return; }
    force.set({ value: n });
    $('forceInput').value = '';
    $('forceInput').blur();
  };

  $('resetBoth').onclick = function () {
    var s = CalcEngine.initialState();
    calc.set(s);
    force.set({ value: null });
    keyLog.length = 0; renderLog();
  };

  // Journal des touches du spectateur (reçues par l'artiste)
  var keyLog = [];
  link.onMessage('key', function (msg) {
    if (!link.isHost || !msg) return;
    var time = new Date().toTimeString().slice(0, 8);
    keyLog.unshift(time + '  ' + pad(LABEL[msg.key] || msg.key) + '  ' + CalcEngine.view(calc.get()).main + (msg.forced ? '  (' + T('forcé', 'forced') + ')' : ''));
    if (keyLog.length > 100) keyLog.length = 100;
    renderLog();
  });
  function renderLog() { $('keyLog').textContent = keyLog.join('\n') || T('Aucune touche pour l\'instant.', 'No keys yet.'); }

  // ---- utilitaires ---------------------------------------------------------------

  var toastTimer;
  function toast(text) {
    var el = $('toast');
    el.textContent = text; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pad(s) { s = String(s); return s + '   '.slice(s.length); }
})();
