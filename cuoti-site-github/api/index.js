/* 错题站 · Vercel 版本后端（Serverless 单文件）
 *
 * 路由：/api/* 全部由本函数处理（见项目根 vercel.json 的 rewrite）
 * 存储：
 *   - 数据（账号/错题/作答/配置）：Vercel KV（一个 JSON 文档），本地无环境变量时用内存模拟
 *   - 图片：Vercel Blob；本地无环境变量时存内存
 *
 * 环境变量（Vercel 控制台会自动注入）：
 *   KV_REST_API_URL / KV_REST_API_TOKEN   ← 连接 Vercel KV 后自动有
 *   BLOB_READ_WRITE_TOKEN                 ← 连接 Vercel Blob 后自动有
 *   可选：REGISTER_CODE（注册邀请码）
 */
'use strict';

const crypto = require('crypto');
const path = require('path');

// ---------------- 存储层（KV 分块 或 内存） ----------------
const DB_KEY = 'cuoti:db';                 // 旧版单键（仅兼容读取）
const DB_META_KEY = 'cuoti:db:meta';       // { v:2, chunks, size, updatedAt }
const DB_CHUNK_PREFIX = 'cuoti:db:';
const CHUNK_BYTES = 400 * 1024;            // 每块 400KB（Vercel KV 单次请求约 1MB 上限）

let memoryDB = null;
let memoryBlobs = {};

function useKV() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}
function useBlob() {
  return !!(process.env.BLOB_ACCESS_TOKEN || process.env.BLOB_READ_WRITE_TOKEN);
}

// 按 UTF-8 字节数切分（中文一个字 3 字节，不能按字符数切）
function splitByBytes(str, maxBytes) {
  const out = [];
  let buf = '';
  let size = 0;
  for (const ch of str) {
    const chSize = Buffer.byteLength(ch, 'utf8');
    if (size + chSize > maxBytes && buf) {
      out.push(buf);
      buf = '';
      size = 0;
    }
    buf += ch;
    size += chSize;
  }
  if (buf) out.push(buf);
  return out;
}

async function readDB() {
  if (useKV()) {
    const kv = require('@vercel/kv').kv;
    try {
      const meta = await kv.get(DB_META_KEY);
      if (meta && meta.v === 2 && meta.chunks > 0) {
        const keys = [];
        for (let i = 0; i < meta.chunks; i++) keys.push(DB_CHUNK_PREFIX + i);
        const parts = await kv.mget(keys);
        const raw = (parts || []).filter(function (x) { return typeof x === 'string'; }).join('');
        if (raw) return JSON.parse(raw);
      }
      // 兼容旧版单键
      const legacy = await kv.get(DB_KEY);
      if (typeof legacy === 'string') return JSON.parse(legacy);
      if (legacy && typeof legacy === 'object') return legacy;
    } catch (e) {
      console.error('[kv] read failed:', e && e.message);
    }
    return emptyDB();
  }
  if (!memoryDB) memoryDB = emptyDB();
  return memoryDB;
}

async function writeDB(db) {
  if (useKV()) {
    const kv = require('@vercel/kv').kv;
    const raw = JSON.stringify(db);
    const chunks = splitByBytes(raw, CHUNK_BYTES);
    const prev = await kv.get(DB_META_KEY);
    const prevChunks = (prev && prev.v === 2 && prev.chunks) || 0;
    for (let i = 0; i < chunks.length; i++) {
      await kv.set(DB_CHUNK_PREFIX + i, chunks[i]);
    }
    // 清理收缩后多余的旧分块
    for (let i = chunks.length; i < prevChunks; i++) {
      await kv.del(DB_CHUNK_PREFIX + i);
    }
    await kv.set(DB_META_KEY, {
      v: 2,
      chunks: chunks.length,
      size: Buffer.byteLength(raw, 'utf8'),
      updatedAt: new Date().toISOString()
    });
    return;
  }
  memoryDB = db;
}

function emptyDB() {
  return {
    users: [],
    sessions: {},
    items: [],
    topics: [],
    inbox: [],
    submissions: [],
    progress: [],
    images: {},
    config: {
      gradeBase: 'https://open.bigmodel.cn/api/paas/v4',
      gradeModel: 'glm-5.3-flash',
      gradeKey: ''
    }
  };
}

function normalizeDB(db) {
  const base = emptyDB();
  return Object.assign(base, db || {}, {
    users: (db && db.users) || [],
    items: (db && db.items) || [],
    topics: (db && db.topics) || [],
    inbox: (db && db.inbox) || [],
    submissions: (db && db.submissions) || [],
    progress: (db && db.progress) || [],
    sessions: (db && db.sessions) || {},
    images: (db && db.images) || {},
    config: Object.assign(base.config, (db && db.config) || {})
  });
}

