/* 错题站 · 应用逻辑
 * 依赖：MiniZip（js/zip.js）、DB（js/DataStore.js）、SEED（js/seed.js）
 */
(function () {
  'use strict';

  // ======================= 常量 =======================
  var SUBJECTS = [
    '数学 AA', '数学 AI', '物理', '化学', '生物',
    '经济', '商业管理', '历史', '地理', '哲学',
    '中文 A', '英语 A', '英语 B', 'TOK', '其他'
  ];

  function subjectClass(subject) {
    var s = String(subject || '');
    if (/化学/.test(s)) return 's-chem';
    if (/物理/.test(s)) return 's-phys';
    if (/数学/.test(s)) return 's-math';
    if (/生物/.test(s)) return 's-bio';
    if (/计算机/.test(s)) return 's-cs';
    if (/经济|商业|心理|历史|地理|政治|哲学|环境|TOK|EE/.test(s)) return 's-hum';
    if (/艺术|音乐|戏剧/.test(s)) return 's-art';
    if (/中文|英语|法语|西班牙语|语言/.test(s)) return 's-lang';
    return 's-other';
  }
  var CAUSES = [
    { k: 'K', label: 'K 知识' },
    { k: 'M', label: 'M 方法' },
    { k: 'C', label: 'C 计算' },
    { k: 'E', label: 'E 表达/审题' }
  ];
  var STATUSES = [
    { k: 'new', label: '未掌握' },
    { k: 'reviewing', label: '复习中' },
    { k: 'mastered', label: '已掌握' }
  ];

  // ======================= 状态 =======================
  var DataStore = null; // 离线 = IndexedDB，云端 = Cloud.store

  var state = {
    items: [],
    topics: [],
    inbox: [],
    submissions: [],
    progress: {},
    answerImages: {},
    cloud: false,
    me: null,
    tab: 'items',
    groupMode: false,
    filters: { subject: '', topic: '', cause: '', status: '', q: '' },
    editing: null,
    editingTopic: null,
    review: { queue: [], idx: 0, revealed: false, done: 0, again: 0 },
    imageUrls: {}
  };

  // ======================= 工具 =======================
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function uid() { return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function toast(msg, type) {
    var el = $('#toast');
    el.textContent = msg;
    el.className = 'toast ' + (type || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.className = 'toast hidden'; }, 2400);
  }
  function byId(arr, key, val) {
    for (var i = 0; i < arr.length; i++) if (arr[i][key] === val) return arr[i];
    return null;
  }
  function statusLabel(k) {
    var s = byId(STATUSES, 'k', k);
    return s ? s.label : (k || '');
  }
  function causeLabel(k) {
    var c = byId(CAUSES, 'k', k);
    return c ? c.label : k;
  }
  function topicById(id) { return byId(state.topics, 'id', id); }  // ---------- 每账号独立的题目进度（状态/复习计划） ----------
  function progressOf(itemId) {
    var p = state.progress[itemId];
    if (!p) return null;
    if (state.cloud && state.me && p.ownerId && p.ownerId !== state.me.id) return null;
    return p;
  }
  function statusOf(itemId) {
    var p = progressOf(itemId);
    return (p && p.status) || 'new';
  }
  function reviewOf(itemId) {
    var p = progressOf(itemId);
    return (p && p.review) || { due: '', interval: 0, ease: 2.5, reps: 0 };
  }
  function saveProgress(itemId, patch) {
    var p = progressOf(itemId);
    if (!p) {
      p = {
        id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        itemId: itemId,
        status: 'new',
        review: { due: todayISO(), interval: 0, ease: 2.5, reps: 0 }
      };
    }
    Object.assign(p, patch || {});
    p.updatedAt = new Date().toISOString();
    state.progress[itemId] = p;
    return DataStore.put('progress', p).then(function (saved) {
      if (saved && saved.id) state.progress[itemId] = saved;
      return saved;
    }).catch(function (e) {
      console.warn('进度保存失败', e);
      return p;
    });
  }

  // ---------- 数学公式渲染（LaTeX 子集，自研解析） ----------
  var MATH_GREEK = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', epsilon: 'ε',
    theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', Sigma: 'Σ',
    tau: 'τ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Omega: 'Ω'
  };
  var MATH_SYMBOLS = {
    times: '×', div: '÷', cdot: '·', pm: '±', mp: '∓', le: '≤', leq: '≤',
    ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡',
    to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒',
    infty: '∞', degree: '°', angle: '∠', triangle: '△', sum: '∑', int: '∫',
    propto: '∝', perp: '⊥', parallel: '∥', sin: 'sin', cos: 'cos', tan: 'tan',
    log: 'log', ln: 'ln', lim: 'lim'
  };

  function readBraceGroup(s, i) {
    if (s[i] !== '{') return null;
    var depth = 0;
    for (var j = i; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') {
        depth--;
        if (depth === 0) return { content: s.slice(i + 1, j), end: j + 1 };
      }
    }
    return null;
  }

  // 把 \frac{a}{b}（含嵌套、允许漏写反斜杠）转成 HTML 分数
  function convertFracs(s) {
    var guard = 0;
    while (guard++ < 200) {
      var re = /\\?[dt]?frac\s*\{/g;
      var m;
      var hit = null;
      while ((m = re.exec(s))) {
        var bracePos = m.index + m[0].length - 1;
        var g1 = readBraceGroup(s, bracePos);
        if (!g1) continue;
        var g2 = readBraceGroup(s, g1.end);
        if (!g2) continue;
        hit = { start: m.index, end: g2.end, num: g1.content, den: g2.content };
        break;
      }
      if (!hit) break;
      s = s.slice(0, hit.start) +
        '<span class="frac"><span class="num">' + hit.num + '</span><span class="den">' + hit.den + '</span></span>' +
        s.slice(hit.end);
    }
    return s;
  }

  function convertSqrt(s) {
    var guard = 0;
    while (guard++ < 100) {
      var m = /\\sqrt\s*\{/.exec(s);
      if (!m) break;
      var bracePos = m.index + m[0].length - 1;
      var g = readBraceGroup(s, bracePos);
      if (!g) break;
      s = s.slice(0, m.index) +
        '<span class="sqrt">√<span class="radicand">' + g.content + '</span></span>' +
        s.slice(g.end);
    }
    return s;
  }

  function latexToHTML(src) {
    var s = String(src || '');
    s = convertFracs(s);
    s = convertSqrt(s);
    s = s.replace(/\^\{([^{}]*)\}/g, '<sup>$1</sup>');
    s = s.replace(/\^([0-9a-zA-Z+\-])/g, '<sup>$1</sup>');
    s = s.replace(/_\{([^{}]*)\}/g, '<sub>$1</sub>');
    s = s.replace(/_([0-9a-zA-Z+\-])/g, '<sub>$1</sub>');
    // 斜杠分数 → 竖式分数（如 -4r/5、3/5、r/3；跳过日期和网址）
    s = s.replace(/(^|[\s(（=+\-−×·,，;；:：])(-?)(\d*[A-Za-z]?[A-Za-z0-9]*)\s*\/\s*(\d+|[A-Za-z])(?=$|[\s)）+\-−×·,，;；。.!?]|$)/g, function (m, pre, sign, num, den) {
      if (/^\d{4}$/.test(num) && /^\d{1,2}$/.test(den)) return m;
      if (!num) return m;
      return pre + '<span class="frac"><span class="num">' + sign + num + '</span><span class="den">' + den + '</span></span>';
    });
    s = s.replace(/\\([a-zA-Z]+)/g, function (m, name) {
      if (MATH_SYMBOLS[name]) return MATH_SYMBOLS[name];
      if (MATH_GREEK[name]) return MATH_GREEK[name];
      return name;
    });
    s = s.replace(/\\left|\\right|\\big[glr]?|\\Big[glr]?|\\displaystyle/g, '');
    s = s.replace(/\\\\/g, ' ');
    s = s.replace(/\\([{}%$&_#])/g, '$1');
    s = s.replace(/[ \t]+/g, ' ');
    s = s.replace(/\n/g, '<br>');
    return s.trim();
  }

  // 把文本里的 $...$ / $$...$$ 数学段渲染成公式，其余按普通文本
  function renderMathText(text) {
    var text0 = String(text == null ? '' : text).replace(/\r\n/g, '\n');
    var hasKatex = !!(typeof window !== 'undefined' && window.katex && typeof window.katex.renderToString === 'function');

    // 没有 $ 定界符（旧数据）：整段用自研渲染器（能同时处理中文和裸 LaTeX）
    if (text0.indexOf('$') < 0) {
      return '<span class="math-inline">' + latexToHTML(esc(text0)) + '</span>';
    }

    var out = '';
    var i = 0;
    while (i < text0.length) {
      var j = text0.indexOf('$', i);
      if (j < 0) { out += escPlain(text0.slice(i)); break; }
      out += escPlain(text0.slice(i, j));
      var display = text0[j + 1] === '$';
      var close = text0.indexOf(display ? '$$' : '$', j + (display ? 2 : 1));
      if (close < 0) { out += escPlain(text0.slice(j)); break; }
      var expr = text0.slice(j + (display ? 2 : 1), close);
      if (hasKatex) {
        try {
          out += window.katex.renderToString(expr, { throwOnError: false, displayMode: !!display, strict: false });
        } catch (e) {
          out += '<span class="math-inline">' + latexToHTML(esc(expr)) + '</span>';
        }
      } else {
        out += '<span class="math-inline">' + latexToHTML(esc(expr)) + '</span>';
      }
      i = close + (display ? 2 : 1);
    }
    return out;
  }

  function escPlain(txt) {
    var s = esc(String(txt))
      .replace(/\\\(/g, '').replace(/\\\)/g, '')
      .replace(/\r\n/g, '\n');
    // 题干被压成一段时，按选项自动断行（A (… B (… C (… D (…）
    if (s.indexOf('\n') < 0 && /\s[A-D]\s?\(/.test(s)) {
      s = s.replace(/\s+(?=[A-D]\s?\()/g, '\n');
    }
    return s.replace(/\n/g, '<br>');
  }

  function topicName(id) {
    var t = topicById(id);
    return t ? t.name : id;
  }
  function showBanner(msg) {
    var b = $('#storage-warn');
    b.textContent = msg;
    b.classList.remove('hidden');
  }

  // ======================= 图片 =======================
  function getImageUrl(id) {
    if (state.imageUrls[id]) return Promise.resolve(state.imageUrls[id]);
    return DataStore.get('images', id).then(function (rec) {
      if (!rec || !rec.blob) return null;
      var url = URL.createObjectURL(rec.blob);
      state.imageUrls[id] = url;
      return url;
    }).catch(function () { return null; });
  }
  function revokeImage(id) {
    if (state.imageUrls[id]) {
      URL.revokeObjectURL(state.imageUrls[id]);
      delete state.imageUrls[id];
    }
  }
  function hydrateImages(container) {
    $$('img[data-img]', container).forEach(function (img) {
      var id = img.getAttribute('data-img');
      getImageUrl(id).then(function (url) {
        if (!url) { img.removeAttribute('data-img'); return; }
        img.src = url;
      });
    });
  }
  function compressImage(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1500;
        var w = img.naturalWidth || 1200;
        var h = img.naturalHeight || 900;
        var scale = Math.min(1, max / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale));
        var ch = Math.max(1, Math.round(h * scale));
        var canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        if (canvas.toBlob) {
          canvas.toBlob(function (blob) { resolve(blob || file); }, 'image/jpeg', 0.82);
        } else {
          resolve(file);
        }
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  // ======================= 初始化 =======================
  function init() {
    fillStaticSelects();
    bindEvents();

    var cloud = (typeof Cloud !== 'undefined') ? Cloud : null;
    var detect = cloud ? cloud.detect() : Promise.resolve(false);

    detect.then(function (isCloud) {
      state.cloud = !!isCloud;
      if (!state.cloud) {
        DataStore = DB;
        $$('.cloud-only').forEach(function (el) { el.classList.add('hidden'); });
        checkStorage();
        return bootData();
      }
      return cloud.me().then(function (user) {
        state.me = user;
        DataStore = cloud.store;
        setupCloudUI();
        return bootData();
      }, function () {
        location.href = 'login.html';
      });
    }).catch(function (e) {
      console.error(e);
      showBanner('启动失败：' + (e && e.message ? e.message : e));
      renderCurrent();
    });
  }

  function bootData() {
    return DataStore.getAll('items').then(function (items) {
      return DataStore.getAll('topics').then(function (topics) {
        return DataStore.getAll('inbox').then(function (inbox) {
          return DataStore.getAll('submissions').then(function (subs) {
            return DataStore.getAll('progress').then(function (progress) {
              state.items = items || [];
              state.topics = topics || [];
              state.inbox = inbox || [];
              state.submissions = subs || [];
              state.progress = {};
              (progress || []).forEach(function (p) {
                if (!p || !p.itemId) return;
                var old = state.progress[p.itemId];
                if (!old || String(p.updatedAt || '') >= String(old.updatedAt || '')) state.progress[p.itemId] = p;
              });
              return state.cloud ? null : firstRun();
            });
          });
        });
      });
    }).then(function () {
      rebuildFilters();
      refreshReviewCounts();
      renderCurrent();
    }).catch(function (e) {
      console.error(e);
      showBanner('数据加载失败：' + (e && e.message ? e.message : e) + '（请使用 Chrome / Edge 打开）');
      renderCurrent();
    });
  }

  function setupCloudUI() {
    var area = $('#user-area');
    if (area) area.classList.remove('hidden');
    var nameEl = $('#user-name');
    if (nameEl && state.me) {
      nameEl.textContent = (state.me.displayName || state.me.username) +
        (state.me.role === 'admin' ? ' · 管理员' : '');
    }
    var up = $('#inbox-uploader');
    if (up) up.classList.add('hidden');
    var isAdmin = !!(state.me && state.me.role === 'admin');
    $$('.cloud-admin-only').forEach(function (el) { el.classList.toggle('hidden', !isAdmin); });
    $$('.cloud-hide').forEach(function (el) { el.classList.add('hidden'); });
    var st = $('#storage-status');
    if (st) {
      var extra = '';
      if (Cloud.health && Cloud.health.serverless) {
        extra = '（Vercel 模式：数据存储 ' + (Cloud.health.storage || '?') + '，图片 ' + (Cloud.health.blob || '?') + '）';
        if (Cloud.health.storage === 'memory') extra += ' ⚠️ 未连接 KV，数据会丢！';
      }
      st.textContent = '云端模式：数据保存在班级服务器，所有人共享题库。' + extra;
    }
    var banner = $('#storage-warn');
    if (banner) banner.classList.add('hidden');
  }

  function firstRun() {
    return DataStore.get('meta', 'seeded').then(function (m) {
      if (m) return;
      if (state.items.length || state.topics.length) {
        return DataStore.put('meta', { key: 'seeded', value: true });
      }
      return applySeed(true);
    });
  }

  function applySeed(silent) {
    var items = clone(SEED.items || []);
    var topics = clone(SEED.topics || []);
    var known = {};
    state.topics.forEach(function (t) { known[t.id] = true; });
    var newTopics = topics.filter(function (t) { return !known[t.id]; });
    state.topics = state.topics.concat(newTopics);
    var newItems = items.filter(function (it) { return !byId(state.items, 'id', it.id); });
    state.items = state.items.concat(newItems);
    return Promise.all([
      DataStore.putMany('topics', newTopics),
      DataStore.putMany('items', newItems),
      DataStore.put('meta', { key: 'seeded', value: true })
    ]).then(function () {
      if (!silent) toast('已载入示例：' + newItems.length + ' 道错题、' + newTopics.length + ' 个知识点', 'ok');
    });
  }

  function checkStorage() {
    if (!DataStore.available()) {
      showBanner('⚠ 当前浏览器不支持 IndexedDB，数据无法保存。请用 Edge / Chrome 打开；' +
        '若仍不行，请双击同目录下的「启动（本地服务）.cmd」，用 http://localhost:8765 打开。');
      var st = $('#storage-status');
      if (st) st.textContent = '不可用：浏览器不支持 IndexedDB';
      return;
    }
    DataStore.open().then(function () {
      $('#storage-status').textContent = '正常：IndexedDB 可用，数据保存在本机浏览器中。';
    }).catch(function (e) {
      showBanner('⚠ 数据库打开失败：' + (e && e.message ? e.message : e) +
        '。如果是从本地文件直接打开的，请改用同目录的「启动（本地服务）.cmd」。');
      $('#storage-status').textContent = '异常：' + (e && e.message ? e.message : e);
    });
  }

  // ======================= 选择框 =======================
  function optionHTML(value, label, selected) {
    return '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>';
  }

  function fillStaticSelects() {
    var subj = SUBJECTS.map(function (s) { return optionHTML(s, s); }).join('');
    ['#e-subject', '#t-subject', '#inbox-subject', '#f-subject', '#s-subject'].forEach(function (sel) {
      var el = $(sel);
      if (el && !el.options.length) el.innerHTML = subj;
    });
    var st = STATUSES.map(function (s) { return optionHTML(s.k, s.label); }).join('');
    var el = $('#e-status');
    if (el) el.innerHTML = st;
  }

  function rebuildFilters() {
    var f = state.filters;

    var subjSel = $('#f-subject');
    var cur = f.subject;
    subjSel.innerHTML = '<option value="">全部科目</option>' + SUBJECTS.map(function (s) {
      return optionHTML(s, s, s === cur);
    }).join('');
    f.subject = subjSel.value;
    if (f.subject !== cur) subjSel.value = cur;

    var topicSel = $('#f-topic');
    var tc = f.topic;
    topicSel.innerHTML = '<option value="">全部知识点</option>' + state.topics.map(function (t) {
      return optionHTML(t.id, t.subject + ' · ' + t.name, t.id === tc);
    }).join('');
    if (tc && topicSel.value !== tc) topicSel.value = '';

    var causeSel = $('#f-cause');
    var cc = f.cause;
    causeSel.innerHTML = '<option value="">全部错因</option>' + CAUSES.map(function (c) {
      return optionHTML(c.k, c.label, c.k === cc);
    }).join('');
    if (causeSel.value !== cc) causeSel.value = cc;

    var statusSel = $('#f-status');
    var sc = f.status;
    statusSel.innerHTML = '<option value="">全部状态</option>' + STATUSES.map(function (s) {
      return optionHTML(s.k, s.label, s.k === sc);
    }).join('');
    if (statusSel.value !== sc) statusSel.value = sc;

    var sSubj = $('#s-subject');
    var sCur = sSubj.value || '';
    sSubj.innerHTML = '<option value="">全部科目</option>' + SUBJECTS.map(function (s) {
      return optionHTML(s, s, s === sCur);
    }).join('');

    var dl = $('#topic-suggestions');
    dl.innerHTML = state.topics.map(function (t) {
      return '<option value="' + esc(t.name) + '">' + esc(t.subject) + '</option>';
    }).join('');
  }

  // ======================= 选项卡 =======================
  function showTab(name) {
    state.tab = name;
    $$('.tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === name); });
    $$('.panel').forEach(function (p) { p.classList.toggle('hidden', p.id !== 'panel-' + name); });
    renderCurrent();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderCurrent() {
    if (state.tab === 'items') renderItems();
    else if (state.tab === 'answers') renderAnswers();
    else if (state.tab === 'topics') renderTopics();
    else if (state.tab === 'scheme') renderScheme();
    else if (state.tab === 'inbox') renderInbox();
    else if (state.tab === 'review') { refreshReviewCounts(); renderReviewStage(); }
    else if (state.tab === 'stats') renderStats();
    else if (state.tab === 'settings') { loadGradeConfig(); }
  }

  // ======================= 错题列表 =======================
  function filterItems() {
    var f = state.filters;
    var q = (f.q || '').trim().toLowerCase();
    return state.items.filter(function (it) {
      if (f.subject && it.subject !== f.subject) return false;
      if (f.topic && (it.topics || []).indexOf(f.topic) < 0) return false;
      if (f.cause && (it.causes || []).indexOf(f.cause) < 0) return false;
      if (f.status && statusOf(it.id) !== f.status) return false;
      if (q) {
        var hay = [
          it.question, it.myAnswer, it.correctAnswer, it.note, it.source,
          (it.markScheme || []).map(function (m) { return m.point; }).join(' '),
          (it.topics || []).map(topicName).join(' ')
        ].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) {
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
  }

  function thumbsHTML(it, opts) {
    opts = opts || {};
    var ids = it.imageIds || [];
    if (!ids.length) return '';
    var cls = 'thumbs' + (opts.hidden ? ' hidden' : '');
    var idAttr = opts.id ? ' id="' + esc(opts.id) + '"' : '';
    return '<div class="' + cls + '"' + idAttr + '>' + ids.map(function (id) {
      return '<div class="thumb"><img data-img="' + esc(id) + '" data-action="zoom" alt="题目图片"></div>';
    }).join('') + '</div>';
  }

  /* 某道题下，当前账号的作答记录（云端只看自己的） */
  function mySubmissionsFor(itemId) {
    return (state.submissions || []).filter(function (s) {
      if (s.questionId !== itemId) return false;
      if (state.cloud && state.me && s.ownerId && s.ownerId !== state.me.id) return false;
      return true;
    }).sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
  }

  function itemCardHTML(it) {
    var topicChips = (it.topics || []).map(function (id) {
      return '<span class="badge topic" data-action="filter-topic" data-topic="' + esc(id) + '">' + esc(topicName(id)) + '</span>';
    }).join('');
    var causeChips = (it.causes || []).map(function (k) {
      return '<span class="badge cause">' + esc(causeLabel(k)) + '</span>';
    }).join('');
    var missed = (it.markScheme || []).filter(function (m) { return m.missed; }).length;
    var msChip = missed ? '<span class="badge cause">漏 ' + missed + ' 个要点</span>' : '';

    var subCount = (state.submissions || []).filter(function (s) { return s.questionId === it.id; }).length;
    var answeredChip = subCount ? '<span class="badge topic">已作答 ' + subCount + ' 次</span>' : '';

    var ansId = 'ans-' + it.id;
    var msList = (it.markScheme || []).filter(function (m) { return m && m.point; });
    var hasGraded = (state.submissions || []).some(function (s) {
      return s.questionId === it.id && s.status === 'graded' && s.grade;
    });
    var hasAnswer = !!(it.correctAnswer || it.myAnswer || msList.length || hasGraded);
    var canAuto = canAutoGrade();
    var answerHTML =
      '<div class="answer-box hidden" id="' + ansId + '">' +
        '<div class="answer-line"><b>正确答案：</b>' +
          renderMathText(it.correctAnswer || (canAuto ? '（还没有答案，点「查看答案」让 AI 解出来）' : '（还没有答案）')) + '</div>' +
        (it.myAnswer ? '<div class="mine-line">我的答案：' + renderMathText(it.myAnswer) + '</div>' : '') +
        (msList.length ? '<div class="ms-view">' + msList.map(function (m) {
          return '<div class="ms-view-item' + (m.missed ? ' missed' : '') + '">' +
            (m.missed ? '✗ ' : '✓ ') + renderMathText(m.point) + '</div>';
        }).join('') + '</div>' : '') +
      '</div>' +
      '<button class="btn tiny answer-toggle" data-action="reveal-card" data-target="' + ansId + '" data-item="' + esc(it.id) + '">' +
        (hasAnswer ? '👀 查看答案' : (canAuto ? '👀 查看答案（AI 生成）' : '👀 查看答案')) +
      '</button>';

    var diffStars = '★★★'.slice(0, Math.max(1, Math.min(3, it.difficulty || 2)));
    var mastered = statusOf(it.id) === 'mastered';
    var canEdit = !state.cloud || !!(state.me && (it.ownerId === state.me.id || state.me.role === 'admin'));
    var ownerChip = (state.cloud && it.ownerName)
      ? '<span class="badge topic">' + esc(it.ownerName) + '</span>'
      : '';
    // 题干已有文字时，默认收起原图（点「查看原图」再显示）
    var hasText = !!(it.question && it.question.trim());
    var thumbsId = 'thumbs-' + it.id;
    // 有图就始终显示原图（图表是题目的一部分），文字只是补充
    var thumbsBlock = thumbsHTML(it) +
      ((hasText && (it.imageIds || []).length)
        ? '<div class="q-actions">' +
            '<button class="link" data-action="copy-question" data-id="' + esc(it.id) + '">📋 复制题目</button>' +
            '<button class="link danger" data-action="remove-images" data-id="' + esc(it.id) + '">🗑 删除原图</button>' +
          '</div>'
        : '');

    var subs = mySubmissionsFor(it.id);
    var gradedSub = null;
    var pendingSub = null;
    for (var si = 0; si < subs.length; si++) {
      if (subs[si].status === 'graded' && subs[si].grade && !gradedSub) gradedSub = subs[si];
      else if (subs[si].status !== 'graded' && !pendingSub) pendingSub = subs[si];
    }
    var pendingCount = subs.filter(function (s) { return s.status !== 'graded'; }).length;
    var gradeHTML = '';
    if (gradedSub) {
      var g = gradedSub.grade;
      gradeHTML = '<div class="grade-box">' +
        '<div class="grade-head"><span class="grade-score">' + esc(g.score) + ' / ' + esc(g.fullMarks) + '</span>' +
        '<span class="muted">我的作答 · 已批改</span>' +
        (pendingCount ? '<span class="badge st-new">另有 ' + pendingCount + ' 次待批改</span>' : '') +
        '</div>' +
        (g.standardAnswer ? '<div class="mine-line"><b>参考答案：</b>' + renderMathText(g.standardAnswer) + '</div>' : '') +
        ((gradedSub.answerImageIds || []).length ? '<div class="mine-line"><b>我的作答图片：</b></div><div class="thumbs">' +
          gradedSub.answerImageIds.map(function (id) {
            return '<div class="thumb"><img data-img="' + esc(id) + '" data-action="zoom" alt="我的作答图片"></div>';
          }).join('') + '</div>' : '') +
        ((g.points || []).length ? '<div class="ms-view">' + g.points.map(function (p) {
          var hasScore = typeof p.awarded === 'number' && typeof p.max === 'number';
          var ok = hasScore && p.awarded >= p.max;
          return '<div class="ms-view-item' + (ok ? '' : ' missed') + '">' + (ok ? '✓ ' : '✗ ') + renderMathText(p.point) +
            (hasScore ? '（' + p.awarded + '/' + p.max + '）' : '') +
            (p.comment ? ' —— ' + renderMathText(p.comment) : '') + '</div>';
        }).join('') + '</div>' : '') +
        (g.comment ? '<div class="mine-line">📝 ' + renderMathText(g.comment) + '</div>' : '') +
        ((g.causes || []).length ? '<div class="chips">' + g.causes.map(function (c) {
          return '<span class="badge cause">' + esc(causeLabel(c)) + '</span>';
        }).join('') + '</div>' : '') +
        '</div>';
    } else if (pendingCount) {
      gradeHTML = '<div class="grade-pending">⏳ 已提交 ' + pendingCount + ' 次作答，等待批改' +
        (pendingSub
          ? ' <button class="btn tiny primary" data-action="grade-now" data-id="' + esc(pendingSub.id) + '">⚡ 立即批改</button>'
          : '') +
        '</div>';
    }

    return '<article class="card item-card" data-id="' + esc(it.id) + '">' +
      '<div class="item-head">' +
        '<span class="badge ' + subjectClass(it.subject) + '">' + esc(it.subject || '其他') + '</span>' +
        '<span class="badge st-' + esc(statusOf(it.id)) + '">' + esc(statusLabel(statusOf(it.id))) + '</span>' +
        '<span class="badge diff">' + diffStars + '</span>' +
        '<span class="item-source">' + esc(it.source || '') + '</span>' +
        ownerChip +
        '<span class="grow"></span>' +
        (canEdit ? '<button class="link" data-action="toggle-mastered" data-id="' + esc(it.id) + '">' + (mastered ? '取消已掌握' : '标记已掌握') + '</button>' : '') +
        '<button class="link" data-action="toggle-answer-box" data-id="' + esc(it.id) + '">✍️ 作答</button>' +
        ((canEdit && state.cloud && typeof Cloud !== 'undefined' && Cloud.health && Cloud.health.autoGrade && (it.imageIds || []).length)
          ? '<button class="link" data-action="transcribe-item" data-id="' + esc(it.id) + '">🔤 转文字</button>'
          : '') +
        ((canEdit && state.cloud && typeof Cloud !== 'undefined' && Cloud.health && Cloud.health.autoGrade && (it.imageIds || []).length)
          ? '<button class="link" data-action="crop-figure" data-id="' + esc(it.id) + '">✂ 裁剪图形</button>'
          : '') +
        ((canEdit && (it.prevImageIds || []).length)
          ? '<button class="link" data-action="restore-image" data-id="' + esc(it.id) + '">↩ 还原原图</button>'
          : '') +
        ((canEdit && state.cloud && typeof Cloud !== 'undefined' && Cloud.health && Cloud.health.autoGrade)
          ? '<button class="link" data-action="tag-item" data-id="' + esc(it.id) + '">🏷 识别知识点</button>'
          : '') +
        (canEdit ? '<button class="link" data-action="edit-item" data-id="' + esc(it.id) + '">编辑</button>' : '') +
        (canEdit ? '<button class="link danger" data-action="delete-item" data-id="' + esc(it.id) + '">删除</button>' : '') +
      '</div>' +
      (it.question ? '<div class="q-text">' + renderMathText(it.question) + '</div>' : '') +
      thumbsBlock +
      ((topicChips || causeChips || msChip || answeredChip) ? '<div class="chips">' + topicChips + causeChips + msChip + answeredChip + '</div>' : '') +
      answerHTML +
      gradeHTML +
      '<div class="inline-answer hidden" id="ansbox-' + esc(it.id) + '">' +
        '<textarea class="inline-answer-text" rows="3" placeholder="在这里写答案 / 解题过程；画图题可上传手写或绘图"></textarea>' +
        '<div class="inline-answer-actions">' +
          '<label class="btn tiny">📷 手写/绘图<input type="file" class="answer-file" accept="image/*" multiple data-id="' + esc(it.id) + '" hidden></label>' +
          '<span class="answer-thumbs" id="athumb-' + esc(it.id) + '"></span>' +
          '<span class="grow"></span>' +
          '<button class="btn tiny" data-action="cancel-inline-answer" data-id="' + esc(it.id) + '">取消</button>' +
          '<button class="btn tiny primary" data-action="submit-inline-answer" data-id="' + esc(it.id) + '">提交作答</button>' +
        '</div>' +
      '</div>' +
      (it.note ? '<div class="mine-line">📝 ' + esc(it.note) + '</div>' : '') +
    '</article>';
  }

  function groupedHTML(list) {
    var groups = {};
    var order = [];
    list.forEach(function (it) {
      var ids = (it.topics || []).filter(Boolean);
      if (!ids.length) ids = ['__none__'];
      ids.forEach(function (tid) {
        if (!groups[tid]) { groups[tid] = []; order.push(tid); }
        groups[tid].push(it);
      });
    });
    order.sort(function (a, b) { return groups[b].length - groups[a].length; });
    return order.map(function (tid) {
      var name = tid === '__none__' ? '未分类' : topicName(tid);
      var t = tid === '__none__' ? null : topicById(tid);
      var subj = t ? t.subject : '';
      return '<section class="topic-group">' +
        '<div class="topic-group-head">' +
          '<span class="badge ' + (subj ? subjectClass(subj) : 's-other') + '">' + esc(subj || '未分类') + '</span>' +
          '<h3>' + esc(name) + '</h3>' +
          '<span class="muted">' + groups[tid].length + ' 题</span>' +
          '<span class="grow"></span>' +
          (tid !== '__none__' ? '<button class="link" data-action="filter-topic" data-topic="' + esc(tid) + '">只看这个</button>' : '') +
        '</div>' +
        '<div class="group-list">' + groups[tid].map(itemCardHTML).join('') + '</div>' +
      '</section>';
    }).join('');
  }

  function renderItems() {
    var list = filterItems();
    $('#items-count').textContent = '共 ' + state.items.length + ' 题，当前显示 ' + list.length + ' 题' +
      (state.cloud ? ' · 全班共享：别人新传的题点右上角「刷新」' : '');
    var gt = $('#group-toggle');
    if (gt) gt.textContent = state.groupMode ? '📋 平铺列表' : '🗂 按知识点';
    var box = $('#item-list');
    box.classList.toggle('grouped', !!state.groupMode);
    if (!state.items.length) {
      box.innerHTML = '<div class="empty"><h3>还没有错题</h3>' +
        '<p>点右上角「+ 新增错题」录入第一题，或去「设置 → 载入示例数据」看看效果。</p>' +
        '<p><button class="btn primary" data-action="new-item">+ 新增错题</button></p></div>';
      return;
    }
    if (!list.length) {
      box.innerHTML = '<div class="empty"><h3>没有符合条件的错题</h3><p>试试清空筛选条件或换关键词。</p></div>';
      return;
    }
    box.innerHTML = state.groupMode ? groupedHTML(list) : list.map(itemCardHTML).join('');
    hydrateImages(box);
  }

  function toggleMastered(id) {
    var cur = statusOf(id);
    saveProgress(id, { status: cur === 'mastered' ? 'reviewing' : 'mastered' }).then(function () {
      renderCurrent();
      refreshReviewCounts();
    });
  }

  function deleteItem(id) {
    var it = byId(state.items, 'id', id);
    if (!it) return;
    if (!confirm('删除这道错题？')) return;
    var ids = it.imageIds || [];
    state.items = state.items.filter(function (x) { return x.id !== id; });
    Promise.all([DataStore.del('items', id)].concat(ids.map(function (iid) {
      revokeImage(iid);
      return DataStore.del('images', iid);
    }))).then(function () {
      renderCurrent();
      refreshReviewCounts();
      toast('已删除', 'ok');
    });
  }

  // ======================= 编辑器 =======================
  function defaultItem() {
    return {
      id: null,
      subject: '数学 AA',
      source: '',
      date: todayISO(),
      topics: [],
      causes: [],
      difficulty: 2,
      status: 'new',
      question: '',
      myAnswer: '',
      correctAnswer: '',
      markScheme: [],
      note: '',
      imageIds: [],
      review: { due: todayISO(), interval: 0, ease: 2.5, reps: 0 }
    };
  }

  function showModal(id) { $('#' + id).classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
  function hideModal(id) { $('#' + id).classList.add('hidden'); document.body.style.overflow = ''; }

  function openEditor(id) {
    var base = id ? clone(byId(state.items, 'id', id)) : defaultItem();
    if (!base) return;
    state.editing = { id: id || null, item: base, images: [], removed: [] };

    var promises = (base.imageIds || []).map(function (iid) {
      return getImageUrl(iid).then(function (url) { return { id: iid, url: url || '' }; });
    });
    $('#editor-title').textContent = id ? '编辑错题' : '新增错题';
    Promise.all(promises).then(function (arr) {
      state.editing.images = arr;
      fillEditor();
      showModal('modal-editor');
    });
  }

  function fillEditor() {
    var it = state.editing.item;
    // 兼容旧数据里的旧科目名（如 "数学"）
    var subjSel = $('#e-subject');
    if (it.subject) {
      var exists = false;
      for (var oi = 0; oi < subjSel.options.length; oi++) {
        if (subjSel.options[oi].value === it.subject) { exists = true; break; }
      }
      if (!exists) {
        var opt = document.createElement('option');
        opt.value = it.subject;
        opt.textContent = it.subject;
        subjSel.appendChild(opt);
      }
      subjSel.value = it.subject;
    } else {
      subjSel.value = '数学 AA';
    }
    $('#e-date').value = it.date || todayISO();
    $('#e-status').value = it.id ? statusOf(it.id) : 'new';
    $('#e-diff').value = String(it.difficulty || 2);
    $('#e-source').value = it.source || '';
    $('#e-topics').value = (it.topics || []).map(topicName).join(', ');
    $('#e-question').value = it.question || '';
    $('#e-my').value = it.myAnswer || '';
    $('#e-correct').value = it.correctAnswer || '';
    $('#e-note').value = it.note || '';

    $('#e-causes').innerHTML = CAUSES.map(function (c) {
      var on = (it.causes || []).indexOf(c.k) >= 0;
      return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-action="toggle-cause" data-cause="' + c.k + '">' + esc(c.label) + '</button>';
    }).join('');

    var ms = it.markScheme || [];
    $('#e-ms').innerHTML = ms.length
      ? ms.map(function (m) { return msRowHTML(m.point, m.missed); }).join('')
      : msRowHTML('', false);

    // 云端模式默认收起答案区（答案由 AI 批改生成）；离线模式默认展开
    var block = $('#e-answer-block');
    var toggle = $('#e-answer-toggle');
    var hasAnswer = !!(it.correctAnswer || it.myAnswer || ms.length);
    if (block) block.classList.toggle('hidden', state.cloud && !hasAnswer);
    if (toggle) toggle.textContent = (block && !block.classList.contains('hidden'))
      ? '▾ 收起答案区'
      : '▸ 已有答案？展开填写（可留空）';
    renderEditorImages();
  }

  function msRowHTML(point, missed) {
    return '<div class="ms-row">' +
      '<input type="text" class="ms-text" placeholder="一个得分点 / 关键词" value="' + esc(point || '') + '">' +
      '<label class="missed"><input type="checkbox" class="ms-missed"' + (missed ? ' checked' : '') + '> 漏了</label>' +
      '<button type="button" class="icon-btn" data-action="del-ms">✕</button>' +
    '</div>';
  }

  function renderEditorImages() {
    var box = $('#e-images');
    box.innerHTML = state.editing.images.map(function (im, i) {
      return '<div class="image-cell"><img src="' + esc(im.url) + '" alt="">' +
        '<button type="button" class="rm" data-action="rm-image" data-idx="' + i + '">✕</button></div>';
    }).join('');
  }

  function addImageFiles(fileList) {
    var files = Array.prototype.slice.call(fileList).filter(function (f) {
      return f && /^image\//.test(f.type || '');
    });
    if (!files.length) return;
    Promise.all(files.map(compressImage)).then(function (blobs) {
      blobs.forEach(function (blob) {
        state.editing.images.push({ id: null, blob: blob, url: URL.createObjectURL(blob) });
      });
      renderEditorImages();
    });
  }

  function removeEditorImage(idx) {
    var im = state.editing.images[idx];
    if (!im) return;
    if (im.id) state.editing.removed.push(im.id);
    if (im.url && im.url.indexOf('blob:') === 0) URL.revokeObjectURL(im.url);
    state.editing.images.splice(idx, 1);
    renderEditorImages();
  }

  function ensureTopic(name, subject) {
    name = String(name || '').trim();
    if (!name) return null;
    var found = state.topics.filter(function (t) { return t.name === name && t.subject === subject; })[0];
    if (found) return found.id;
    var t = { id: uid(), subject: subject, name: name, definition: '', formula: '', pitfalls: '' };
    state.topics.push(t);
    DataStore.put('topics', t).catch(function () {});
    return t.id;
  }

  function saveItem() {
    var ed = state.editing;
    if (!ed) return;
    var question = $('#e-question').value.trim();
    var subject = $('#e-subject').value || '化学';
    if (!question && !ed.images.length) {
      toast('至少写个题干，或者加一张题目图片', 'err');
      return;
    }

    var names = $('#e-topics').value.split(/[,，、]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var topicIds = [];
    names.forEach(function (n) {
      var tid = ensureTopic(n, subject);
      if (tid && topicIds.indexOf(tid) < 0) topicIds.push(tid);
    });

    var it = ed.item;
    if (!it.id) it.id = uid();
    it.subject = subject;
    it.date = $('#e-date').value || todayISO();
    it.status = $('#e-status').value || 'new';
    it.difficulty = parseInt($('#e-diff').value, 10) || 2;
    it.source = $('#e-source').value.trim();
    it.topics = topicIds;
    it.question = question;
    it.myAnswer = $('#e-my').value.trim();
    it.correctAnswer = $('#e-correct').value.trim();
    it.note = $('#e-note').value.trim();
    it.causes = $$('.chip.on', $('#e-causes')).map(function (c) { return c.getAttribute('data-cause'); });
    it.markScheme = $$('.ms-row', $('#e-ms')).map(function (row) {
      return {
        point: $('.ms-text', row).value.trim(),
        missed: $('.ms-missed', row).checked
      };
    }).filter(function (m) { return m.point; });

    ed.images.forEach(function (im) { if (!im.id) { im.id = uid(); im.isNew = true; } });
    it.imageIds = ed.images.map(function (im) { return im.id; });
    it.updatedAt = new Date().toISOString();
    if (!it.createdAt) it.createdAt = it.updatedAt;
    if (!it.review) it.review = { due: todayISO(), interval: 0, ease: 2.5, reps: 0 };

    var writes = ed.images.filter(function (im) { return im.isNew; }).map(function (im) {
      return DataStore.put('images', {
        id: im.id,
        blob: im.blob,
        type: (im.blob && im.blob.type) || 'image/jpeg',
        name: ''
      });
    });
    var dels = ed.removed.map(function (id) {
      revokeImage(id);
      return DataStore.del('images', id);
    });

    Promise.all(writes.concat(dels)).then(function () {
      return DataStore.put('items', it);
    }).then(function (saved) {
      if (saved && saved.id) it = saved; // 云端会补上 ownerId / ownerName
      return saveProgress(it.id, { status: $('#e-status').value || 'new' });
    }).then(function () {
      state.items = state.items.filter(function (x) { return x.id !== it.id; });
      state.items.push(it);
      hideModal('modal-editor');
      state.editing = null;
      rebuildFilters();
      renderCurrent();
      refreshReviewCounts();
      toast('已保存', 'ok');
    }).catch(function (e) {
      console.error(e);
      toast('保存失败：' + (e && e.message ? e.message : e), 'err');
    });
  }

  // ======================= 知识点 =======================
  function renderTopics() {
    var q = ($('#topic-search').value || '').trim().toLowerCase();
    var box = $('#topic-list');
    var list = state.topics.filter(function (t) {
      if (!q) return true;
      return (t.name + ' ' + (t.definition || '') + ' ' + (t.formula || '') + ' ' + (t.pitfalls || '')).toLowerCase().indexOf(q) >= 0;
    });
    if (!list.length) {
      box.innerHTML = '<div class="empty"><h3>还没有知识点</h3><p>新增知识点，并给错题打上标签，两边会自动关联。</p></div>';
      return;
    }
    box.innerHTML = list.map(function (t) {
      var count = state.items.filter(function (it) { return (it.topics || []).indexOf(t.id) >= 0; }).length;
      return '<article class="card topic-card">' +
        '<div class="topic-card-head"><h3><span class="badge ' + subjectClass(t.subject) + '">' + esc(t.subject) + '</span>' + esc(t.name) + '</h3></div>' +
        (t.definition ? '<div class="topic-block"><span class="label">定义</span><span class="value">' + esc(t.definition) + '</span></div>' : '') +
        (t.formula ? '<div class="topic-block"><span class="label">公式 / 关键规则</span><span class="value">' + esc(t.formula) + '</span></div>' : '') +
        (t.pitfalls ? '<div class="topic-block"><span class="label">易错点</span><span class="value">' + esc(t.pitfalls) + '</span></div>' : '') +
        '<div class="topic-actions">' +
          '<span class="topic-count" data-action="filter-topic" data-topic="' + esc(t.id) + '">相关错题 ' + count + ' 道 →</span>' +
          '<span class="grow"></span>' +
          '<button class="link" data-action="edit-topic" data-id="' + esc(t.id) + '">编辑</button>' +
          '<button class="link danger" data-action="delete-topic" data-id="' + esc(t.id) + '">删除</button>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function openTopicEditor(id) {
    var t = id ? clone(byId(state.topics, 'id', id)) : null;
    state.editingTopic = t || { id: null, subject: '化学', name: '', definition: '', formula: '', pitfalls: '' };
    $('#topic-title').textContent = id ? '编辑知识点' : '新增知识点';
    $('#t-name').value = state.editingTopic.name || '';
    $('#t-subject').value = state.editingTopic.subject || '化学';
    $('#t-def').value = state.editingTopic.definition || '';
    $('#t-formula').value = state.editingTopic.formula || '';
    $('#t-pitfalls').value = state.editingTopic.pitfalls || '';
    showModal('modal-topic');
  }

  function saveTopic() {
    var t = state.editingTopic;
    if (!t) return;
    var name = $('#t-name').value.trim();
    if (!name) { toast('知识点名称不能为空', 'err'); return; }
    t.name = name;
    t.subject = $('#t-subject').value || '化学';
    t.definition = $('#t-def').value.trim();
    t.formula = $('#t-formula').value.trim();
    t.pitfalls = $('#t-pitfalls').value.trim();
    if (!t.id) t.id = uid();
    state.topics = state.topics.filter(function (x) { return x.id !== t.id; }).concat([t]);
    DataStore.put('topics', t).then(function () {
      hideModal('modal-topic');
      state.editingTopic = null;
      rebuildFilters();
      renderCurrent();
      toast('知识点已保存', 'ok');
    }).catch(function (e) { toast('保存失败：' + e.message, 'err'); });
  }

  function deleteTopic(id) {
    var t = byId(state.topics, 'id', id);
    if (!t) return;
    var count = state.items.filter(function (it) { return (it.topics || []).indexOf(id) >= 0; }).length;
    if (!confirm('删除知识点「' + t.name + '」？' + (count ? '\n注意：有 ' + count + ' 道错题用了这个标签，标签会被移除（错题本身保留）。' : ''))) return;
    state.topics = state.topics.filter(function (x) { return x.id !== id; });
    state.items.forEach(function (it) {
      if ((it.topics || []).indexOf(id) >= 0) {
        it.topics = it.topics.filter(function (x) { return x !== id; });
        DataStore.put('items', it);
      }
    });
    DataStore.del('topics', id).then(function () {
      rebuildFilters();
      renderCurrent();
      toast('已删除知识点', 'ok');
    });
  }

  // ======================= Mark Scheme =======================
  function renderScheme() {
    var subject = $('#s-subject').value || '';
    var onlyMissed = $('#s-missed').checked;
    var list = state.items.filter(function (it) {
      if (!(it.markScheme || []).length) return false;
      if (subject && it.subject !== subject) return false;
      if (onlyMissed && !it.markScheme.some(function (m) { return m.missed; })) return false;
      return true;
    }).sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });

    var box = $('#scheme-list');
    if (!list.length) {
      box.innerHTML = '<div class="empty"><h3>还没有 Mark Scheme 要点</h3><p>在编辑错题时，把评分要点逐条写进去，并勾上「漏了」。</p></div>';
      return;
    }
    box.innerHTML = list.map(function (it) {
      var points = (it.markScheme || []).filter(function (m) { return !onlyMissed || m.missed; });
      return '<article class="card scheme-card">' +
        '<div class="scheme-head">' +
          '<span class="badge ' + subjectClass(it.subject) + '">' + esc(it.subject) + '</span>' +
          '<span class="item-source">' + esc(it.source || '') + '</span>' +
          '<span class="grow"></span>' +
          '<button class="link" data-action="edit-item" data-id="' + esc(it.id) + '">编辑</button>' +
        '</div>' +
        (it.question ? '<div class="q-text">' + renderMathText(it.question) + '</div>' : '') +
        '<div class="scheme-items" style="margin-top:8px">' + points.map(function (m) {
          return '<div class="scheme-item' + (m.missed ? ' missed' : '') + '">' +
            '<span class="flag">' + (m.missed ? '✗' : '✓') + '</span><span>' + renderMathText(m.point) + '</span></div>';
        }).join('') + '</div>' +
      '</article>';
    }).join('');
  }

  // ======================= 复习 =======================
  function dueList() {
    var today = todayISO();
    return state.items.filter(function (it) {
      if (statusOf(it.id) === 'mastered') return false;
      var d = reviewOf(it.id).due;
      return !d || d <= today;
    }).sort(function (a, b) {
      var da = reviewOf(a.id).due || '0000-00-00';
      var db = reviewOf(b.id).due || '0000-00-00';
      return da.localeCompare(db);
    });
  }

  function refreshReviewCounts() {
    var due = dueList().length;
    var unmastered = state.items.filter(function (it) { return statusOf(it.id) !== 'mastered'; }).length;
    var a = $('#review-due');
    var b = $('#review-total');
    if (a) a.textContent = due;
    if (b) b.textContent = unmastered;
  }

  function startReview() {
    var q = dueList();
    if (!q.length) q = state.items.filter(function (it) { return statusOf(it.id) !== 'mastered'; });
    if (!q.length) { toast('还没有错题，先去「错题本」新增吧', 'err'); return; }
    state.review = { queue: q, idx: 0, revealed: false, done: 0, again: 0 };
    renderReviewStage();
  }

  function renderReviewStage() {
    var stage = $('#review-stage');
    var r = state.review;
    if (!r.queue.length) {
      stage.innerHTML = '<div class="review-empty">🎉 今天没有到期的错题。<br>点上方「开始复习」会从全部未掌握错题里随机安排一轮。</div>';
      return;
    }
    if (r.idx >= r.queue.length) {
      stage.innerHTML = '<div class="review-empty">✅ 本轮完成！<br>记住了 ' + r.done + ' 题，忘了 ' + r.again + ' 题。' +
        '<br><br><button class="btn primary" data-action="start-review">再来一轮</button></div>';
      return;
    }
    var it = r.queue[r.idx];
    var html = '<div class="review-card">' +
      '<div class="review-progress">第 ' + (r.idx + 1) + ' / ' + r.queue.length + ' 题 · ' + esc(it.subject) + ' · ' + esc(it.source || '') + '</div>' +
      '<div class="review-question">' + renderMathText(it.question || '（只有图片，请看下方）') + '</div>' +
      thumbsHTML(it);

    if (!r.revealed) {
      html += '<div class="review-actions"><button class="btn primary" data-action="reveal">显示答案</button></div>';
    } else {
      html += '<div class="review-block"><h4>我的答案</h4>' + renderMathText(it.myAnswer || '（未填写）') + '</div>' +
        '<div class="review-block good"><h4>正确答案</h4>' + renderMathText(it.correctAnswer || '（未填写）') + '</div>';
      if ((it.markScheme || []).length) {
        html += '<div class="review-block"><h4>Mark Scheme 得分点</h4>' + (it.markScheme || []).map(function (m) {
          return (m.missed ? '✗ ' : '✓ ') + renderMathText(m.point);
        }).join('\n') + '</div>';
      }
      if (it.note) html += '<div class="review-block bad"><h4>当时的笔记</h4>' + esc(it.note) + '</div>';
      html += '<div class="review-actions">' +
        '<button class="btn" data-action="rate" data-rate="again">😵 忘了（明天再来）</button>' +
        '<button class="btn" data-action="rate" data-rate="hard">😐 有点难</button>' +
        '<button class="btn primary" data-action="rate" data-rate="good">😎 记住了</button>' +
        '</div>';
    }
    html += '</div>';
    stage.innerHTML = html;
    hydrateImages(stage);
  }

  function applyReview(item, rating) {
    var itemId = item.id;
    var rev = reviewOf(itemId);
    rev = { interval: rev.interval || 0, ease: rev.ease || 2.5, reps: rev.reps || 0, due: rev.due || '' };
    var status = statusOf(itemId);
    if (rating === 'again') {
      rev.interval = 1;
      rev.ease = Math.max(1.3, (rev.ease || 2.5) - 0.2);
      rev.reps = 0;
      status = 'new';
    } else if (rating === 'hard') {
      rev.interval = Math.max(1, Math.round((rev.interval || 1) * 1.5));
      rev.reps = (rev.reps || 0) + 1;
      if (status === 'new') status = 'reviewing';
    } else {
      rev.interval = (rev.reps || 0) === 0 ? 1 : Math.min(60, Math.round((rev.interval || 1) * (rev.ease || 2.5)));
      rev.reps = (rev.reps || 0) + 1;
      status = rev.reps >= 3 ? 'mastered' : 'reviewing';
    }
    rev.due = addDays(todayISO(), rev.interval);
    saveProgress(itemId, { status: status, review: rev });
  }

  function rate(rating) {
    var r = state.review;
    var it = r.queue[r.idx];
    if (!it) return;
    applyReview(it, rating);
    if (rating === 'again') r.again++; else r.done++;
    r.idx++;
    r.revealed = false;
    renderReviewStage();
    refreshReviewCounts();
  }

  // ======================= 统计 =======================
  function barRow(label, num, max, cls) {
    var pct = max > 0 ? Math.round(num / max * 100) : 0;
    return '<div class="bar-row"><span>' + esc(label) + '</span>' +
      '<span class="bar-track"><span class="bar-fill ' + (cls || '') + '" style="width:' + pct + '%"></span></span>' +
      '<span class="bar-num">' + num + '</span></div>';
  }

  function renderStats() {
    var box = $('#stats');
    var total = state.items.length;
    var byStatus = { new: 0, reviewing: 0, mastered: 0 };
    var bySubject = {};
    var byCause = { K: 0, M: 0, C: 0, E: 0 };
    var byTopic = {};
    var missedCount = 0;
    var schemeCount = 0;

    state.items.forEach(function (it) {
      var st = statusOf(it.id);
      byStatus[st] = (byStatus[st] || 0) + 1;
      bySubject[it.subject] = (bySubject[it.subject] || 0) + 1;
      (it.causes || []).forEach(function (c) { byCause[c] = (byCause[c] || 0) + 1; });
      (it.topics || []).forEach(function (t) { byTopic[t] = (byTopic[t] || 0) + 1; });
      (it.markScheme || []).forEach(function (m) { schemeCount++; if (m.missed) missedCount++; });
    });

    var topicArr = Object.keys(byTopic).map(function (id) {
      return { name: topicName(id), num: byTopic[id] };
    }).sort(function (a, b) { return b.num - a.num; }).slice(0, 10);

    var subjectMax = Math.max.apply(null, Object.keys(bySubject).map(function (k) { return bySubject[k]; }).concat([1]));
    var causeMax = Math.max.apply(null, Object.values(byCause).concat([1]));
    var topicMax = Math.max.apply(null, topicArr.map(function (t) { return t.num; }).concat([1]));

    var html = '<div class="stats-grid">' +
      '<div class="card stat-card"><div class="stat-num">' + total + '</div><div class="stat-label">错题总数</div></div>' +
      '<div class="card stat-card"><div class="stat-num" style="color:var(--red)">' + (byStatus.new || 0) + '</div><div class="stat-label">未掌握</div></div>' +
      '<div class="card stat-card"><div class="stat-num" style="color:var(--amber)">' + (byStatus.reviewing || 0) + '</div><div class="stat-label">复习中</div></div>' +
      '<div class="card stat-card"><div class="stat-num" style="color:var(--green)">' + (byStatus.mastered || 0) + '</div><div class="stat-label">已掌握</div></div>' +
      '<div class="card stat-card"><div class="stat-num">' + state.topics.length + '</div><div class="stat-label">知识点</div></div>' +
      '<div class="card stat-card"><div class="stat-num" style="color:var(--red)">' + missedCount + '</div><div class="stat-label">考试时漏掉的要点 / 共 ' + schemeCount + ' 条</div></div>' +
    '</div>';

    html += '<div class="card pad" style="margin-bottom:14px"><h3>按科目</h3><div class="bars">' +
      Object.keys(bySubject).sort(function (a, b) { return bySubject[b] - bySubject[a]; }).map(function (s) {
        return barRow(s, bySubject[s], subjectMax);
      }).join('') + '</div></div>';

    html += '<div class="card pad" style="margin-bottom:14px"><h3>按错因（可多选，所以总数可能大于错题数）</h3><div class="bars">' +
      CAUSES.map(function (c) {
        return barRow(c.label, byCause[c.k] || 0, causeMax, c.k === 'K' ? 'red' : (c.k === 'M' ? 'amber' : (c.k === 'C' ? 'purple' : '')));
      }).join('') + '</div></div>';

    html += '<div class="card pad"><h3>丢分最多的知识点 Top 10</h3>' +
      (topicArr.length ? '<div class="bars">' + topicArr.map(function (t) {
        return barRow(t.name, t.num, topicMax, 'red');
      }).join('') + '</div>' : '<p class="muted">还没有带知识点的错题。</p>') +
    '</div>';

    box.innerHTML = html;
  }

  // ======================= 作答 / 批改 =======================
  function canAutoGrade() {
    return !!(state.cloud && typeof Cloud !== 'undefined' && Cloud.health && Cloud.health.autoGrade);
  }

  /* 点「查看答案」时：没有答案就让 AI 现算（有作答就先批改，没作答就只生成答案） */
  function ensureAnswer(itemId) {
    if (!itemId) return;
    var it = byId(state.items, 'id', itemId);
    if (!it) return;
    var subs = mySubmissionsFor(itemId);
    if (subs.some(function (s) { return s.status === 'graded' && s.grade; })) return;
    if (!canAutoGrade()) { return; }
    var pending = subs.filter(function (s) { return s.status !== 'graded'; })[0];
    if (pending) { toast('AI 批改中，马上出答案和分数…', 'ok'); gradeNow(pending.id); return; }
    var canEdit = !state.cloud || !!(state.me && (it.ownerId === state.me.id || state.me.role === 'admin'));
    if (!canEdit) { toast('这道题还没有答案', 'err'); return; }
    toast('AI 正在解题，生成标准答案…', 'ok');
    generateAnswer(itemId);
  }

  function generateAnswer(itemId) {
    if (!state.cloud || typeof Cloud === 'undefined') { toast('需要班级服务器模式', 'err'); return; }
    toast('AI 正在解题，生成标准答案…', 'ok');
    Cloud.answer(itemId).then(function (res) {
      return bootData().then(function () {
        openAnswerBox(itemId);
        toast('已生成标准答案' + (res && res.correctAnswer ? '：' + String(res.correctAnswer).slice(0, 30) + '…' : ''), 'ok');
      });
    }).catch(function (e) {
      toast('生成失败：' + (e && e.message ? e.message : e), 'err');
    });
  }

  function loadImageEl(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('图片加载失败')); };
      img.src = url;
    });
  }

  /* AI 自动裁剪图形：定位图形区域 → 裁剪 → 替换原图 */
  function autoCropFigure(itemId) {
    if (!state.cloud || typeof Cloud === 'undefined') { toast('需要班级服务器模式', 'err'); return; }
    var it = byId(state.items, 'id', itemId);
    if (!it || !(it.imageIds || []).length) { toast('这道题没有图片', 'err'); return; }
    toast('AI 正在定位图形区域…', 'ok');

    Cloud.detectFigure(itemId).then(function (res) {
      if (!res || !res.found || !res.box || !res.box.w || !res.box.h) {
        throw new Error('AI 没找到图形区域，可能这题没有图，或需要手动裁剪');
      }
      return getImageUrl(it.imageIds[0]).then(function (url) {
        if (!url) throw new Error('图片读取失败');
        return loadImageEl(url);
      }).then(function (img) {
        var b = res.box;
        var sx = Math.max(0, Math.round(b.x * img.naturalWidth));
        var sy = Math.max(0, Math.round(b.y * img.naturalHeight));
        var sw = Math.min(img.naturalWidth - sx, Math.round(b.w * img.naturalWidth));
        var sh = Math.min(img.naturalHeight - sy, Math.round(b.h * img.naturalHeight));
        if (sw < 30 || sh < 30) throw new Error('识别出的区域太小，建议手动裁剪');
        var canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.9); });
      }).then(function (blob) {
        var newId = uid();
        return DataStore.put('images', { id: newId, blob: blob, type: 'image/jpeg', name: '' }).then(function () {
          it.prevImageIds = (it.imageIds || []).slice(); // 备份，便于还原
          it.imageIds = [newId];
          it.updatedAt = new Date().toISOString();
          return DataStore.put('items', it);
        });
      }).then(function () {
        return bootData().then(function () {
          toast('已自动裁剪出图形（原图已替换）', 'ok');
        });
      });
    }).catch(function (e) {
      toast('自动裁剪失败：' + (e && e.message ? e.message : e), 'err');
    });
  }

  function restoreImage(itemId) {
    var it = byId(state.items, 'id', itemId);
    if (!it || !(it.prevImageIds || []).length) return;
    it.imageIds = it.prevImageIds.slice();
    it.prevImageIds = [];
    it.updatedAt = new Date().toISOString();
    DataStore.put('items', it).then(function (saved) {
      if (saved && saved.id) it = saved;
      return bootData().then(function () { toast('已还原成原图', 'ok'); });
    }).catch(function (e) { toast('还原失败：' + (e && e.message ? e.message : e), 'err'); });
  }

  function tagItem(itemId) {
    if (!state.cloud || typeof Cloud === 'undefined') { toast('需要班级服务器模式', 'err'); return; }
    toast('AI 正在判断 IB 知识点…', 'ok');
    Cloud.tag(itemId).then(function (res) {
      return bootData().then(function () {
        var names = ((res && res.topics) || []).join(' / ');
        toast('已识别：' + ((res && res.subject) || '') + ' · ' + names +
          ((res && res.added && res.added.length) ? '（新增 ' + res.added.length + ' 个知识点）' : ''), 'ok');
      });
    }).catch(function (e) {
      toast('识别失败：' + (e && e.message ? e.message : e), 'err');
    });
  }

  function copyItemQuestion(itemId) {
    var it = byId(state.items, 'id', itemId);
    if (!it || !it.question) { toast('这道题还没有文字', 'err'); return; }
    copyText(it.question).then(function (ok) {
      toast(ok ? '题目文字已复制，可直接粘贴' : '复制失败，请手动选中复制', ok ? 'ok' : 'err');
    });
  }

  function removeItemImages(itemId) {
    var it = byId(state.items, 'id', itemId);
    if (!it) return;
    if (!confirm('删除这道题的原图？\n\n⚠️ 如果题目里有图形（几何图 / 函数图像 / 实验装置图），删除后 AI 就看不到图形了，批改和生成答案会不准确。\n建议：只有纯文字题才删。\n\n（题干文字会保留）')) return;
    it.imageIds = [];
    it.updatedAt = new Date().toISOString();
    DataStore.put('items', it).then(function (saved) {
      if (saved && saved.id) it = saved;
      state.items = state.items.filter(function (x) { return x.id !== it.id; });
      state.items.push(it);
      renderCurrent();
      toast('原图已删除，题目只保留文字', 'ok');
    }).catch(function (e) {
      toast('删除失败：' + (e && e.message ? e.message : e), 'err');
    });
  }

  function transcribeItem(itemId) {
    if (!state.cloud || typeof Cloud === 'undefined') { toast('图片转文字需要班级服务器模式', 'err'); return; }
    toast('正在识别图片文字，请稍候…', 'ok');
    Cloud.transcribe(itemId).then(function (res) {
      return bootData().then(function () {
        if (res && res.imageRemoved) {
          toast('已转成文字；AI 判断这题不含图表，已自动移除原图', 'ok');
          return;
        }
        toast('已转成文字，正在自动裁剪图形…', 'ok');
        // 有图表：直接接着自动裁剪出图形区域
        setTimeout(function () { autoCropFigure(itemId); }, 200);
      });
    }).catch(function (e) {
      toast('识别失败：' + (e && e.message ? e.message : e), 'err');
    });
  }

  function openAnswerBox(itemId) {
    var box = document.getElementById('ans-' + itemId);
    var btn = document.querySelector('[data-action="reveal-card"][data-item="' + itemId + '"]');
    if (box) box.classList.remove('hidden');
    if (btn) btn.textContent = '🙈 收起答案';
  }

  function gradeNow(submissionId) {
    if (!state.cloud || typeof Cloud === 'undefined') { toast('实时批改需要班级服务器模式', 'err'); return; }
    var sub0 = byId(state.submissions, 'id', submissionId);
    var qid = sub0 && sub0.questionId;
    toast('AI 批改中，请稍候…', 'ok');
    Cloud.grade(submissionId).then(function () {
      return bootData();
    }).then(function () {
      if (qid) openAnswerBox(qid);
      toast('批改完成，结果已显示', 'ok');
      renderCurrent();
    }).catch(function (e) {
      toast('批改失败：' + (e && e.message ? e.message : e), 'err');
    });
  }

  function loadGradeConfig() {
    if (!state.cloud || !state.me || state.me.role !== 'admin') return;
    if (typeof Cloud === 'undefined' || !Cloud.getConfig) return;
    var st = $('#cfg-status');
    if (st) st.textContent = '检测中…';
    Cloud.getConfig().then(function (c) {
      $('#cfg-base').value = c.base || '';
      $('#cfg-model').value = c.model || '';
      $('#cfg-key').value = '';
      if (st) st.textContent = c.hasKey ? ('已配置：' + c.keyMask + '（Key 留空保存不会覆盖）') : '还没有配置 Key，实时批改未开启';
    }).catch(function (e) {
      if (st) st.textContent = '读取配置失败：' + (e && e.message ? e.message : e);
    });
  }

  function toggleAnswerBox(itemId) {
    var box = document.getElementById('ansbox-' + itemId);
    if (!box) return;
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) {
      var ta = box.querySelector('.inline-answer-text');
      if (ta) {
        ta.focus();
        if (ta.value.trim() && !confirm('这道题你已经写了草稿，要重新写吗？\n点「取消」保留草稿。')) {
          box.classList.add('hidden');
        }
      }
    }
  }

  function cancelAnswerBox(itemId) {
    var box = document.getElementById('ansbox-' + itemId);
    if (box) box.classList.add('hidden');
  }

  function addAnswerImages(itemId, fileList) {
    var files = Array.prototype.slice.call(fileList || []).filter(function (f) {
      return f && /^image\//.test(f.type || '');
    });
    if (!files.length) return;
    Promise.all(files.map(compressImage)).then(function (blobs) {
      var arr = state.answerImages[itemId] = state.answerImages[itemId] || [];
      blobs.forEach(function (b) { arr.push({ blob: b, url: URL.createObjectURL(b) }); });
      renderAnswerThumbs(itemId);
    }).catch(function (e) {
      toast('图片处理失败：' + (e && e.message ? e.message : e), 'err');
    });
  }

  function renderAnswerThumbs(itemId) {
    var box = document.getElementById('athumb-' + itemId);
    if (!box) return;
    var arr = state.answerImages[itemId] || [];
    box.innerHTML = arr.map(function (im, i) {
      return '<span class="ans-thumb"><img src="' + esc(im.url) + '" alt="">' +
        '<button type="button" data-action="rm-answer-image" data-id="' + esc(itemId) + '" data-idx="' + i + '">✕</button></span>';
    }).join('');
  }

  function clearAnswerImages(itemId) {
    (state.answerImages[itemId] || []).forEach(function (im) {
      if (im.url && im.url.indexOf('blob:') === 0) URL.revokeObjectURL(im.url);
    });
    delete state.answerImages[itemId];
    renderAnswerThumbs(itemId);
  }

  function submitInlineAnswer(itemId) {
    var it = byId(state.items, 'id', itemId);
    if (!it) return;
    var box = document.getElementById('ansbox-' + itemId);
    if (!box) return;
    var ta = box.querySelector('.inline-answer-text');
    var text = ta ? ta.value.trim() : '';
    var imgs = (state.answerImages[itemId] || []).slice();
    if (!text && !imgs.length) { toast('写点答案，或者上传手写/绘图再提交', 'err'); return; }

    var newIds = imgs.map(function () { return uid(); });
    var writes = imgs.map(function (im, i) {
      return DataStore.put('images', { id: newIds[i], blob: im.blob, type: 'image/jpeg', name: '' });
    });

    Promise.all(writes).then(function () {
      var sub = {
        id: uid(),
        questionId: it.id,
        subject: it.subject,
        questionText: it.question || '',
        answerText: text,
        answerImageIds: newIds,
        studentName: state.me ? state.me.displayName : '我',
        status: 'pending',
        grade: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      return DataStore.put('submissions', sub).then(function (saved) {
        sub = saved || sub;
        state.submissions = state.submissions.filter(function (x) { return x.id !== sub.id; }).concat([sub]);
        clearAnswerImages(itemId);
        if (ta) ta.value = '';
        box.classList.add('hidden');
        if (canAutoGrade()) {
          toast('已提交，AI 批改中…', 'ok');
          if (state.tab === 'answers') renderAnswers();
          else if (state.tab === 'items') renderItems();
          gradeNow(sub.id);
        } else {
          toast('已提交，等待批改（去「作答 / 批改」复制或导出发我）', 'ok');
          if (state.tab === 'answers') renderAnswers();
          else if (state.tab === 'items') renderItems();
        }
      });
    }).catch(function (e) {
      toast('提交失败：' + (e && e.message ? e.message : e), 'err');
    });
  }


  function submissionCardHTML(s) {
    var item = s.questionId ? byId(state.items, 'id', s.questionId) : null;
    var qText = s.questionText || (item && item.question) || '';
    var badge = s.status === 'graded'
      ? '<span class="badge st-mastered">已批改</span>'
      : '<span class="badge st-new">待批改</span>';
    var html = '<article class="card item-card" data-id="' + esc(s.id) + '">' +
      '<div class="item-head">' +
        '<span class="badge ' + subjectClass(s.subject) + '">' + esc(s.subject || '其他') + '</span>' +
        badge +
        (state.cloud && s.studentName ? '<span class="badge topic">' + esc(s.studentName) + '</span>' : '') +
        '<span class="grow"></span>' +
        '<button class="link danger" data-action="del-submission" data-id="' + esc(s.id) + '">删除</button>' +
      '</div>' +
      (qText ? '<div class="q-text">' + esc(qText) + '</div>' : '') +
      '<div class="answer-line"><b>我的答案：</b>' + renderMathText(s.answerText) + '</div>' +
      ((s.answerImageIds || []).length ? '<div class="thumbs">' +
        s.answerImageIds.map(function (id) {
          return '<div class="thumb"><img data-img="' + esc(id) + '" data-action="zoom" alt="我的作答图片"></div>';
        }).join('') + '</div>' : '');

    if (s.status === 'graded' && s.grade) {
      var g = s.grade;
      html += '<div class="graded-box">' +
        '<div class="score-row"><span class="score-num">' + esc(g.score) + ' / ' + esc(g.fullMarks) + '</span><span class="muted">得分</span></div>' +
        (g.standardAnswer ? '<div class="mine-line"><b>参考答案：</b>' + renderMathText(g.standardAnswer) + '</div>' : '') +
        ((g.points || []).length ? '<div class="scheme-items">' + g.points.map(function (p) {
          var ok = p.awarded >= p.max;
          return '<div class="scheme-item' + (ok ? '' : ' missed') + '"><span class="flag">' + (ok ? '✓' : '✗') + '</span><span>' +
            renderMathText(p.point) + (p.awarded + '/' + p.max) + (p.comment ? ' —— ' + renderMathText(p.comment) : '') + '</span></div>';
        }).join('') + '</div>' : '') +
        (g.comment ? '<div class="mine-line">📝 ' + renderMathText(g.comment) + '</div>' : '') +
        ((g.causes || []).length ? '<div class="chips">' + g.causes.map(function (c) {
          return '<span class="badge cause">' + esc(causeLabel(c)) + '</span>';
        }).join('') + '</div>' : '') +
        '</div>';
    } else {
      if (canAutoGrade()) {
        html += '<div class="answer-hidden pending-row">⏳ 等待批改 ' +
          '<button class="btn tiny primary" data-action="grade-now" data-id="' + esc(s.id) + '">⚡ 立即批改</button></div>';
      } else {
        html += '<div class="answer-hidden">等待批改：点上方「复制待批改」发我，或「导出批改包」。</div>';
      }
    }
    html += '</article>';
    return html;
  }

  function renderAnswers() {
    var box = $('#answers-list');
    if (!box) return;
    var filter = ($('#a-status') && $('#a-status').value) || '';
    var list = state.submissions.filter(function (s) {
      return !filter || s.status === filter;
    }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });

    if (!list.length) {
      box.innerHTML = '<div class="empty"><h3>还没有作答</h3>' +
        '<p>去「错题本」，在题目卡片上点「✍️ 作答」，写下你的答案再提交。</p></div>';
      return;
    }
    box.innerHTML = list.map(submissionCardHTML).join('');
    hydrateImages(box);
  }

  function deleteSubmission(id) {
    if (!confirm('删除这次作答？')) return;
    state.submissions = state.submissions.filter(function (x) { return x.id !== id; });
    DataStore.del('submissions', id).then(function () { renderAnswers(); });
  }

  function buildPendingSubs(pending) {
    return pending.map(function (s) {
      var it = s.questionId ? byId(state.items, 'id', s.questionId) : null;
      return {
        id: s.id,
        questionId: s.questionId,
        subject: s.subject,
        studentName: s.studentName || '',
        questionText: s.questionText || (it && it.question) || '',
        currentCorrectAnswer: it ? (it.correctAnswer || '') : '',
        currentMarkScheme: it ? (it.markScheme || []) : [],
        imageIds: it ? (it.imageIds || []) : [],
        questionHasImage: !!(it && (it.imageIds || []).length),
        answerText: s.answerText,
        createdAt: s.createdAt
      };
    });
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return false; });
    }
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return Promise.resolve(ok);
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function copyPending() {
    var pending = state.submissions.filter(function (s) { return s.status !== 'graded'; });
    if (!pending.length) { toast('没有待批改的作答，先去「错题本」做几题', 'err'); return; }
    var payload = {
      format: 'cuoti-grading',
      version: 1,
      exportedAt: new Date().toISOString(),
      submissions: buildPendingSubs(pending)
    };
    copyText(JSON.stringify(payload, null, 2)).then(function (ok) {
      if (ok) toast('已复制 ' + pending.length + ' 条待批改，粘贴到聊天框发给 AI 即可', 'ok');
      else toast('复制失败，请改用「导出批改包」', 'err');
    });
  }

  function openPasteGrades() {
    $('#paste-text').value = '';
    showModal('modal-paste');
    setTimeout(function () {
      var ta = $('#paste-text');
      if (ta) ta.focus();
    }, 50);
  }

  function applyPasteGrades() {
    var raw = $('#paste-text').value.trim();
    if (!raw) { toast('先粘贴批改结果', 'err'); return; }
    var data = null;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      var s = raw.indexOf('{');
      var e2 = raw.lastIndexOf('}');
      if (s >= 0 && e2 > s) {
        try { data = JSON.parse(raw.slice(s, e2 + 1)); } catch (e3) { data = null; }
      }
    }
    if (!data) { toast('解析失败：请把 AI 返回的整段 JSON 完整复制过来', 'err'); return; }
    var results = Array.isArray(data) ? data : (data.results || []);
    if (!results.length) { toast('里面没有 results 数组', 'err'); return; }
    applyGrades(results).then(function (applied) {
      hideModal('modal-paste');
      if (applied === 0) toast('没找到对应的作答记录（可能已被删除）', 'err');
    });
  }

  function exportGrading() {
    var pending = state.submissions.filter(function (s) { return s.status !== 'graded'; });
    if (!pending.length) { toast('没有待批改的作答，先去「错题本」做几题', 'err'); return; }

    var subs = buildPendingSubs(pending);

    var payload = { format: 'cuoti-grading', version: 1, exportedAt: new Date().toISOString(), submissions: subs };
    var files = [{ name: 'grading.json', data: new TextEncoder().encode(JSON.stringify(payload, null, 2)) }];
    var imgIds = [];
    subs.forEach(function (s) {
      (s.imageIds || []).forEach(function (id) { if (imgIds.indexOf(id) < 0) imgIds.push(id); });
    });
    var jobs = imgIds.map(function (id) {
      return DataStore.get('images', id).then(function (rec) {
        if (!rec || !rec.blob) return null;
        return rec.blob.arrayBuffer().then(function (buf) {
          return { name: 'images/' + id + '.jpg', data: new Uint8Array(buf) };
        });
      }).catch(function () { return null; });
    });
    Promise.all(jobs).then(function (arr) {
      arr.filter(Boolean).forEach(function (f) { files.push(f); });
      downloadBlob(MiniZip.create(files), '批改包-' + todayISO() + '.zip');
      toast('已导出 ' + subs.length + ' 条待批改作答', 'ok');
    }).catch(function (e) {
      toast('导出失败：' + (e && e.message ? e.message : e), 'err');
    });
  }

  function importGrades(entries) {
    var gEntry = entries.filter(function (e) { return e.name === 'grades.json'; })[0];
    if (!gEntry) throw new Error('批改结果包里找不到 grades.json');
    var data = JSON.parse(new TextDecoder().decode(gEntry.data));
    var results = data.results || [];
    if (!results.length) throw new Error('批改结果为空');
    return applyGrades(results);
  }

  /* 把批改结果应用到作答记录，并把标准答案写回题目 */
  function applyGrades(results) {
    var applied = 0;
    var updates = results.map(function (r) {
      var s = byId(state.submissions, 'id', r.submissionId);
      if (!s) return null;
      applied++;
      s.status = 'graded';
      s.grade = {
        standardAnswer: r.standardAnswer || '',
        score: r.score,
        fullMarks: r.fullMarks,
        comment: r.comment || '',
        causes: r.causes || [],
        points: r.points || []
      };
      s.updatedAt = new Date().toISOString();
      return DataStore.put('submissions', s).then(function () { return s; });
    }).filter(Boolean);

    return Promise.all(updates).then(function () {
      var itemJobs = [];
      results.forEach(function (r) {
        var s = byId(state.submissions, 'id', r.submissionId);
        if (!s || !s.questionId) return;
        var it = byId(state.items, 'id', s.questionId);
        if (!it) return;
        var changed = false;
        if (!it.correctAnswer && r.standardAnswer) { it.correctAnswer = r.standardAnswer; changed = true; }
        if (r.points && r.points.length) {
          it.markScheme = it.markScheme || [];
          r.points.forEach(function (p) {
            if (p.point && !it.markScheme.some(function (m) { return m.point === p.point; })) {
              it.markScheme.push({ point: p.point, missed: false });
              changed = true;
            }
          });
        }
        if (changed) {
          it.updatedAt = new Date().toISOString();
          itemJobs.push(DataStore.put('items', it).catch(function () { /* 非题主无权限，忽略 */ }));
        }
      });
      return Promise.all(itemJobs);
    }).then(function () {
      renderAnswers();
      if (state.tab === 'items') renderItems();
      if (applied > 0) toast('已批改 ' + applied + ' 条，结果已显示在作答卡片里', 'ok');
      return applied;
    });
  }

  // ======================= 收件箱（待转录） =======================
  function inboxCardHTML(e) {
    var subjectOptions = SUBJECTS.map(function (s) {
      return optionHTML(s, s, e.subject === s);
    }).join('');
    var when = String(e.createdAt || '').slice(0, 16).replace('T', ' ');
    return '<article class="card inbox-card" data-id="' + esc(e.id) + '">' +
      '<div class="thumb big" data-action="zoom"><img data-img="' + esc(e.imageId) + '" alt="待转录题目"></div>' +
      '<div class="inbox-meta">' +
        '<select class="select" data-inbox-subject="' + esc(e.id) + '">' + subjectOptions + '</select>' +
        '<span class="muted">' + esc(e.uploader || '未填上传者') + (when ? ' · ' + esc(when) : '') + '</span>' +
      '</div>' +
      '<textarea class="inbox-note" data-inbox-note="' + esc(e.id) + '" rows="2" placeholder="备注（可选）：这题考什么、哪里不懂">' + esc(e.note || '') + '</textarea>' +
      '<div class="inbox-actions"><span class="muted">等待转录</span><span class="grow"></span>' +
        '<button class="link danger" data-action="del-inbox" data-id="' + esc(e.id) + '">删除</button></div>' +
    '</article>';
  }

  function renderInbox() {
    var box = $('#inbox-list');
    if (!box) return;
    if (!state.inbox.length) {
      box.innerHTML = '<div class="empty"><h3>收件箱是空的</h3>' +
        '<p>把同学发来的题目照片放进来（可一次多选，也可以直接把图片拖进这个页面）。<br>' +
        '攒够一批后点「导出待转录包」，发给我转成文字。</p></div>';
      return;
    }
    var list = state.inbox.slice().sort(function (a, b) {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    box.innerHTML = list.map(inboxCardHTML).join('');
    hydrateImages(box);
  }

  function addInboxFiles(fileList) {
    var files = Array.prototype.slice.call(fileList).filter(function (f) {
      return f && /^image\//.test(f.type || '');
    });
    if (!files.length) return;
    var subject = ($('#inbox-subject') && $('#inbox-subject').value) || '化学';
    var uploader = (($('#inbox-uploader') && $('#inbox-uploader').value) || '').trim();

    Promise.all(files.map(compressImage)).then(function (blobs) {
      return Promise.all(blobs.map(function (blob) {
        var e = {
          id: uid(),
          subject: subject,
          uploader: uploader,
          note: '',
          imageId: uid(),
          createdAt: new Date().toISOString()
        };
        return DataStore.put('images', { id: e.imageId, blob: blob, type: 'image/jpeg', name: '' })
          .then(function () { return DataStore.put('inbox', e); })
          .then(function () { return e; });
      }));
    }).then(function (entries) {
      state.inbox = state.inbox.concat(entries);
      renderInbox();
      toast('已加入收件箱 ' + entries.length + ' 张，共 ' + state.inbox.length + ' 张待转录', 'ok');
    }).catch(function (err) {
      toast('添加失败：' + (err && err.message ? err.message : err), 'err');
    });
  }

  function deleteInboxEntry(id) {
    var e = byId(state.inbox, 'id', id);
    if (!e) return;
    if (!confirm('从收件箱删除这张？')) return;
    state.inbox = state.inbox.filter(function (x) { return x.id !== id; });
    revokeImage(e.imageId);
    Promise.all([DataStore.del('inbox', id), DataStore.del('images', e.imageId)]).then(function () {
      renderInbox();
    });
  }

  function exportInbox() {
    if (!state.inbox.length) {
      toast('收件箱是空的，先添加同学上传的题目图片', 'err');
      return;
    }
    var entries = state.inbox.map(function (e) {
      return {
        id: e.id,
        subject: e.subject,
        uploader: e.uploader || '',
        note: e.note || '',
        image: 'inbox/' + e.id + '.jpg',
        createdAt: e.createdAt
      };
    });
    var payload = { format: 'cuoti-inbox', version: 1, exportedAt: new Date().toISOString(), entries: entries };
    var files = [{ name: 'inbox.json', data: new TextEncoder().encode(JSON.stringify(payload, null, 2)) }];

    var jobs = state.inbox.map(function (e) {
      return DataStore.get('images', e.imageId).then(function (rec) {
        if (!rec || !rec.blob) return null;
        return rec.blob.arrayBuffer().then(function (buf) {
          return { name: 'inbox/' + e.id + '.jpg', data: new Uint8Array(buf) };
        });
      }).catch(function () { return null; });
    });

    Promise.all(jobs).then(function (arr) {
      var ok = arr.filter(function (f) { return !!f; });
      ok.forEach(function (f) { files.push(f); });
      var blob = MiniZip.create(files);
      downloadBlob(blob, '待转录-' + todayISO() + '.zip');
      toast('已导出 ' + ok.length + ' 张待转录图片（发给 AI 转录即可）', 'ok');
    }).catch(function (err) {
      toast('导出失败：' + (err && err.message ? err.message : err), 'err');
    });
  }

  /* 导入转录结果后，清理对应的收件箱条目（保留已入库的错题） */
  function resolveInbox(ids) {
    if (!ids || !ids.length) return Promise.resolve(0);
    var removed = [];
    state.inbox = state.inbox.filter(function (e) {
      if (ids.indexOf(e.id) >= 0) { removed.push(e); return false; }
      return true;
    });
    return Promise.all(removed.map(function (e) {
      revokeImage(e.imageId);
      return DataStore.del('inbox', e.id).then(function () { return DataStore.del('images', e.imageId); });
    })).then(function () {
      renderInbox();
      if (removed.length) toast('收件箱已清理 ' + removed.length + ' 张已转录条目', 'ok');
      return removed.length;
    });
  }

  // ======================= 导入导出 =======================
  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  function libraryPayload() {
    return {
      format: 'cuoti-library',
      version: 1,
      exportedAt: new Date().toISOString(),
      items: state.items,
      topics: state.topics
    };
  }

  function exportJSON() {
    var blob = new Blob([JSON.stringify(libraryPayload(), null, 2)], { type: 'application/json' });
    downloadBlob(blob, '错题站备份-' + todayISO() + '.json');
    toast('已导出 JSON（不含图片）', 'ok');
  }

  function exportZip() {
    var payload = libraryPayload();
    var files = [{ name: 'library.json', data: new TextEncoder().encode(JSON.stringify(payload)) }];
    var ids = [];
    state.items.forEach(function (it) {
      (it.imageIds || []).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    });
    var jobs = ids.map(function (id) {
      return DataStore.get('images', id).then(function (rec) {
        if (!rec || !rec.blob) return null;
        return rec.blob.arrayBuffer().then(function (buf) {
          return { name: 'images/' + id + '.jpg', data: new Uint8Array(buf) };
        });
      }).catch(function () { return null; });
    });
    Promise.all(jobs).then(function (arr) {
      var ok = arr.filter(function (f) { return !!f; });
      ok.forEach(function (f) { files.push(f); });
      var blob = MiniZip.create(files);
      downloadBlob(blob, '错题站题库包-' + todayISO() + '.zip');
      toast('已导出 ' + state.items.length + ' 道错题、' + ok.length + ' 张图片', 'ok');
    }).catch(function (e) {
      toast('导出失败：' + (e && e.message ? e.message : e), 'err');
    });
  }

  function handleImportFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var u8 = new Uint8Array(reader.result);
        if (u8[0] === 0x50 && u8[1] === 0x4B) {
          var entries = MiniZip.read(reader.result);
          if (entries.some(function (e) { return e.name === 'grades.json'; })) {
            importGrades(entries);
          } else {
            importZip(reader.result);
          }
        } else {
          importLibrary(JSON.parse(new TextDecoder().decode(u8)));
        }
      } catch (e) {
        console.error(e);
        toast('导入失败：' + (e && e.message ? e.message : e), 'err');
      }
    };
    reader.onerror = function () { toast('读取文件失败', 'err'); };
    reader.readAsArrayBuffer(file);
  }

  function importZip(buffer) {
    var entries = MiniZip.read(buffer);
    var libEntry = null;
    var resolved = null;
    var images = [];
    entries.forEach(function (e) {
      if (e.name === 'library.json') libEntry = e;
      else if (e.name === 'inbox-resolved.json') {
        try { resolved = JSON.parse(new TextDecoder().decode(e.data)); } catch (err) { resolved = null; }
      } else if (/^images\//.test(e.name)) images.push(e);
    });
    if (!libEntry) throw new Error('题库包里找不到 library.json');
    var lib = JSON.parse(new TextDecoder().decode(libEntry.data));
    var puts = images.map(function (e) {
      var id = e.name.replace(/^images\//, '').replace(/\.[^.]+$/, '');
      return DataStore.put('images', { id: id, blob: new Blob([e.data], { type: 'image/jpeg' }), type: 'image/jpeg', name: '' });
    });
    Promise.all(puts).then(function () {
      return importLibrary(lib, images.length);
    }).then(function () {
      if (resolved && resolved.resolved && resolved.resolved.length) {
        return resolveInbox(resolved.resolved);
      }
    }).catch(function (e) {
      toast('导入失败：' + (e && e.message ? e.message : e), 'err');
    });
  }

  function importLibrary(lib, imageCount) {
    if (!lib || lib.format !== 'cuoti-library' || !Array.isArray(lib.items)) {
      throw new Error('不是错题站导出的题库文件');
    }
    var topicMap = {};
    state.topics.forEach(function (t) { topicMap[t.id] = t; });
    (lib.topics || []).forEach(function (t) { topicMap[t.id] = t; });
    state.topics = Object.keys(topicMap).map(function (k) { return topicMap[k]; });

    var itemMap = {};
    state.items.forEach(function (it) { itemMap[it.id] = it; });
    (lib.items || []).forEach(function (it) {
      if (!it || !it.id) return;
      if (!it.review) it.review = { due: todayISO(), interval: 0, ease: 2.5, reps: 0 };
      if (!it.imageIds) it.imageIds = [];
      itemMap[it.id] = it;
    });
    state.items = Object.keys(itemMap).map(function (k) { return itemMap[k]; });

    return Promise.all([
      DataStore.putMany('items', state.items),
      DataStore.putMany('topics', state.topics),
      DataStore.put('meta', { key: 'seeded', value: true })
    ]).then(function () {
      rebuildFilters();
      renderCurrent();
      refreshReviewCounts();
      toast('导入完成：' + (lib.items || []).length + ' 道错题' + (imageCount ? '、' + imageCount + ' 张图片' : ''), 'ok');
    });
  }

  function clearAll() {
    if (!confirm('确定要清空全部数据吗？此操作不可恢复，建议先导出题库包备份。')) return;
    if (!confirm('再确认一次：删除本机全部错题、知识点和图片？')) return;
    DataStore.clearAll().then(function () {
      Object.keys(state.imageUrls).forEach(function (id) { URL.revokeObjectURL(state.imageUrls[id]); });
      state.imageUrls = {};
      state.items = [];
      state.topics = [];
      state.inbox = [];
      state.review = { queue: [], idx: 0, revealed: false, done: 0, again: 0 };
      rebuildFilters();
      renderCurrent();
      refreshReviewCounts();
      toast('已清空', 'ok');
    }).catch(function (e) {
      toast('清空失败：' + (e && e.message ? e.message : e), 'err');
    });
  }

  // ======================= 事件 =======================
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!el) return;
      var action = el.getAttribute('data-action');
      var id = el.getAttribute('data-id');

      if (action === 'tab') { showTab(el.getAttribute('data-tab')); return; }
      if (action === 'new-item') { openEditor(null); return; }
      if (action === 'edit-item') { openEditor(id); return; }
      if (action === 'delete-item') { deleteItem(id); return; }
      if (action === 'toggle-mastered') { toggleMastered(id); return; }
      if (action === 'close-editor') { hideModal('modal-editor'); state.editing = null; return; }
      if (action === 'save-item') { saveItem(); return; }
      if (action === 'add-ms') { $('#e-ms').insertAdjacentHTML('beforeend', msRowHTML('', false)); return; }
      if (action === 'toggle-answer-fields') {
        var blk = $('#e-answer-block');
        var tg = $('#e-answer-toggle');
        if (!blk) return;
        blk.classList.toggle('hidden');
        if (tg) tg.textContent = blk.classList.contains('hidden') ? '▸ 已有答案？展开填写（可留空）' : '▾ 收起答案区';
        return;
      }
      if (action === 'del-ms') {
        var row = el.parentNode;
        if ($$('.ms-row', $('#e-ms')).length > 1) row.remove();
        else { $('.ms-text', row).value = ''; }
        return;
      }
      if (action === 'toggle-cause') { el.classList.toggle('on'); return; }
      if (action === 'rm-image') { removeEditorImage(parseInt(el.getAttribute('data-idx'), 10)); return; }
      if (action === 'reveal-card') {
        var target = document.getElementById(el.getAttribute('data-target'));
        if (!target) return;
        var nowHidden = target.classList.toggle('hidden');
        el.textContent = nowHidden ? '👀 查看答案' : '🙈 收起答案';
        if (!nowHidden) ensureAnswer(el.getAttribute('data-item'));
        return;
      }
      if (action === 'zoom') {
        var img = el.tagName === 'IMG' ? el : el.querySelector('img');
        if (img && img.src) { $('#modal-image-src').src = img.src; showModal('modal-image'); }
        return;
      }
      if (action === 'close-image') { hideModal('modal-image'); return; }
      if (action === 'new-topic') { openTopicEditor(null); return; }
      if (action === 'edit-topic') { openTopicEditor(id); return; }
      if (action === 'delete-topic') { deleteTopic(id); return; }
      if (action === 'close-topic') { hideModal('modal-topic'); state.editingTopic = null; return; }
      if (action === 'save-topic') { saveTopic(); return; }
      if (action === 'filter-topic') {
        var tid = el.getAttribute('data-topic');
        state.filters.topic = tid;
        rebuildFilters();
        $('#f-topic').value = tid;
        if (state.tab !== 'items') showTab('items'); else renderCurrent();
        return;
      }
      if (action === 'print') { window.print(); return; }
      if (action === 'start-review') { startReview(); return; }
      if (action === 'reveal') { state.review.revealed = true; renderReviewStage(); return; }
      if (action === 'rate') { rate(el.getAttribute('data-rate')); return; }
      if (action === 'grade-now') { gradeNow(id); return; }
      if (action === 'rm-answer-image') {
        var aid = el.getAttribute('data-id');
        var aidx = parseInt(el.getAttribute('data-idx'), 10);
        var aimg = (state.answerImages[aid] || [])[aidx];
        if (aimg && aimg.url && aimg.url.indexOf('blob:') === 0) URL.revokeObjectURL(aimg.url);
        if (state.answerImages[aid]) state.answerImages[aid].splice(aidx, 1);
        renderAnswerThumbs(aid);
        return;
      }
      if (action === 'tag-item') { tagItem(id); return; }
      if (action === 'crop-figure') { autoCropFigure(id); return; }
      if (action === 'restore-image') { restoreImage(id); return; }
      if (action === 'toggle-group') { state.groupMode = !state.groupMode; renderItems(); return; }
      if (action === 'transcribe-item') { transcribeItem(id); return; }
      if (action === 'copy-question') { copyItemQuestion(id); return; }
      if (action === 'remove-images') { removeItemImages(id); return; }
      if (action === 'toggle-thumbs') {
        var thumbBox = document.getElementById(el.getAttribute('data-target'));
        if (!thumbBox) return;
        var nowHidden = thumbBox.classList.toggle('hidden');
        el.textContent = nowHidden ? '🖼 查看原图' : '🙈 隐藏原图';
        return;
      }
      if (action === 'save-grade-config') {
        var cfg = {
          base: ($('#cfg-base') && $('#cfg-base').value.trim()) || '',
          model: ($('#cfg-model') && $('#cfg-model').value.trim()) || ''
        };
        var k = ($('#cfg-key') && $('#cfg-key').value.trim()) || '';
        if (k) cfg.key = k;
        Cloud.saveConfig(cfg).then(function (res) {
          if (Cloud.health) Cloud.health.autoGrade = !!res.autoGrade;
          toast(res.autoGrade ? '已保存，实时批改已开启' : '已保存（还没有 Key，实时批改未开启）', 'ok');
          $('#cfg-key').value = '';
          loadGradeConfig();
        }).catch(function (e) { toast('保存失败：' + (e && e.message ? e.message : e), 'err'); });
        return;
      }
      if (action === 'copy-pending') { copyPending(); return; }
      if (action === 'paste-grades') { openPasteGrades(); return; }
      if (action === 'close-paste') { hideModal('modal-paste'); return; }
      if (action === 'apply-paste') { applyPasteGrades(); return; }
      if (action === 'export-grading') { exportGrading(); return; }
      if (action === 'import-grades') { $('#grades-file').click(); return; }
      if (action === 'answer-item') { generateAnswer(id); return; }
      if (action === 'toggle-answer-box') { toggleAnswerBox(id); return; }
      if (action === 'cancel-inline-answer') { cancelAnswerBox(id); return; }
      if (action === 'submit-inline-answer') { submitInlineAnswer(id); return; }
      if (action === 'del-submission') { deleteSubmission(id); return; }
      if (action === 'export-zip') { exportZip(); return; }
      if (action === 'export-json') { exportJSON(); return; }
      if (action === 'export-inbox') { exportInbox(); return; }
      if (action === 'del-inbox') { deleteInboxEntry(id); return; }
      if (action === 'import') { $('#import-file').click(); return; }
      if (action === 'seed') {
        applySeed(false).then(function () {
          rebuildFilters();
          renderCurrent();
          refreshReviewCounts();
        }).catch(function (err) { toast('载入失败：' + err.message, 'err'); });
        return;
      }
      if (action === 'clear-all') { clearAll(); return; }
      if (action === 'refresh') {
        bootData().then(function () {
          rebuildFilters();
          renderCurrent();
          toast('已刷新', 'ok');
        });
        return;
      }
      if (action === 'logout') {
        if (!confirm('退出登录？')) return;
        Cloud.logout().then(function () { location.href = 'login.html'; });
        return;
      }
    });

    // 筛选
    $('#f-search').addEventListener('input', function (e) {
      state.filters.q = e.target.value;
      renderItems();
    });
    $('#f-subject').addEventListener('change', function (e) { state.filters.subject = e.target.value; renderItems(); });
    $('#f-topic').addEventListener('change', function (e) { state.filters.topic = e.target.value; renderItems(); });
    $('#f-cause').addEventListener('change', function (e) { state.filters.cause = e.target.value; renderItems(); });
    $('#f-status').addEventListener('change', function (e) { state.filters.status = e.target.value; renderItems(); });
    $('#topic-search').addEventListener('input', renderTopics);
    $('#s-subject').addEventListener('change', renderScheme);
    $('#s-missed').addEventListener('change', renderScheme);
    $('#a-status').addEventListener('change', renderAnswers);
    $('#grades-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      handleImportFile(f);
    });

    // 收件箱
    $('#inbox-file').addEventListener('change', function (e) {
      addInboxFiles(e.target.files);
      e.target.value = '';
    });
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || !t.classList) return;
      if (t.classList.contains('answer-file')) {
        addAnswerImages(t.getAttribute('data-id'), t.files);
        t.value = '';
        return;
      }
      if (t.classList.contains('inbox-note')) {
        var entry2 = byId(state.inbox, 'id', t.getAttribute('data-inbox-note'));
        if (entry2) { entry2.note = t.value; DataStore.put('inbox', entry2); }
        return;
      }
      var sid = t.getAttribute('data-inbox-subject');
      if (sid) {
        var entry = byId(state.inbox, 'id', sid);
        if (entry) { entry.subject = t.value; DataStore.put('inbox', entry); }
      }
    });
    (function () {
      var panel = $('#panel-inbox');
      if (!panel) return;
      ['dragenter', 'dragover'].forEach(function (ev) {
        panel.addEventListener(ev, function (e) { e.preventDefault(); panel.classList.add('drop-hot'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        panel.addEventListener(ev, function (e) { e.preventDefault(); panel.classList.remove('drop-hot'); });
      });
      panel.addEventListener('drop', function (e) {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          addInboxFiles(e.dataTransfer.files);
        }
      });
    })();

    // 编辑器
    $('#e-file').addEventListener('change', function (e) {
      addImageFiles(e.target.files);
      e.target.value = '';
    });
    document.addEventListener('paste', function (e) {
      if (!state.editing || $('#modal-editor').classList.contains('hidden')) return;
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      var files = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          var f = items[i].getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) { e.preventDefault(); addImageFiles(files); }
    });

    // 导入
    $('#import-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      handleImportFile(f);
    });

    // ESC 关闭弹窗
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        ['modal-editor', 'modal-topic', 'modal-image'].forEach(function (m) {
          if (!$('#' + m).classList.contains('hidden')) hideModal(m);
        });
      }
    });
  }

  // ======================= 启动 =======================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
