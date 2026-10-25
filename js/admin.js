(function () {
  'use strict';

  var T = window.TYPES, ORDER = window.TYPE_ORDER;
  var CFG = window.APP_CONFIG;
  var KEY_TO_T = {};
  ORDER.forEach(function (t) { KEY_TO_T[T[t].key] = t; });
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var PICK_KEY = 'crt-admin-class';

  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  firebase.initializeApp(CFG.firebase);
  var auth = firebase.auth();
  var db = firebase.database();

  var classes = [];          // [{code, title, createdAt}]
  var current = null;        // 선택된 반 코드
  var respRef = null;
  var seen = {};             // 이미 그린 아이콘(애니메이션 구분용)
  var boardStarted = false;

  /* ---------- 공통 ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function joinUrl(code) {
    var path = location.pathname.replace(/admin(\.html)?\/?$/, '');
    return location.origin + path + '?c=' + code;
  }

  function qrSvg(text) {
    var qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }

  /* ---------- 로그인 ---------- */
  auth.onAuthStateChanged(function (user) {
    $('loading').hidden = true;
    if (user && user.uid === CFG.instructorUid) {
      $('login').hidden = true;
      $('board').hidden = false;
      startBoard();
    } else {
      if (user && !user.isAnonymous) {
        showLoginError('강사 계정이 아니에요. 등록된 강사 계정으로 로그인해 주세요.');
        auth.signOut();
      }
      $('board').hidden = true;
      $('login').hidden = false;
    }
  });

  function showLoginError(msg) {
    var e = $('loginError');
    e.textContent = msg;
    e.hidden = !msg;
  }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    showLoginError('');
    var btn = this.querySelector('button[type=submit]');
    btn.disabled = true;
    auth.signInWithEmailAndPassword($('email').value.trim(), $('password').value)
      .catch(function (err) {
        var c = err && err.code || '';
        if (/invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/.test(c)) showLoginError('이메일 또는 비밀번호가 맞지 않아요.');
        else if (/too-many-requests/.test(c)) showLoginError('시도가 너무 많아요. 잠시 후 다시 로그인해 주세요.');
        else if (/network/.test(c)) showLoginError('인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
        else if (/unauthorized-domain|operation-not-allowed/.test(c)) showLoginError('Firebase 설정이 끝나지 않았어요. 승인된 도메인과 로그인 방법(이메일/비밀번호)을 확인해 주세요.');
        else showLoginError('로그인하지 못했어요. (' + c + ')');
      })
      .then(function () { btn.disabled = false; });
  });

  /* ---------- 분포 화면 ---------- */
  function startBoard() {
    if (boardStarted) return;
    boardStarted = true;
    buildColumns();

    db.ref('.info/connected').on('value', function (s) {
      var on = s.val() === true;
      $('liveRow').classList.toggle('off', !on);
      $('liveText').textContent = on ? '실시간 반영 중' : '연결 끊김 · 다시 연결하는 중';
    });

    db.ref('classes').on('value', function (snap) {
      var v = snap.val() || {};
      classes = Object.keys(v).map(function (code) {
        return { code: code, title: v[code].title || code, createdAt: v[code].createdAt || 0 };
      }).sort(function (a, b) { return b.createdAt - a.createdAt; });
      renderSelect();
    }, function () { toast('반 목록을 불러오지 못했어요. 보안 규칙을 확인해 주세요'); });
  }

  function renderSelect() {
    var sel = $('classSelect');
    sel.innerHTML = '';
    classes.forEach(function (c) {
      var o = el('option', null, c.title + ' (' + c.code + ')');
      o.value = c.code;
      sel.appendChild(o);
    });
    var want = current;
    if (!want) { try { want = localStorage.getItem(PICK_KEY); } catch (e) {} }
    var has = classes.some(function (c) { return c.code === want; });
    if (!has) want = classes.length ? classes[0].code : null;
    sel.disabled = !classes.length;
    $('noClass').hidden = classes.length > 0;
    if (want) sel.value = want;
    selectClass(want);
  }

  $('classSelect').addEventListener('change', function () { selectClass(this.value); });

  function selectClass(code) {
    var same = code === current;
    current = code;
    try { if (code) localStorage.setItem(PICK_KEY, code); } catch (e) {}
    ['qrBigBtn', 'copyBtn', 'resetBtn', 'deleteBtn'].forEach(function (id) { $(id).disabled = !code; });
    if (!code) {
      $('codeText').textContent = '—';
      $('qrSmall').innerHTML = 'QR';
      if (respRef) { respRef.off(); respRef = null; }
      render({});
      return;
    }
    $('codeText').textContent = code;
    $('qrSmall').innerHTML = qrSvg(joinUrl(code));
    if (same && respRef) return;
    if (respRef) respRef.off();
    seen = {};
    respRef = db.ref('responses/' + code);
    var first = true;
    respRef.on('value', function (snap) {
      render(snap.val() || {}, first);
      first = false;
    }, function () { toast('응답을 불러오지 못했어요. 보안 규칙을 확인해 주세요'); });
  }

  function buildColumns() {
    var cols = $('cols');
    cols.innerHTML = '';
    ORDER.forEach(function (t) {
      var d = T[t];
      var c = el('div', 'col');
      c.style.background = d.tint;
      var nm = el('div', 'col-name');
      nm.appendChild(el('b', null, d.name));
      var en = el('span', null, d.en);
      en.style.color = d.ink;
      nm.appendChild(en);
      c.appendChild(nm);
      var cnt = el('div', 'col-count');
      cnt.style.color = d.ink;
      cnt.id = 'cnt-' + t;
      c.appendChild(cnt);
      var ppl = el('div', 'people');
      ppl.id = 'ppl-' + t;
      ppl.setAttribute('role', 'img');
      c.appendChild(ppl);
      cols.appendChild(c);
    });
  }

  function personSvg(color, mixed, size, animate) {
    var ns = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(ns, 'svg');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    if (animate) s.setAttribute('class', 'pop');
    var c = document.createElementNS(ns, 'circle');
    var p = document.createElementNS(ns, 'path');
    if (mixed) {
      c.setAttribute('cx', '12'); c.setAttribute('cy', '7.5'); c.setAttribute('r', '3.4');
      c.setAttribute('fill', '#FFFFFF'); c.setAttribute('stroke', color); c.setAttribute('stroke-width', '1.6');
      p.setAttribute('d', 'M4.8 20.2c0-4 3.2-7.2 7.2-7.2s7.2 3.2 7.2 7.2z');
      p.setAttribute('fill', '#FFFFFF'); p.setAttribute('stroke', color); p.setAttribute('stroke-width', '1.6');
    } else {
      c.setAttribute('cx', '12'); c.setAttribute('cy', '7.5'); c.setAttribute('r', '4');
      c.setAttribute('fill', color);
      p.setAttribute('d', 'M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z');
      p.setAttribute('fill', color);
    }
    s.appendChild(c);
    s.appendChild(p);
    return s;
  }

  function render(data, initial) {
    // data: { uid: { types: [...], scores, at } }
    var buckets = { E: [], O: [], K: [], S: [] };
    var total = 0, mixed = 0;
    Object.keys(data).sort(function (a, b) { return (data[a].at || 0) - (data[b].at || 0); }).forEach(function (uid) {
      var r = data[uid];
      var types = (r && r.types) ? Object.keys(r.types).map(function (k) { return r.types[k]; }) : [];
      var ts = types.map(function (k) { return KEY_TO_T[k]; }).filter(Boolean);
      if (!ts.length) return;
      total += 1;
      var isMixed = ts.length > 1;
      if (isMixed) mixed += 1;
      ts.forEach(function (t) { buckets[t].push({ id: uid + ':' + t, mixed: isMixed }); });
    });

    $('statTotal').innerHTML = total + '<small>명</small>';
    $('statMixed').innerHTML = mixed + '<small>명</small>';

    var maxCount = Math.max(buckets.E.length, buckets.O.length, buckets.K.length, buckets.S.length);
    var size = maxCount <= 20 ? 30 : maxCount <= 40 ? 24 : 18;
    var nextSeen = {};
    ORDER.forEach(function (t) {
      $('cnt-' + t).innerHTML = buckets[t].length + '<small> 명</small>';
      var box = $('ppl-' + t);
      box.innerHTML = '';
      box.setAttribute('aria-label', T[t].name + ' ' + buckets[t].length + '명');
      // 단일 유형을 먼저, 복합형을 뒤에
      buckets[t].sort(function (a, b) { return (a.mixed ? 1 : 0) - (b.mixed ? 1 : 0); }).forEach(function (p) {
        box.appendChild(personSvg(T[t].color, p.mixed, size, !initial && !seen[p.id]));
        nextSeen[p.id] = true;
      });
    });
    seen = nextSeen;
  }

  /* ---------- 모달 ---------- */
  var modalOk = null;
  function openModal(opts) {
    $('modalTitle').textContent = opts.title;
    var body = $('modalBody');
    body.innerHTML = '';
    if (opts.body) body.appendChild(opts.body);
    var ok = $('modalOk');
    ok.textContent = opts.okLabel;
    ok.className = 'btn-sm ' + (opts.danger ? 'danger' : 'accent');
    ok.disabled = false;
    modalOk = opts.onOk;
    $('modal').hidden = false;
    var f = body.querySelector('input') || ok;
    setTimeout(function () { f.focus(); }, 30);
  }
  function closeModal() { $('modal').hidden = true; modalOk = null; }
  $('modalCancel').addEventListener('click', closeModal);
  $('modal').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
  $('modalOk').addEventListener('click', function () {
    if (!modalOk) return;
    var btn = this;
    btn.disabled = true;
    Promise.resolve(modalOk()).then(function (keepOpen) {
      if (!keepOpen) closeModal();
    }).catch(function () {
      toast('처리하지 못했어요. 잠시 후 다시 시도해 주세요');
    }).then(function () { btn.disabled = false; });
  });

  /* ---------- 새 반 ---------- */
  function randomCode() {
    var s = '';
    var arr = new Uint32Array(4);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    for (var i = 0; i < 4; i++) s += CODE_CHARS[arr[i] % CODE_CHARS.length];
    return s;
  }

  function uniqueCode(tries) {
    var code = randomCode();
    return db.ref('classes/' + code).once('value').then(function (s) {
      if (!s.exists()) return code;
      if (tries <= 0) throw new Error('code');
      return uniqueCode(tries - 1);
    });
  }

  $('newClassBtn').addEventListener('click', function () {
    var wrap = el('div');
    var lb = el('label', null, '반 이름');
    lb.setAttribute('for', 'newTitle');
    var inp = el('input');
    inp.id = 'newTitle';
    inp.maxLength = 40;
    inp.placeholder = '예: 10/28 A사 팀장 1차';
    wrap.appendChild(lb);
    wrap.appendChild(inp);
    var tip = el('p', null, '반을 만들면 교육생 접속용 QR과 반 코드가 바로 생겨요.');
    tip.style.marginTop = '10px';
    tip.style.fontSize = '13px';
    wrap.appendChild(tip);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('modalOk').click(); } });
    openModal({
      title: '새 반 만들기',
      body: wrap,
      okLabel: '만들기',
      onOk: function () {
        var title = inp.value.replace(/\s+/g, ' ').trim();
        if (!title) { inp.focus(); toast('반 이름을 입력해 주세요'); return true; }
        return uniqueCode(5).then(function (code) {
          return db.ref('classes/' + code).set({ title: title, createdAt: firebase.database.ServerValue.TIMESTAMP }).then(function () {
            current = code;
            try { localStorage.setItem(PICK_KEY, code); } catch (e) {}
            renderSelect();
            toast('‘' + title + '’ 반을 만들었어요');
            setTimeout(openQr, 300);
          });
        });
      }
    });
  });

  /* ---------- 초기화·삭제 ---------- */
  function currentTitle() {
    var c = classes.filter(function (x) { return x.code === current; })[0];
    return c ? c.title : current;
  }

  $('resetBtn').addEventListener('click', function () {
    if (!current) return;
    openModal({
      title: '현황 초기화',
      body: el('p', null, '‘' + currentTitle() + '’ 반의 응답을 모두 지워요. 반과 QR은 그대로 남아요. 지운 응답은 되돌릴 수 없어요.'),
      okLabel: '응답 지우기',
      danger: true,
      onOk: function () {
        return db.ref('responses/' + current).remove().then(function () { toast('응답을 모두 지웠어요'); });
      }
    });
  });

  $('deleteBtn').addEventListener('click', function () {
    if (!current) return;
    openModal({
      title: '반 삭제',
      body: el('p', null, '‘' + currentTitle() + '’ 반과 응답을 모두 삭제해요. 이 반의 QR로는 더 이상 집계되지 않아요. 되돌릴 수 없어요.'),
      okLabel: '반 삭제',
      danger: true,
      onOk: function () {
        var code = current;
        var up = {};
        up['classes/' + code] = null;
        up['responses/' + code] = null;
        current = null;
        return db.ref().update(up).then(function () {
          try { localStorage.removeItem(PICK_KEY); } catch (e) {}
          toast('반을 삭제했어요');
        });
      }
    });
  });

  /* ---------- QR·링크·전체 화면 ---------- */
  function openQr() {
    if (!current) return;
    var url = joinUrl(current);
    $('qrBig').innerHTML = qrSvg(url);
    $('qrBigTitle').textContent = currentTitle();
    $('qrBigCode').textContent = current;
    $('qrBigUrl').textContent = url;
    $('qrModal').hidden = false;
    $('qrClose').focus();
  }
  function closeQr() { $('qrModal').hidden = true; }
  $('qrBigBtn').addEventListener('click', openQr);
  $('qrSmall').addEventListener('click', openQr);
  $('qrClose').addEventListener('click', closeQr);
  $('qrModal').addEventListener('click', function (e) { if (e.target === this) closeQr(); });

  $('copyBtn').addEventListener('click', function () {
    if (!current) return;
    var url = joinUrl(current);
    var done = function () { toast('접속 링크를 복사했어요'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url) ? done() : toast(url); });
    } else {
      fallbackCopy(url) ? done() : toast(url);
    }
  });
  function fallbackCopy(text) {
    var ta = el('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    return ok;
  }

  $('fsBtn').addEventListener('click', function () {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    var r = document.documentElement;
    if (r.requestFullscreen) r.requestFullscreen().catch(function () { toast('이 브라우저에서는 전체 화면을 쓸 수 없어요'); });
  });
  document.addEventListener('fullscreenchange', function () {
    $('fsBtn').textContent = document.fullscreenElement ? '전체 화면 끝내기' : '전체 화면';
  });

  $('logoutBtn').addEventListener('click', function () {
    if (respRef) { respRef.off(); respRef = null; }
    db.ref('classes').off();
    db.ref('.info/connected').off();
    boardStarted = false;
    current = null;
    auth.signOut();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!$('qrModal').hidden) closeQr();
      if (!$('modal').hidden) closeModal();
    }
  });
})();