async function saveImage(id, buffer, contentType) {
  if (useBlob()) {
    const { put } = require('@vercel/blob');
    const blob = await put('cuoti/' + id + '.jpg', buffer, {
      access: 'public',
      contentType: contentType || 'image/jpeg',
      addRandomSuffix: false
    });
    return blob.url;
  }
  memoryBlobs[id] = { buffer: buffer, type: contentType || 'image/jpeg' };
  return 'memory://' + id;
}

async function readImage(url) {
  if (!url) return null;
  if (url.indexOf('memory://') === 0) {
    const rec = memoryBlobs[url.slice('memory://'.length)];
    return rec ? rec.buffer : null;
  }
  const resp = await fetch(url);
  if (!resp.ok) return null;
  return Buffer.from(await resp.arrayBuffer());
}

// ---------------- HTTP 工具 ----------------
function sendJSON(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}
function sendText(res, status, text, type) {
  const body = Buffer.from(text, 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', type || 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.end(body);
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    if (Buffer.isBuffer(req.body)) { resolve(req.body); return; }
    if (req.body && typeof req.body === 'object') { resolve(Buffer.from(JSON.stringify(req.body))); return; }
    if (typeof req.body === 'string') { resolve(Buffer.from(req.body)); return; }
    const chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}
async function readJSON(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(function (part) {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    out[k] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

// ---------------- 账号 ----------------
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}
function genId(prefix) {
  return (prefix || 'x') + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}
function nowISO() { return new Date().toISOString(); }

function publicUser(u) {
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role, createdAt: u.createdAt };
}
function currentUser(db, req) {
  const token = parseCookies(req.headers.cookie).sid;
  if (!token) return null;
  const sess = db.sessions[token];
  if (!sess) return null;
  const user = db.users.filter(function (u) { return u.id === sess.userId; })[0];
  if (!user || user.disabled) return null;
  return user;
}
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', 'sid=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure');
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
}

// ---------------- AI 批改 ----------------
function extractMessageText(data) {
  const msg = data && data.choices && data.choices[0] && data.choices[0].message;
  if (!msg) return '';
  const c = msg.content;
  if (typeof c === 'string') return c.trim();
  if (Array.isArray(c)) {
    return c.map(function (p) { return typeof p === 'string' ? p : ((p && (p.text || p.content)) || ''); }).join('').trim();
  }
  return '';
}
function modelEmptyError(data) {
  const choice = data && data.choices && data.choices[0];
  const fr = choice && choice.finish_reason;
  return new Error('模型返回为空（finish_reason=' + (fr || '未知') + '）。请重试；如果反复出现，把模型换成 glm-5.3-flashx');
}
function extractJSON(text) {
  try { return JSON.parse(text); } catch (e) {}
  const s = String(text).indexOf('{');
  const e = String(text).lastIndexOf('}');
  if (s >= 0 && e > s) { try { return JSON.parse(String(text).slice(s, e + 1)); } catch (err) {} }
  return null;
}

async function callGradeAPI(cfg, sub, item, imageMap) {
  const questionText = (item && item.question) || sub.questionText || '';
  const imageIds = (item && item.imageIds) || [];
  if (!questionText && !imageIds.length) throw new Error('这道题没有题干也没有图片，无法批改');

  const parts = ['请批改下面这道题的学生作答。'];
  if (questionText) parts.push('【题目文字】\n' + questionText);
  if (item && item.correctAnswer) parts.push('【题库已有参考答案】\n' + item.correctAnswer);
  if (item && item.markScheme && item.markScheme.length) {
    parts.push('【已有得分点】\n' + item.markScheme.map(function (m) { return '- ' + m.point; }).join('\n'));
  }
  parts.push('【学生作答（文字）】\n' + (sub.answerText || '（无文字作答，见下方学生手写/绘图图片）'));
  if (sub.answerImageIds && sub.answerImageIds.length) {
    parts.push('【学生作答（手写/绘图）】\n下面是学生上传的手写或绘图作答，请结合图片判分。');
  }
  parts.push('请先独立解出标准答案，再逐点判分。选择题满分 1 分；计算/简答默认 5 分；若题目里能判断分值以题目为准。');

  const content = [{ type: 'text', text: parts.join('\n\n') }];
  for (let i = 0; i < imageIds.length; i++) {
    const url = (imageMap || {})[imageIds[i]] || null;
    const buf = await readImage(url);
    if (buf && buf.length) {
      content.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + buf.toString('base64') } });
    }
  }

  const sys = '你是一位严格但耐心的中学老师。请批改学生作答：先给出标准答案，再按得分点判分。' +    '如果题目要求作图/画图（函数图像、几何图、示意图等），standardAnswer 必须列出可对照的关键特征：图形形状、截距、渐近线、极值点、关键点坐标、需要标注的要素；能写出方程时同时给出方程。' +

    '标准答案和得分点里的数学公式请用 $...$ 包裹的 LaTeX（如 $\\frac{dy}{dx}$、$\\sqrt{x}$、$x^2$）；多行推导用 $$\\begin{aligned} ... \\end{aligned}$$，每行用 \\\\ 分隔；方程组用 $$\\begin{cases} ... \\end{cases}$$。' +
    '只输出一个 JSON 对象，不要输出任何其他文字、不要用 markdown 代码块。JSON 结构：' +
    '{"standardAnswer":"标准答案","score":得分数字,"fullMarks":满分数字,' +
    '"points":[{"point":"得分点","awarded":得分,"max":分值,"comment":"说明"}],' +
    '"comment":"总体点评（1-3 句）","causes":["K"]}。causes 取值：K=知识没掌握，M=方法/思路，C=计算，E=表达或审题问题。';

  const url = cfg.gradeBase.replace(/\/+$/, '') + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.gradeKey },
    body: JSON.stringify({
      model: cfg.gradeModel,
      reasoning_effort: /^glm-5/i.test(String(cfg.gradeModel || '')) ? 'low' : undefined,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: content }],
      temperature: 0.2,
      max_tokens: 2500
    })
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error('接口返回 ' + resp.status + '：' + String(t).slice(0, 200));
  }
  const data = await resp.json();
  const raw = extractMessageText(data);
  if (!raw) { console.error('[api] empty response:', JSON.stringify(data).slice(0, 300)); throw modelEmptyError(data); }
  const parsed = extractJSON(raw);
  if (!parsed) throw new Error('模型返回的不是合法 JSON');
  return {
    standardAnswer: String(parsed.standardAnswer || ''),
    score: Number(parsed.score) || 0,
    fullMarks: Number(parsed.fullMarks) || 1,
    comment: String(parsed.comment || ''),
    causes: Array.isArray(parsed.causes) ? parsed.causes.filter(function (c) { return ['K', 'M', 'C', 'E'].indexOf(c) >= 0; }) : [],
    points: Array.isArray(parsed.points) ? parsed.points.map(function (p) {
      return {
        point: String(p.point || ''),
        awarded: Number(p.awarded) || 0,
        max: Number(p.max) || 0,
        comment: String(p.comment || '')
      };
    }).filter(function (p) { return p.point; }) : []
  };
}

