(function () {
  'use strict';

  var Q = window.QUESTIONS, T = window.TYPES, ORDER = window.TYPE_ORDER;
  var TOTAL = Q.length;
  var STORE_KEY = 'crt-progress-v1';

  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  var state = { name: '', idx: 0, answers: {}, done: false, activeTab: null, result: null };
  var classCode = null;
  var classTitle = '';
  var db = null, auth = null;
  var userReady = null;      // 익명 로그인 완료 Promise
  var busy = false;          // 응답 직후 자동 넘김 중복 방지

  /* ---------- 저장(새로고침 대비) ---------- */
  function save() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify({ name: state.name, idx: state.idx, answers: state.answers, done: state.done, code: classCode })); } catch (e) {}
  }
  function load() {
    try { return JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; }
  }
  function clearSaved() { try { sessionStorage.removeItem(STORE_KEY); } catch (e) {} }

  /* ---------- 토스트 ---------- */
  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 2600);
  }

  /* ---------- Firebase (반 코드가 있을 때만) ---------- */
  function readClassCode() {
    var m = /[?&]c=([A-Za-z0-9]{4,8})/.exec(location.search);
    return m ? m[1].toUpperCase() : null;
  }

  function initFirebase() {
    var code = readClassCode();
    if (!code || !window.firebase || !window.APP_CONFIG) return;
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.APP_CONFIG.firebase);
      db = firebase.database();
      auth = firebase.auth();
    } catch (e) { return; }
    userReady = new Promise(function (resolve) {
      var unsub = auth.onAuthStateChanged(function (u) {
        if (u) { unsub(); resolve(u); }
      });
      if (!auth.currentUser) {
        auth.signInAnonymously().catch(function () { resolve(null); });
      }
    });
    db.ref('classes/' + code).once('value').then(function (snap) {
      var v = snap.val();
      if (v) {
        classCode = code;
        classTitle = v.title || '';
        if (classTitle) {
          $('classTitle').textContent = classTitle;
          $('classChip').hidden = false;
        }
        if (state.done && state.result) submitResult(state.result);
      }
    }).catch(function () { /* 연결 실패 시 개인 진단으로 진행 */ });
  }

  var submitted = false;
  function submitResult(res) {
    if (!classCode || !db || submitted) return;
    submitted = true;
    var payload = {
      types: res.top.map(function (t) { return T[t].key; }),
      scores: { E: res.scores.E, O: res.scores.O, K: res.scores.K, S: res.scores.S },
      at: firebase.database.ServerValue.TIMESTAMP
    };
    (userReady || Promise.resolve(null)).then(function (u) {
      if (!u) { submitted = false; return; }
      return db.ref('responses/' + classCode + '/' + u.uid).set(payload).then(function () {
        var j = document.querySelector('.joined');
        if (j) j.hidden = false;
      });
    }).catch(function () { submitted = false; });
  }

  /* ---------- 화면 전환 ---------- */
  function show(id) {
    ['start', 'quiz', 'result'].forEach(function (s) { $(s).hidden = s !== id; });
    window.scrollTo(0, 0);
  }

  /* ---------- 진단 ---------- */
  function buildOptions() {
    var box = $('options');
    box.innerHTML = '';
    window.SCALE.forEach(function (label, i) {
      var b = el('button', 'opt');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.dataset.v = String(i + 1);
      var n = el('span', 'num', String(i + 1));
      n.setAttribute('aria-hidden', 'true');
      b.appendChild(n);
      b.appendChild(document.createTextNode(label));
      b.addEventListener('click', function () { choose(i + 1); });
      box.appendChild(b);
    });
  }

  function renderQuestion(dir) {
    var q = Q[state.idx];
    var wrap = $('qWrap');
    var apply = function () {
      $('qIndex').textContent = String(state.idx + 1);
      $('qNum').textContent = 'Q ' + (q.n < 10 ? '0' + q.n : q.n);
      $('qText').textContent = q.text;
      $('progressFill').style.width = (state.idx / TOTAL * 100) + '%';
      var cur = state.answers[q.n];
      Array.prototype.forEach.call($('options').children, function (b) {
        b.setAttribute('aria-checked', String(Number(b.dataset.v) === cur));
      });
    };
    if (!dir) { apply(); return; }
    wrap.classList.add('out');
    setTimeout(function () {
      apply();
      wrap.classList.remove('out');
      wrap.classList.add('in-start');
      void wrap.offsetWidth;
      wrap.classList.remove('in-start');
    }, 160);
  }

  function choose(v) {
    if (busy) return;
    var q = Q[state.idx];
    state.answers[q.n] = v;
    Array.prototype.forEach.call($('options').children, function (b) {
      b.setAttribute('aria-checked', String(Number(b.dataset.v) === v));
    });
    busy = true;
    setTimeout(function () {
      busy = false;
      if (state.idx < TOTAL - 1) {
        state.idx += 1;
        save();
        renderQuestion(1);
      } else {
        finish();
      }
    }, 230);
  }

  function goBack() {
    if (busy) return;
    if (state.idx > 0) {
      state.idx -= 1;
      save();
      renderQuestion(-1);
    } else {
      show('start');
    }
  }

  function finish() {
    for (var i = 1; i <= TOTAL; i++) {
      if (!state.answers[i]) { state.idx = i - 1; renderQuestion(); toast(i + '번 문항에 응답해 주세요'); return; }
    }
    $('progressFill').style.width = '100%';
    state.done = true;
    state.result = window.scoreAnswers(state.answers);
    save();
    renderResult(state.result);
    show('result');
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(document.querySelectorAll('.bar i'), function (b) { b.style.width = b.dataset.w; });
    });
    submitResult(state.result);
  }

  /* ---------- 결과 ---------- */
  function bulletList(items) {
    var ul = el('ul', 'bullets');
    items.forEach(function (t) { ul.appendChild(el('li', null, t)); });
    return ul;
  }

  function buildDetail(t, opts) {
    // t: 유형 키(E/O/K/S) → 해설 블록 묶음
    var d = T[t];
    var frag = el('div', 'pane');
    frag.style.setProperty('--t-color', d.color);
    frag.style.setProperty('--t-ink', d.ink);
    if (opts && opts.paneTitle) {
      var pt = el('p', 'pane-title cap-only', d.name + ' 해설');
      pt.style.background = d.tint;
      pt.style.color = d.ink;
      pt.setAttribute('data-cap', '');
      frag.appendChild(pt);
    }
    var fs = el('div', 'fs-card');
    fs.setAttribute('data-cap', '');
    fs.appendChild(el('p', 'sec-label', '특징과 강점'));
    [['특징', d.feature], ['강점', d.strength]].forEach(function (r) {
      var row = el('div', 'fs-row');
      row.appendChild(el('b', null, r[0]));
      row.appendChild(el('p', null, r[1]));
      fs.appendChild(row);
    });
    frag.appendChild(fs);
    [['변화 앞에서 자주 보이는 모습', d.looks], ['이런 점은 주의해요', d.cautions], ['이 유형과 함께 일할 때', d.together]].forEach(function (b) {
      var sec = el('section', 'block');
      sec.setAttribute('data-cap', '');
      sec.appendChild(el('h2', null, b[0]));
      sec.appendChild(bulletList(b[1]));
      frag.appendChild(sec);
    });
    var acts = el('section', 'acts');
    acts.setAttribute('data-cap', '');
    var head = el('div', 'acts-head');
    head.appendChild(el('h2', null, '변화에 잘 대응하기 위한 추천 활동'));
    head.appendChild(el('p', null, '현업과 일상에서 바로 해볼 수 있어요'));
    acts.appendChild(head);
    d.actions.forEach(function (a, i) {
      var c = el('div', 'act');
      c.appendChild(el('span', 'n', String(i + 1)));
      var tx = el('div');
      tx.appendChild(el('h3', null, a.title));
      tx.appendChild(el('p', null, a.body));
      c.appendChild(tx);
      acts.appendChild(c);
    });
    frag.appendChild(acts);
    return frag;
  }

  function renderResult(res) {
    var top = res.top;
    var multi = top.length > 1;
    var hero = $('hero');
    hero.innerHTML = '';
    var lead = T[top[0]];
    hero.style.setProperty('--hero-tint', multi ? '#F6F8FB' : lead.tint);
    hero.style.setProperty('--hero-ink', multi ? '#36415A' : lead.ink);

    hero.appendChild(el('p', 'hero-greet', (state.name ? state.name + ' 님' : '당신') + '의 변화 대응 유형은'));

    var imgs = el('div', 'hero-imgs' + (top.length === 2 ? ' two' : top.length > 2 ? ' many' : ''));
    top.forEach(function (t) {
      var im = el('img');
      im.src = T[t].img;
      im.alt = T[t].name + ' 유형 이미지';
      im.width = 219; im.height = 277;
      imgs.appendChild(im);
    });
    hero.appendChild(imgs);

    var nm = el('div', 'hero-name');
    if (!multi) {
      nm.appendChild(el('h1', null, lead.name));
      nm.appendChild(el('p', null, lead.en));
    } else if (top.length === 2) {
      nm.appendChild(el('h1', null, T[top[0]].short + ' + ' + T[top[1]].short));
      nm.appendChild(el('p', null, '복합형'));
    } else {
      nm.appendChild(el('h1', null, '균형형'));
      nm.appendChild(el('p', null, top.map(function (t) { return T[t].short; }).join(' · ')));
    }
    hero.appendChild(nm);

    var line = !multi ? lead.line : top.length === 2 ? window.COMBOS[top.join('')] : window.BALANCED_LINE;
    hero.appendChild(el('p', 'hero-line', line));

    var kw = el('div', 'keywords');
    if (!multi) {
      lead.keywords.forEach(function (k) { kw.appendChild(el('span', null, '#' + k)); });
    } else {
      top.forEach(function (t) {
        var s = el('span', null, T[t].name);
        s.style.color = T[t].ink;
        kw.appendChild(s);
      });
    }
    hero.appendChild(kw);

    if (classCode) {
      var j = el('p', 'joined no-cap', '우리 반 현황에 반영됐어요');
      j.hidden = !submitted;
      hero.appendChild(j);
    }

    // 점수
    var sc = $('scores');
    sc.innerHTML = '';
    sc.appendChild(el('p', 'sec-label', '나의 유형 점수'));
    ORDER.forEach(function (t) {
      var row = el('div', 'score-row' + (top.indexOf(t) >= 0 ? ' is-top' : ''));
      var tp = el('div', 'score-top');
      tp.appendChild(el('span', null, T[t].name));
      var v = el('span', 'val', String(res.scores[t]));
      v.appendChild(el('small', null, ' / 25'));
      tp.appendChild(v);
      row.appendChild(tp);
      var bar = el('div', 'bar');
      var fill = el('i');
      fill.style.background = T[t].color;
      fill.dataset.w = (res.scores[t] / 25 * 100) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);
      sc.appendChild(row);
    });
    sc.appendChild(el('p', 'score-note', '유형별 5문항 합계 · 최저 5점, 최고 25점'));

    // 탭 + 해설
    var tabs = $('tabs');
    var detail = $('detail');
    tabs.innerHTML = '';
    detail.innerHTML = '';
    state.activeTab = top[0];
    top.forEach(function (t) {
      var pane = buildDetail(t, { paneTitle: multi });
      pane.dataset.t = t;
      if (t !== state.activeTab) pane.classList.add('is-hidden');
      detail.appendChild(pane);
    });
    tabs.hidden = !multi;
    if (multi) {
      top.forEach(function (t) {
        var b = el('button', 'tab');
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(t === state.activeTab));
        var dot = el('span', 'dot');
        dot.style.background = T[t].color;
        b.appendChild(dot);
        b.appendChild(document.createTextNode(top.length > 2 ? T[t].short : T[t].name));
        b.addEventListener('click', function () { selectTab(t); });
        tabs.appendChild(b);
      });
    }

    // 다른 유형
    var others = $('others');
    others.innerHTML = '';
    var rest = ORDER.filter(function (t) { return top.indexOf(t) < 0; });
    if (rest.length) {
      others.hidden = false;
      others.appendChild(el('p', 'sec-label', '다른 유형 둘러보기'));
      rest.forEach(function (t) {
        var b = el('button', 'other-btn');
        b.type = 'button';
        var dot = el('span', 'dot');
        dot.style.background = T[t].color;
        b.appendChild(dot);
        var tx = el('span', 'txt');
        tx.appendChild(el('b', null, T[t].name));
        tx.appendChild(el('span', null, T[t].feature));
        b.appendChild(tx);
        b.insertAdjacentHTML('beforeend', '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8C95A8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>');
        b.addEventListener('click', function () { openSheet(t); });
        others.appendChild(b);
      });
    } else {
      others.hidden = true;
    }
  }

  function selectTab(t) {
    state.activeTab = t;
    Array.prototype.forEach.call($('tabs').children, function (b, i) {
      b.setAttribute('aria-selected', String(state.result.top[i] === t));
    });
    Array.prototype.forEach.call($('detail').children, function (p) {
      p.classList.toggle('is-hidden', p.dataset.t !== t);
    });
  }

  /* ---------- 다른 유형 시트 ---------- */
  var lastFocus = null;
  function openSheet(t) {
    var d = T[t];
    var ov = $('sheet');
    ov.innerHTML = '';
    var sh = el('div', 'sheet');
    sh.setAttribute('role', 'dialog');
    sh.setAttribute('aria-modal', 'true');
    sh.setAttribute('aria-label', d.name + ' 해설');
    var head = el('div', 'sheet-head');
    var im = el('img');
    im.src = d.img; im.alt = '';
    head.appendChild(im);
    var tt = el('div', 't');
    tt.appendChild(el('b', null, d.name));
    var en = el('span', null, d.en);
    en.style.color = d.ink;
    tt.appendChild(en);
    head.appendChild(tt);
    var cb = el('button', 'close-btn');
    cb.type = 'button';
    cb.setAttribute('aria-label', '닫기');
    cb.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
    cb.addEventListener('click', closeSheet);
    head.appendChild(cb);
    sh.appendChild(head);
    sh.appendChild(el('p', 'sheet-line', d.line));
    sh.appendChild(buildDetail(t));
    ov.appendChild(sh);
    lastFocus = document.activeElement;
    ov.hidden = false;
    document.body.style.overflow = 'hidden';
    cb.focus();
  }
  function closeSheet() {
    $('sheet').hidden = true;
    $('sheet').innerHTML = '';
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }
  $('sheet').addEventListener('click', function (e) { if (e.target === this) closeSheet(); });

  /* ---------- 이미지·PDF 저장 ---------- */
  var libs = {};
  function loadScript(src) {
    if (libs[src]) return libs[src];
    libs[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { delete libs[src]; reject(new Error('load')); };
      document.head.appendChild(s);
    });
    return libs[src];
  }

  function fileBase() {
    var n = (state.name || '').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 20);
    return '변화대응유형' + (n ? '_' + n : '');
  }

  function waitImages(root) {
    var imgs = root.querySelectorAll('img');
    return Promise.all(Array.prototype.map.call(imgs, function (im) {
      if (im.complete) return Promise.resolve();
      return new Promise(function (r) { im.onload = im.onerror = r; });
    }));
  }

  function snap(node) {
    return window.html2canvas(node, { scale: 2, backgroundColor: '#FFFFFF', useCORS: true, logging: false });
  }

  function withCapture(fn, wide) {
    document.body.classList.add('capturing');
    if (wide) document.body.classList.add('pdf-wide');
    var done = function () { document.body.classList.remove('capturing', 'pdf-wide'); };
    return Promise.resolve()
      .then(function () { return document.fonts && document.fonts.ready; })
      .then(function () { return waitImages($('capture')); })
      .then(fn)
      .then(function (r) { done(); return r; }, function (e) { done(); throw e; });
  }

  function isTouch() { return window.matchMedia && window.matchMedia('(pointer: coarse)').matches; }

  function deliver(blob, filename) {
    var file = null;
    try { file = new File([blob], filename, { type: blob.type }); } catch (e) {}
    if (file && isTouch() && navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: filename }).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        download(blob, filename);
      });
    }
    download(blob, filename);
    return Promise.resolve();
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }

  function setBusy(btn, on, label) {
    btn.disabled = on;
    if (on) { btn.dataset.label = btn.lastChild.textContent; btn.lastChild.textContent = label; }
    else if (btn.dataset.label) { btn.lastChild.textContent = btn.dataset.label; }
  }

  $('saveImg').addEventListener('click', function () {
    var btn = this;
    setBusy(btn, true, ' 만드는 중…');
    loadScript('vendor/html2canvas.min.js')
      .then(function () { return withCapture(function () { return snap($('capture')); }); })
      .then(function (canvas) {
        return new Promise(function (r) { canvas.toBlob(function (b) { r({ blob: b, url: canvas.toDataURL('image/png') }); }, 'image/png'); });
      })
      .then(function (out) { openImageOverlay(out.blob, out.url); })
      .catch(function () { toast('이미지를 만들지 못했어요. 잠시 후 다시 시도해 주세요'); })
      .then(function () { setBusy(btn, false); });
  });

  function openImageOverlay(blob, dataUrl) {
    var ov = $('imgOverlay');
    ov.innerHTML = '';
    var box = el('div', 'img-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', '결과 이미지 저장');
    var pv = el('div', 'preview');
    var im = el('img');
    im.src = dataUrl;
    im.alt = '진단 결과 이미지';
    pv.appendChild(im);
    box.appendChild(pv);
    box.appendChild(el('p', null, isTouch() ? '이미지를 길게 눌러 사진에 저장하거나, 아래 버튼을 눌러 저장하세요.' : '아래 버튼을 눌러 이미지를 내려받으세요.'));
    var acts = el('div', 'img-actions');
    var sv = el('button', 'btn-save solid', '저장하기');
    sv.type = 'button';
    sv.addEventListener('click', function () { deliver(blob, fileBase() + '.png'); });
    var cl = el('button', 'btn-save line', '닫기');
    cl.type = 'button';
    cl.addEventListener('click', closeImg);
    acts.appendChild(sv);
    acts.appendChild(cl);
    box.appendChild(acts);
    ov.appendChild(box);
    ov.hidden = false;
    document.body.style.overflow = 'hidden';
    sv.focus();
  }
  function closeImg() {
    $('imgOverlay').hidden = true;
    $('imgOverlay').innerHTML = '';
    document.body.style.overflow = '';
  }
  $('imgOverlay').addEventListener('click', function (e) { if (e.target === this) closeImg(); });

  $('savePdf').addEventListener('click', function () {
    var btn = this;
    setBusy(btn, true, ' 만드는 중…');
    Promise.all([loadScript('vendor/html2canvas.min.js'), loadScript('vendor/jspdf.umd.min.js')])
      .then(function () {
        return withCapture(function () {
          var blocks = Array.prototype.filter.call($('capture').querySelectorAll('[data-cap]'), function (n) { return n.offsetHeight > 0; });
          var shots = [];
          return blocks.reduce(function (p, n) {
            return p.then(function () { return snap(n).then(function (c) { shots.push(c); }); });
          }, Promise.resolve()).then(function () { return shots; });
        }, true);
      })
      .then(function (shots) {
        var jsPDF = window.jspdf.jsPDF;
        var doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        var pageW = 210, pageH = 297, margin = 14;
        var w = pageW - margin * 2;
        var y = margin;
        shots.forEach(function (c, i) {
          var h = c.height * w / c.width;
          var drawW = w, drawH = h;
          if (h > pageH - margin * 2) { drawH = pageH - margin * 2; drawW = c.width * drawH / c.height; }
          if (y + drawH > pageH - margin && y > margin) { doc.addPage(); y = margin; }
          doc.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', margin + (w - drawW) / 2, y, drawW, drawH);
          y += drawH + (i === 0 ? 0 : 2);
        });
        return deliver(doc.output('blob'), fileBase() + '.pdf');
      })
      .catch(function () { toast('PDF를 만들지 못했어요. 잠시 후 다시 시도해 주세요'); })
      .then(function () { setBusy(btn, false); });
  });

  /* ---------- 이벤트 ---------- */
  $('startForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('nickname').value.replace(/\s+/g, ' ').trim().slice(0, 20);
    state.name = v;
    state.idx = 0;
    state.answers = {};
    state.done = false;
    save();
    renderQuestion();
    show('quiz');
    try { history.pushState({ s: 'quiz' }, ''); } catch (err) {}
  });

  $('backBtn').addEventListener('click', goBack);

  window.addEventListener('popstate', function () {
    if (!$('quiz').hidden) {
      goBack();
      if (!$('quiz').hidden) { try { history.pushState({ s: 'quiz' }, ''); } catch (err) {} }
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!$('sheet').hidden) closeSheet();
      if (!$('imgOverlay').hidden) closeImg();
      return;
    }
    if ($('quiz').hidden || e.altKey || e.ctrlKey || e.metaKey) return;
    if (/^[1-5]$/.test(e.key)) { choose(Number(e.key)); }
    else if (e.key === 'Backspace' || e.key === 'ArrowLeft') { goBack(); }
  });

  $('restartBtn').addEventListener('click', function () {
    clearSaved();
    submitted = false;
    state = { name: state.name, idx: 0, answers: {}, done: false, activeTab: null, result: null };
    $('nickname').value = state.name;
    show('start');
  });

  /* ---------- 시작 ---------- */
  buildOptions();
  initFirebase();

  var saved = load();
  if (saved && saved.answers && (!saved.code || saved.code === readClassCode())) {
    state.name = saved.name || '';
    state.answers = saved.answers;
    state.idx = Math.min(saved.idx || 0, TOTAL - 1);
    $('nickname').value = state.name;
    if (saved.done && Object.keys(saved.answers).length === TOTAL) {
      state.done = true;
      state.result = window.scoreAnswers(state.answers);
      renderResult(state.result);
      show('result');
      Array.prototype.forEach.call(document.querySelectorAll('.bar i'), function (b) { b.style.width = b.dataset.w; });
    } else if (Object.keys(saved.answers).length > 0) {
      renderQuestion();
      show('quiz');
    }
  }
})();