// ---------------- 图片转文字（OCR） ----------------
async function callTranscribeAPI(cfg, item, imageMap) {
  const imageIds = (item && item.imageIds) || [];
  if (!imageIds.length) throw new Error('这道题没有图片');

  const content = [{
    type: 'text',
    text: '请识别图片中的题目，并以 JSON 返回：{"text":"题目文字","hasImage":true 或 false}\n' +
      'text 要求：\n' +
      '1. 保留题号、选项、单位、数字，不要遗漏\n' +
      '2. 所有数学公式用 $...$ 包裹的 LaTeX（如 $\\frac{1}{2}$、$x^2$、$\\sqrt{3}$、$H_2O$），普通文字不要放进 $...$\n' +
      '3. 不要添加答案、解析或解释\n' +
      '4. 保留原题的换行和版式：每个选项单独一行，题干分行的保持分行\n' +
      '5. 方程组请写成 LaTeX 的 cases 多行环境（每行一个方程，行与行之间用两个反斜杠分隔）\n' +
      '6. 如果图片里有多道题，按顺序全部输出\n' +
      '7. 不要使用 Markdown 符号（*、#、`）\n' +
      'hasImage 含义：这道题是否包含"必须看图才能作答"的内容（几何图形、函数图像、坐标图、数据表格、实验装置图、示意图等）。\n' +
      '如果纯文字就能完整表达题目（如解方程、文字应用题、纯公式推导），hasImage 为 false。\n' +
      '只输出 JSON，不要输出其它内容。'
  }];
  for (let i = 0; i < imageIds.length; i++) {
    const buf = await readImage((imageMap || {})[imageIds[i]]);
    if (buf && buf.length) {
      content.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + buf.toString('base64') } });
    }
  }

  const url = cfg.gradeBase.replace(/\/+$/, '') + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.gradeKey },
    body: JSON.stringify({
      model: cfg.gradeModel,
      reasoning_effort: /^glm-5/i.test(String(cfg.gradeModel || '')) ? 'low' : undefined,
      messages: [
        { role: 'system', content: '你是一个把题目图片转成文字的 OCR 助手，按要求的 JSON 格式输出。' },
        { role: 'user', content: content }
      ],
      temperature: 0.1,
      max_tokens: 2000
    })
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error('接口返回 ' + resp.status + '：' + String(t).slice(0, 200));
  }
  const data = await resp.json();
  const raw = extractMessageText(data);
  if (!raw) { console.error('[api] empty response:', JSON.stringify(data).slice(0, 300)); throw modelEmptyError(data); }

  const parsed = extractJSON(raw);
  if (parsed && typeof parsed.text === 'string') {
    return { text: parsed.text.trim(), hasImage: parsed.hasImage === true };
  }
  return { text: String(raw).trim(), hasImage: true };
}

// ---------------- AI 识别 IB 知识点 ----------------
async function callTagAPI(cfg, item, imageMap) {
  const imageIds = (item && item.imageIds) || [];
  const parts = [];
  parts.push('这是一道 IB DP 学生的错题，请判断它属于哪门学科、哪个 IB DP 知识点。');
  if (item.question) parts.push('【题目文字】\n' + item.question);
  if (!item.question && !imageIds.length) throw new Error('这道题没有题干也没有图片');
  parts.push('学科只能从这个列表里选：数学 AA、数学 AI、物理、化学、生物、经济、商业管理、历史、地理、哲学、中文 A、英语 A、英语 B、TOK。');
  parts.push('知识点命名要求：\n' +
    '- 物理：用 IB DP 物理大纲主题（A. Space, time and motion / B. The particulate nature of matter / C. Wave behaviour / D. Fields / E. Nuclear and quantum physics），可写到二级，如 "D.2 Gravitational fields"\n' +
    '- 化学：Structure 1-3 / Reactivity 1-2 的对应主题\n' +
    '- 数学：Number and algebra / Functions / Geometry and trigonometry / Statistics and probability / Calculus\n' +
    '- 其他科目：用 IB 大纲里的 topic 名称\n' +
    '最多 3 个知识点，从最相关开始。只输出 JSON：{"subject":"学科","topics":["知识点1","知识点2"],"confidence":"high 或 medium 或 low"}');

  const content = [{ type: 'text', text: parts.join('\n\n') }];
  for (let i = 0; i < imageIds.length; i++) {
    const buf = await readImage((imageMap || {})[imageIds[i]]);
    if (buf && buf.length) {
      content.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + buf.toString('base64') } });
    }
  }

  const url = cfg.gradeBase.replace(/\/+$/, '') + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.gradeKey },
    body: JSON.stringify({
      model: cfg.gradeModel,
      reasoning_effort: /^glm-5/i.test(String(cfg.gradeModel || '')) ? 'low' : undefined,
      messages: [
        { role: 'system', content: '你是熟悉 IB DP 课程大纲的老师，只输出 JSON。' },
        { role: 'user', content: content }
      ],
      temperature: 0.1,
      max_tokens: 1500
    })
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error('接口返回 ' + resp.status + '：' + String(t).slice(0, 200));
  }
  const data = await resp.json();
  const raw = extractMessageText(data);
  if (!raw) { console.error('[api] empty response:', JSON.stringify(data).slice(0, 300)); throw modelEmptyError(data); }
  const parsed = extractJSON(raw);
  if (!parsed) throw new Error('模型返回的不是合法 JSON');
  return {
    subject: String(parsed.subject || '').trim(),
    topics: Array.isArray(parsed.topics) ? parsed.topics.map(function (t) { return String(t).trim(); }).filter(Boolean).slice(0, 3) : [],
    confidence: String(parsed.confidence || '')
  };
}

// ---------------- AI 定位图形区域（自动裁剪用） ----------------
async function callFigureAPI(cfg, item, imageMap) {
  const imageIds = (item && item.imageIds) || [];
  if (!imageIds.length) throw new Error('这道题没有图片');
  const buf = await readImage((imageMap || {})[imageIds[0]]);
  if (!buf || !buf.length) throw new Error('图片文件不存在');

  const prompt = '这是一道题目图片，可能同时包含题干文字和图形（坐标图、函数图像、几何图、示意图、表格等）。\n' +
    '请找出"图形/图表"部分所在的矩形区域，用相对坐标返回（图片左上角为 (0,0)，右下角为 (1,1)）：\n' +
    '{"found": true 或 false, "box": {"x": 0.5, "y": 0.05, "w": 0.45, "h": 0.9}, "note": "简述图形内容"}\n' +
    '要求：\n' +
    '1. box 必须完整包住图形，不要包含题干文字\n' +
    '2. 如果图片里没有图形（纯文字题），found 为 false，box 全 0\n' +
    '3. 只输出 JSON，不要解释';

  const url = cfg.gradeBase.replace(/\/+$/, '') + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.gradeKey },
    body: JSON.stringify({
      model: cfg.gradeModel,
      messages: [
        { role: 'system', content: '你是图像版面分析助手，能定位题目中的图形区域，只输出 JSON。' },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + buf.toString('base64') } }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 800,
      reasoning_effort: /^glm-5/i.test(String(cfg.gradeModel || '')) ? 'low' : undefined
    })
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error('接口返回 ' + resp.status + '：' + String(t).slice(0, 200));
  }
  const data = await resp.json();
  const raw = extractMessageText(data);
  if (!raw) throw modelEmptyError(data);
  const parsed = extractJSON(raw);
  if (!parsed) throw new Error('模型返回的不是合法 JSON');
  const box = parsed.box || {};
  const num = function (v) { var n = Number(v); return isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; };
  return {
    found: parsed.found === true,
    box: { x: num(box.x), y: num(box.y), w: num(box.w), h: num(box.h) },
    note: String(parsed.note || '')
  };
}

// ---------------- 主处理 ----------------
const IMAGE_ID_RE = /^[A-Za-z0-9_-]{3,80}$/;
const REGISTER_CODE = String(process.env.REGISTER_CODE || '').trim();

module.exports = async function handler(req, res) {
  let url;
  try {
    url = new URL(req.url, 'https://' + (req.headers.host || 'localhost'));
  } catch (e) {
    return sendText(res, 400, '400 Bad Request');
  }
  let pathname;
  const hinted = req.headers['x-cuoti-path'];
  if (hinted) {
    try {
      pathname = decodeURIComponent(new URL(String(hinted), 'https://x').pathname);
    } catch (e) {
      pathname = String(hinted).split('?')[0];
    }
  } else {
    pathname = decodeURIComponent(url.pathname);
  }

  if (pathname.indexOf('/api/') !== 0) {
    return sendText(res, 404, '404 Not Found');
  }

  try {
    const db = normalizeDB(await readDB());
    const user = currentUser(db, req);
    const method = req.method;

    // health
    if (pathname === '/api/health') {
      return sendJSON(res, 200, {
        ok: true,
        app: 'cuoti-cloud',
        version: 1,
        serverless: true,
        storage: useKV() ? 'kv' : 'memory',
        blob: useBlob() ? 'blob' : 'memory',
        registerCodeRequired: !!REGISTER_CODE,
        autoGrade: !!db.config.gradeKey
      });
    }

    // register
    if (pathname === '/api/register' && method === 'POST') {
      const body = await readJSON(req);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      const displayName = String(body.displayName || '').trim() || username;
      if (!/^[a-z0-9_]{2,24}$/.test(username)) return sendJSON(res, 400, { error: '用户名只能用小写字母/数字/下划线，2-24 位' });
      if (password.length < 4) return sendJSON(res, 400, { error: '密码至少 4 位' });
      if (REGISTER_CODE && String(body.code || '').trim() !== REGISTER_CODE) {
        return sendJSON(res, 403, { error: '邀请码不正确（请向管理员索要）' });
      }
      if (db.users.some(function (u) { return u.username === username; })) return sendJSON(res, 409, { error: '用户名已被占用' });

      const salt = crypto.randomBytes(16).toString('hex');
      const u = {
        id: genId('u'),
        username: username,
        displayName: displayName,
        salt: salt,
        hash: hashPassword(password, salt),
        role: db.users.length === 0 ? 'admin' : 'student',
        disabled: false,
        createdAt: nowISO()
      };
      db.users.push(u);
      const token = crypto.randomBytes(24).toString('hex');
      db.sessions[token] = { userId: u.id, createdAt: nowISO() };
      await writeDB(db);
      setSessionCookie(res, token);
      return sendJSON(res, 200, { user: publicUser(u) });
    }

    // login
    if (pathname === '/api/login' && method === 'POST') {
      const body = await readJSON(req);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      const u = db.users.filter(function (x) { return x.username === username; })[0];
      if (!u || u.disabled) return sendJSON(res, 401, { error: '用户名或密码错误' });
      if (hashPassword(password, u.salt) !== u.hash) return sendJSON(res, 401, { error: '用户名或密码错误' });
      const token = crypto.randomBytes(24).toString('hex');
      db.sessions[token] = { userId: u.id, createdAt: nowISO() };
      await writeDB(db);
      setSessionCookie(res, token);
      return sendJSON(res, 200, { user: publicUser(u) });
    }

    // logout
    if (pathname === '/api/logout' && method === 'POST') {
      const token = parseCookies(req.headers.cookie).sid;
      if (token && db.sessions[token]) {
        delete db.sessions[token];
        await writeDB(db);
      }
      clearSessionCookie(res);
      return sendJSON(res, 200, { ok: true });
    }

    // me
    if (pathname === '/api/me' && method === 'GET') {
      if (!user) return sendJSON(res, 401, { error: '未登录' });
      return sendJSON(res, 200, { user: publicUser(user) });
    }

    if (!user) return sendJSON(res, 401, { error: '请先登录' });

    // 图片上传
    if (pathname === '/api/images/upload' && method === 'POST') {
      const id = url.searchParams.get('id') || '';
      if (!IMAGE_ID_RE.test(id)) return sendJSON(res, 400, { error: '图片 id 不合法' });
      const buf = await readBody(req);
      if (!buf.length) return sendJSON(res, 400, { error: '图片内容为空' });
      if (buf.length > 8 * 1024 * 1024) return sendJSON(res, 413, { error: '图片太大（限 8MB）' });
      const blobUrl = await saveImage(id, buf, req.headers['content-type']);
      db.images[id] = blobUrl;
      await writeDB(db);
      return sendJSON(res, 200, { id: id, size: buf.length });
    }

    // 图片读取
    const imgMatch = pathname.match(/^\/api\/images\/([A-Za-z0-9_-]{3,80})$/);
    if (imgMatch && method === 'GET') {
      const buf = await readImage(db.images[imgMatch[1]]);
      if (!buf) return sendText(res, 404, '404');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', buf.length);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.end(buf);
    }

    // 通用集合
    const collMatch = pathname.match(/^\/api\/(items|topics|inbox|submissions|progress)(?:\/([A-Za-z0-9_-]{3,80}))?$/);
    if (collMatch) {
      const name = collMatch[1];
      const id = collMatch[2];
      const list = db[name];

      if (method === 'GET' && !id) {
        if (name === 'progress') {
          return sendJSON(res, 200, list.filter(function (x) { return x.ownerId === user.id; }));
        }
        if ((name === 'inbox' || name === 'submissions') && user.role !== 'admin') {
          return sendJSON(res, 200, list.filter(function (x) { return x.ownerId === user.id; }));
        }
        return sendJSON(res, 200, list);
      }

      if (method === 'POST' && !id) {
        const body = await readJSON(req);
        const obj = Object.assign({}, body);
        obj.id = obj.id && IMAGE_ID_RE.test(obj.id) ? obj.id : genId(name.charAt(0));
        if (list.some(function (x) { return x.id === obj.id; })) return sendJSON(res, 409, { error: 'id 已存在' });
        if (name === 'inbox') {
          obj.ownerId = user.id;
          obj.uploader = user.displayName || user.username;
          obj.createdAt = obj.createdAt || nowISO();
          obj.gradeStatus = 'pending';
        } else if (name === 'submissions') {
          obj.ownerId = user.id;
          obj.studentName = user.displayName || user.username;
          obj.createdAt = obj.createdAt || nowISO();
          obj.status = obj.status || 'pending';
        } else if (name === 'progress') {
          obj.ownerId = user.id;
          obj.createdAt = obj.createdAt || nowISO();
        } else {
          obj.ownerId = user.id;
          obj.ownerName = user.displayName || user.username;
          obj.createdAt = obj.createdAt || nowISO();
        }
        obj.updatedAt = nowISO();
        list.push(obj);
        await writeDB(db);
        return sendJSON(res, 200, obj);
      }

      if (id) {
        const idx = list.findIndex(function (x) { return x.id === id; });
        if (idx < 0) return sendJSON(res, 404, { error: '不存在' });
        const existing = list[idx];
        if (method === 'GET') return sendJSON(res, 200, existing);
        const canEdit = user.role === 'admin' || existing.ownerId === user.id;
        if (!canEdit) return sendJSON(res, 403, { error: '只能修改自己上传的内容' });
        if (method === 'PUT') {
          const body = await readJSON(req);
          const merged = Object.assign({}, existing, body);
          merged.id = existing.id;
          merged.ownerId = existing.ownerId;
          merged.createdAt = existing.createdAt;
          merged.updatedAt = nowISO();
          list[idx] = merged;
          await writeDB(db);
          return sendJSON(res, 200, merged);
        }
        if (method === 'DELETE') {
          list.splice(idx, 1);
          await writeDB(db);
          return sendJSON(res, 200, { ok: true });
        }
      }
    }

    // AI 批改配置
    if (pathname === '/api/config') {
      if (user.role !== 'admin') return sendJSON(res, 403, { error: '需要管理员权限' });
      if (method === 'GET') {
        const c = db.config;
        return sendJSON(res, 200, {
          base: c.gradeBase,
          model: c.gradeModel,
          hasKey: !!c.gradeKey,
          keyMask: c.gradeKey ? (c.gradeKey.slice(0, 4) + '****' + c.gradeKey.slice(-4)) : ''
        });
      }
      if (method === 'POST') {
        const body = await readJSON(req);
        if (typeof body.base === 'string' && body.base.trim()) db.config.gradeBase = body.base.trim();
        if (typeof body.model === 'string' && body.model.trim()) db.config.gradeModel = body.model.trim();
        if (typeof body.key === 'string' && body.key.trim()) db.config.gradeKey = body.key.trim();
        if (body.clearKey) db.config.gradeKey = '';
        await writeDB(db);
        return sendJSON(res, 200, { ok: true, autoGrade: !!db.config.gradeKey });
      }
    }

    // AI 定位图形区域（自动裁剪用）
    if (pathname === '/api/detect-figure' && method === 'POST') {
      const body = await readJSON(req);
      const it = db.items.filter(function (i) { return i.id === body.itemId; })[0];
      if (!it) return sendJSON(res, 404, { error: '题目不存在' });
      if (user.role !== 'admin' && it.ownerId !== user.id) return sendJSON(res, 403, { error: '只能处理自己的题目' });
      if (!db.config.gradeKey) return sendJSON(res, 400, { error: '还没有配置 AI 密钥，请管理员到「设置」里填写' });
      try {
        const result = await callFigureAPI(db.config, it, db.images);
        return sendJSON(res, 200, result);
      } catch (err) {
        console.error('[figure]', err && err.message);
        return sendJSON(res, 500, { error: '识别图形失败：' + (err && err.message ? err.message : err) });
      }
    }

    // AI 识别 IB 知识点
    if (pathname === '/api/tag' && method === 'POST') {
      const body = await readJSON(req);
      const it = db.items.filter(function (i) { return i.id === body.itemId; })[0];
      if (!it) return sendJSON(res, 404, { error: '题目不存在' });
      if (user.role !== 'admin' && it.ownerId !== user.id) return sendJSON(res, 403, { error: '只能给自己的题打标签' });
      if (!db.config.gradeKey) return sendJSON(res, 400, { error: '还没有配置 AI 密钥，请管理员到「设置」里填写' });
      try {
        const result = await callTagAPI(db.config, it, db.images);
        if (!it.subject || it.subject === '其他') {
          if (result.subject) it.subject = result.subject;
        }
        const subject = it.subject || result.subject || '其他';
        it.topics = it.topics || [];
        const added = [];
        result.topics.forEach(function (name) {
          var found = db.topics.filter(function (t) { return t.name === name && t.subject === subject; })[0];
          if (!found) {
            found = { id: genId('t'), subject: subject, name: name, definition: '', formula: '', pitfalls: '', createdAt: nowISO() };
            db.topics.push(found);
            added.push(name);
          }
          if (it.topics.indexOf(found.id) < 0) it.topics.push(found.id);
        });
        it.updatedAt = nowISO();
        await writeDB(db);
        return sendJSON(res, 200, { ok: true, subject: it.subject, topics: result.topics, added: added, confidence: result.confidence });
      } catch (err) {
        console.error('[tag]', err && err.message);
        return sendJSON(res, 500, { error: '识别知识点失败：' + (err && err.message ? err.message : err) });
      }
    }

    // 只生成标准答案
    if (pathname === '/api/answer' && method === 'POST') {
      const body = await readJSON(req);
      const it = db.items.filter(function (i) { return i.id === body.itemId; })[0];
      if (!it) return sendJSON(res, 404, { error: '题目不存在' });
      if (user.role !== 'admin' && it.ownerId !== user.id) return sendJSON(res, 403, { error: '只能给自己的题生成答案' });
      if (!db.config.gradeKey) return sendJSON(res, 400, { error: '还没有配置 AI 密钥，请管理员到「设置」里填写' });
      try {
        const pseudo = {
          questionId: it.id,
          questionText: it.question || '',
          answerText: '（学生未作答。这次只需要标准答案和得分点，不需要判分，score 给 0 即可。）'
        };
        const grade = await callGradeAPI(db.config, pseudo, it, db.images);
        if (grade.standardAnswer) it.correctAnswer = grade.standardAnswer;
        if (grade.points && grade.points.length) {
          it.markScheme = it.markScheme || [];
          grade.points.forEach(function (p) {
            if (p.point && !it.markScheme.some(function (m) { return m.point === p.point; })) {
              it.markScheme.push({ point: p.point, missed: false });
            }
          });
        }
        it.updatedAt = nowISO();
        await writeDB(db);
        return sendJSON(res, 200, { ok: true, correctAnswer: it.correctAnswer, markScheme: it.markScheme });
      } catch (err) {
        console.error('[answer]', err && err.message);
        return sendJSON(res, 500, { error: '生成答案失败：' + (err && err.message ? err.message : err) });
      }
    }

    // 图片题目转文字
    if (pathname === '/api/transcribe' && method === 'POST') {
      const body = await readJSON(req);
      const it = db.items.filter(function (i) { return i.id === body.itemId; })[0];
      if (!it) return sendJSON(res, 404, { error: '题目不存在' });
      if (user.role !== 'admin' && it.ownerId !== user.id) return sendJSON(res, 403, { error: '只能转自己的题目' });
      if (!db.config.gradeKey) return sendJSON(res, 400, { error: '还没有配置 AI 密钥，请管理员到「设置」里填写' });
      try {
        const result = await callTranscribeAPI(db.config, it, db.images);
        it.question = result.text;
        var imageRemoved = false;
        if (!result.hasImage && (it.imageIds || []).length) {
          it.imageIds = [];
          imageRemoved = true;
        }
        it.updatedAt = nowISO();
        await writeDB(db);
        return sendJSON(res, 200, { ok: true, question: it.question, hasImage: result.hasImage, imageRemoved: imageRemoved });
      } catch (err) {
        console.error('[transcribe]', err && err.message);
        return sendJSON(res, 500, { error: '图片转文字失败：' + (err && err.message ? err.message : err) });
      }
    }

    // AI 批改
    if (pathname === '/api/grade' && method === 'POST') {
      const body = await readJSON(req);
      const sub = db.submissions.filter(function (s) { return s.id === body.submissionId; })[0];
      if (!sub) return sendJSON(res, 404, { error: '作答记录不存在' });
      if (user.role !== 'admin' && sub.ownerId !== user.id) return sendJSON(res, 403, { error: '只能批改自己的作答' });
      if (!db.config.gradeKey) return sendJSON(res, 400, { error: '还没有配置 AI 批改密钥，请管理员到「设置」里填写' });
      const item = db.items.filter(function (i) { return i.id === sub.questionId; })[0];
      let grade;
      try {
        grade = await callGradeAPI(db.config, sub, item, db.images);
      } catch (err) {
        console.error('[grade]', err && err.message);
        return sendJSON(res, 500, { error: 'AI 批改失败：' + (err && err.message ? err.message : err) });
      }
      sub.status = 'graded';
      sub.grade = grade;
      sub.updatedAt = nowISO();
      if (item) {
        if (!item.correctAnswer && grade.standardAnswer) item.correctAnswer = grade.standardAnswer;
        if (grade.points && grade.points.length) {
          item.markScheme = item.markScheme || [];
          grade.points.forEach(function (p) {
            if (p.point && !item.markScheme.some(function (m) { return m.point === p.point; })) {
              item.markScheme.push({ point: p.point, missed: false });
            }
          });
        }
        item.updatedAt = nowISO();
      }
      await writeDB(db);
      return sendJSON(res, 200, { ok: true, grade: grade });
    }

    // 用户管理
    if (pathname === '/api/users' && method === 'GET') {
      if (user.role !== 'admin') return sendJSON(res, 403, { error: '需要管理员权限' });
      return sendJSON(res, 200, db.users.map(publicUser));
    }
    const userMatch = pathname.match(/^\/api\/users\/([A-Za-z0-9_-]{3,80})$/);
    if (userMatch && method === 'PATCH') {
      if (user.role !== 'admin') return sendJSON(res, 403, { error: '需要管理员权限' });
      const idx = db.users.findIndex(function (u) { return u.id === userMatch[1]; });
      if (idx < 0) return sendJSON(res, 404, { error: '用户不存在' });
      const body = await readJSON(req);
      if (body.role === 'admin' || body.role === 'student') db.users[idx].role = body.role;
      if (typeof body.disabled === 'boolean') db.users[idx].disabled = body.disabled;
      await writeDB(db);
      return sendJSON(res, 200, publicUser(db.users[idx]));
    }

    // 备份
    if (pathname === '/api/admin/backup' && method === 'GET') {
      if (user.role !== 'admin') return sendJSON(res, 403, { error: '需要管理员权限' });
      const copy = JSON.parse(JSON.stringify(db));
      delete copy.sessions;
      delete copy.config;
      return sendJSON(res, 200, copy);
    }

    return sendJSON(res, 404, { error: '接口不存在' });
  } catch (err) {
    console.error('[api]', err && err.message);
    return sendJSON(res, 500, { error: err && err.message ? err.message : '服务器错误' });
  }
};
