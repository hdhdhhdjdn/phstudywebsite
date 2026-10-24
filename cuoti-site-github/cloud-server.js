/* 错题站 · 班级服务器版（零依赖，只用 Node 内置模块）
 *
 * 启动： node cloud-server.js
 * 可选环境变量：PORT（默认 8765）、HOST（默认 0.0.0.0，局域网可访问）
 *
 * 数据： ./cloud-data/db.json + ./cloud-data/uploads/<imageId>
 * 账号： 开放注册；第一个注册的账号自动成为管理员
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'cloud-data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || '0.0.0.0';
const REGISTER_CODE = String(process.env.REGISTER_CODE || '').trim();
const MAX_BODY = 12 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------- 数据层 ----------------
function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

const db = loadDB();
db.users = db.users || [];
db.sessions = db.sessions || {};
db.items = db.items || [];
db.topics = db.topics || [];
db.inbox = db.inbox || [];
db.submissions = db.submissions || [];
db.config = db.config || {
  gradeBase: 'https://open.bigmodel.cn/api/paas/v4',
  gradeModel: 'glm-5.3-flash',
  gradeKey: ''
};

function getConfig() {
  return {
    gradeBase: db.config.gradeBase || 'https://open.bigmodel.cn/api/paas/v4',
    gradeModel: db.config.gradeModel || 'glm-5.3-flash',
    gradeKey: db.config.gradeKey || ''
  };
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(function () {
    saveTimer = null;
    try {
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DB_FILE);
    } catch (err) {
      console.error('[WARN] 保存失败:', err.message);
    }
  }, 120);
}

function genId(prefix) {
  return (prefix || 'x') + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function nowISO() {
  return new Date().toISOString();
}

// ---------------- HTTP 工具 ----------------
function sendJSON(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendText(res, status, text) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on('data', function (c) {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

function readJSON(req) {
  return readBody(req).then(function (buf) {
    if (!buf.length) return {};
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch (e) {
      throw new Error('JSON 格式错误');
    }
  });
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(function (part) {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

// ---------------- 账号 ----------------
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

function publicUser(u) {
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role, createdAt: u.createdAt };
}

function currentUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.sid;
  if (!token) return null;
  const sess = db.sessions[token];
  if (!sess) return null;
  const user = db.users.filter(function (u) { return u.id === sess.userId; })[0];
  if (!user || user.disabled) return null;
  return user;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', 'sid=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000');
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

// ---------------- 权限 ----------------
function canEdit(user, obj) {
  if (!user || !obj) return false;
  return user.role === 'admin' || obj.ownerId === user.id;
}

// ---------------- 静态文件 ----------------
const STATIC_RE = /^\/(index\.html|login\.html|css\/[A-Za-z0-9_.\/-]+|js\/[A-Za-z0-9_.\/-]+)$/;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function send404Page(res, pathname) {
  const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>404 · 错题站</title>' +
    '<div style="font-family:PingFang SC,Microsoft YaHei,sans-serif;max-width:560px;margin:12vh auto;padding:0 20px;color:#1c2434">' +
    '<h1 style="font-size:22px">404 · 这个地址不存在</h1>' +
    '<p style="color:#6b7688">你访问的是：<code style="background:#f0f3fa;padding:2px 6px;border-radius:6px">' +
    String(pathname).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }) +
    '</code></p>' +
    '<p style="color:#6b7688">常见原因：从聊天/文档里点链接时，把后面的中文标点也带进了网址。</p>' +
    '<p style="margin-top:24px"><a href="/" style="display:inline-block;background:#3b6ef6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600">← 回到错题站首页</a></p>' +
    '<p style="color:#9aa4b5;font-size:13px;margin-top:26px">正确地址一般就是 <b>http://localhost:8765/</b></p>' +
    '</div></html>';
  const body = Buffer.from(html, 'utf8');
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

function serveStatic(pathname, res) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  if (!STATIC_RE.test(rel)) {
    send404Page(res, pathname);
    return;
  }
  const full = path.resolve(ROOT, '.' + rel);
  if (!full.startsWith(ROOT)) {
    send404Page(res, pathname);
    return;
  }
  fs.readFile(full, function (err, data) {
    if (err) {
      send404Page(res, pathname);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

// ---------------- AI 批改 ----------------
function reasoningEffort(model) {
  // GLM-5 系列"始终思考"，用 reasoning_effort=low 降低思考开销，避免正式回答为空
  if (/^glm-5/i.test(String(model || ''))) return 'low';
  return undefined;
}
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
  const hasReasoning = !!(choice && choice.message && choice.message.reasoning_content);
  return new Error('模型返回为空（finish_reason=' + (fr || '未知') + (hasReasoning ? '，思考内容非空' : '') + '）。请重试；如果反复出现，把模型换成 glm-5.3-flashx');
}
function extractJSON(text) {
  try { return JSON.parse(text); } catch (e) {}
  const s = String(text).indexOf('{');
  const e = String(text).lastIndexOf('}');
  if (s >= 0 && e > s) {
    try { return JSON.parse(String(text).slice(s, e + 1)); } catch (err) {}
  }
  return null;
}

async function callGradeAPI(cfg, sub, item) {
  const questionText = (item && item.question) || sub.questionText || '';
  const imageIds = (item && item.imageIds) || [];
  if (!questionText && !imageIds.length) throw new Error('这道题没有题干也没有图片，无法批改');

  const parts = [];
  parts.push('请批改下面这道题的学生作答。');
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
    const file = path.join(UPLOAD_DIR, String(imageIds[i]) + '.jpg');
    if (fs.existsSync(file)) {
      content.push({
        type: 'image_url',
        image_url: { url: 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64') }
      });
    }
  }

  const sys = '你是一位严格但耐心的中学老师。请批改学生作答：先给出标准答案，再按得分点判分。' +    '如果题目要求作图/画图（函数图像、几何图、示意图等），standardAnswer 必须列出可对照的关键特征：图形形状、截距、渐近线、极值点、关键点坐标、需要标注的要素；能写出方程时同时给出方程。' +

    '标准答案和得分点里的数学公式请用 $...$ 包裹的 LaTeX（如 $\\frac{dy}{dx}$、$\\sqrt{x}$、$x^2$）；多行推导用 $$\\begin{aligned} ... \\end{aligned}$$，每行用 \\\\ 分隔；方程组用 $$\\begin{cases} ... \\end{cases}$$。' +
    '只输出一个 JSON 对象，不要输出任何其他文字、不要用 markdown 代码块。JSON 结构：' +
    '{"standardAnswer":"标准答案","score":得分数字,"fullMarks":满分数字,' +
    '"points":[{"point":"得分点","awarded":得分,"max":分值,"comment":"说明"}],' +
    '"comment":"总体点评（1-3 句，指出错误原因）","causes":["K"]}。' +
    'causes 取值：K=知识没掌握，M=方法/思路，C=计算，E=表达或审题问题。';

  const url = cfg.gradeBase.replace(/\/+$/, '') + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.gradeKey },
    body: JSON.stringify({
      model: cfg.gradeModel,
      reasoning_effort: reasoningEffort(cfg.gradeModel),
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: content }
      ],
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

  const causes = Array.isArray(parsed.causes)
    ? parsed.causes.filter(function (c) { return ['K', 'M', 'C', 'E'].indexOf(c) >= 0; })
    : [];
  return {
    standardAnswer: String(parsed.standardAnswer || ''),
    score: Number(parsed.score) || 0,
    fullMarks: Number(parsed.fullMarks) || 1,
    comment: String(parsed.comment || ''),
    causes: causes,
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
async function callTranscribeAPI(cfg, item) {
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
    const file = path.join(UPLOAD_DIR, String(imageIds[i]) + '.jpg');
    if (fs.existsSync(file)) {
      content.push({
        type: 'image_url',
        image_url: { url: 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64') }
      });
    }
  }

  const url = cfg.gradeBase.replace(/\/+$/, '') + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.gradeKey },
    body: JSON.stringify({
      model: cfg.gradeModel,
      reasoning_effort: reasoningEffort(cfg.gradeModel),
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
async function callTagAPI(cfg, item) {
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
    const file = path.join(UPLOAD_DIR, String(imageIds[i]) + '.jpg');
    if (fs.existsSync(file)) {
      content.push({
        type: 'image_url',
        image_url: { url: 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64') }
      });
    }
  }

  const url = cfg.gradeBase.replace(/\/+$/, '') + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.gradeKey },
    body: JSON.stringify({
      model: cfg.gradeModel,
      reasoning_effort: reasoningEffort(cfg.gradeModel),
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
async function callFigureAPI(cfg, item) {
  const imageIds = (item && item.imageIds) || [];
  if (!imageIds.length) throw new Error('这道题没有图片');
  const file = path.join(UPLOAD_DIR, String(imageIds[0]) + '.jpg');
  if (!fs.existsSync(file)) throw new Error('图片文件不存在');

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
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64') } }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 800,
      reasoning_effort: reasoningEffort(cfg.gradeModel)
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

// ---------------- API ----------------
const IMAGE_ID_RE = /^[A-Za-z0-9_-]{3,80}$/;

function findIndex(list, id) {
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return i;
  return -1;
}

async function handleAPI(req, res, pathname, url) {
  const user = currentUser(req);

  // 健康检查
  if (pathname === '/api/health') {
    return sendJSON(res, 200, {
      ok: true,
      app: 'cuoti-cloud',
      version: 1,
      registerCodeRequired: !!REGISTER_CODE,
      autoGrade: !!getConfig().gradeKey
    });
  }

  // 注册
  if (pathname === '/api/register' && req.method === 'POST') {
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
    save();
    setSessionCookie(res, token);
    return sendJSON(res, 200, { user: publicUser(u) });
  }

  // 登录
  if (pathname === '/api/login' && req.method === 'POST') {
    const body = await readJSON(req);
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const u = db.users.filter(function (x) { return x.username === username; })[0];
    if (!u || u.disabled) return sendJSON(res, 401, { error: '用户名或密码错误' });
    if (hashPassword(password, u.salt) !== u.hash) return sendJSON(res, 401, { error: '用户名或密码错误' });
    const token = crypto.randomBytes(24).toString('hex');
    db.sessions[token] = { userId: u.id, createdAt: nowISO() };
    save();
    setSessionCookie(res, token);
    return sendJSON(res, 200, { user: publicUser(u) });
  }

  // 退出
  if (pathname === '/api/logout' && req.method === 'POST') {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.sid && db.sessions[cookies.sid]) {
      delete db.sessions[cookies.sid];
      save();
    }
    clearSessionCookie(res);
    return sendJSON(res, 200, { ok: true });
  }

  // 当前用户
  if (pathname === '/api/me' && req.method === 'GET') {
    if (!user) return sendJSON(res, 401, { error: '未登录' });
    return sendJSON(res, 200, { user: publicUser(user) });
  }

  // 以下都需要登录
  if (!user) return sendJSON(res, 401, { error: '请先登录' });

  // 图片上传
  if (pathname === '/api/images/upload' && req.method === 'POST') {
    const id = url.searchParams.get('id') || '';
    if (!IMAGE_ID_RE.test(id)) return sendJSON(res, 400, { error: '图片 id 不合法' });
    const buf = await readBody(req);
    if (!buf.length) return sendJSON(res, 400, { error: '图片内容为空' });
    fs.writeFileSync(path.join(UPLOAD_DIR, id + '.jpg'), buf);
    return sendJSON(res, 200, { id: id, size: buf.length });
  }

  // 图片读取
  const imgMatch = pathname.match(/^\/api\/images\/([A-Za-z0-9_-]{3,80})$/);
  if (imgMatch && req.method === 'GET') {
    const file = path.join(UPLOAD_DIR, imgMatch[1] + '.jpg');
    if (!fs.existsSync(file)) return sendText(res, 404, '404');
    const data = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': data.length, 'Cache-Control': 'private, max-age=86400' });
    return res.end(data);
  }

  // ---------- 通用集合：items / topics / inbox / submissions / progress ----------
  const collMatch = pathname.match(/^\/api\/(items|topics|inbox|submissions|progress)(?:\/([A-Za-z0-9_-]{3,80}))?$/);
  if (collMatch) {
    const name = collMatch[1];
    const id = collMatch[2];
    const list = db[name] || (db[name] = []);

    if (req.method === 'GET' && !id) {
      if (name === 'progress') {
        return sendJSON(res, 200, list.filter(function (x) { return x.ownerId === user.id; }));
      }
      if ((name === 'inbox' || name === 'submissions') && user.role !== 'admin') {
        return sendJSON(res, 200, list.filter(function (x) { return x.ownerId === user.id; }));
      }
      return sendJSON(res, 200, list);
    }

    if (req.method === 'POST' && !id) {
      const body = await readJSON(req);
      if (!body || typeof body !== 'object') return sendJSON(res, 400, { error: '数据格式错误' });
      const obj = Object.assign({}, body);
      obj.id = obj.id && IMAGE_ID_RE.test(obj.id) ? obj.id : genId(name.charAt(0));
      if (findIndex(list, obj.id) >= 0) return sendJSON(res, 409, { error: 'id 已存在' });
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
      save();
      return sendJSON(res, 200, obj);
    }

    if (id) {
      const idx = findIndex(list, id);
      if (idx < 0) return sendJSON(res, 404, { error: '不存在' });
      const existing = list[idx];

      if (req.method === 'GET') return sendJSON(res, 200, existing);

      if (!canEdit(user, existing)) return sendJSON(res, 403, { error: '只能修改自己上传的内容' });

      if (req.method === 'PUT') {
        const body = await readJSON(req);
        if (!body || typeof body !== 'object') return sendJSON(res, 400, { error: '数据格式错误' });
        const merged = Object.assign({}, existing, body);
        merged.id = existing.id;
        merged.ownerId = existing.ownerId;
        merged.createdAt = existing.createdAt;
        merged.updatedAt = nowISO();
        list[idx] = merged;
        save();
        return sendJSON(res, 200, merged);
      }

      if (req.method === 'DELETE') {
        list.splice(idx, 1);
        save();
        return sendJSON(res, 200, { ok: true });
      }
    }
  }

  // ---------- AI 批改配置（管理员） ----------
  if (pathname === '/api/config') {
    if (user.role !== 'admin') return sendJSON(res, 403, { error: '需要管理员权限' });
    if (req.method === 'GET') {
      const c = getConfig();
      return sendJSON(res, 200, {
        base: c.gradeBase,
        model: c.gradeModel,
        hasKey: !!c.gradeKey,
        keyMask: c.gradeKey ? (c.gradeKey.slice(0, 4) + '****' + c.gradeKey.slice(-4)) : ''
      });
    }
    if (req.method === 'POST') {
      const body = await readJSON(req);
      if (typeof body.base === 'string' && body.base.trim()) db.config.gradeBase = body.base.trim();
      if (typeof body.model === 'string' && body.model.trim()) db.config.gradeModel = body.model.trim();
      if (typeof body.key === 'string' && body.key.trim()) db.config.gradeKey = body.key.trim();
      if (body.clearKey) db.config.gradeKey = '';
      save();
      return sendJSON(res, 200, { ok: true, autoGrade: !!db.config.gradeKey });
    }
  }

  // ---------- AI 定位图形区域（自动裁剪用） ----------
  if (pathname === '/api/detect-figure' && req.method === 'POST') {
    const body = await readJSON(req);
    const it = db.items.filter(function (i) { return i.id === body.itemId; })[0];
    if (!it) return sendJSON(res, 404, { error: '题目不存在' });
    if (user.role !== 'admin' && it.ownerId !== user.id) return sendJSON(res, 403, { error: '只能处理自己的题目' });
    const cfg = getConfig();
    if (!cfg.gradeKey) return sendJSON(res, 400, { error: '还没有配置 AI 密钥，请管理员到「设置」里填写' });
    try {
      const result = await callFigureAPI(cfg, it);
      return sendJSON(res, 200, result);
    } catch (err) {
      console.error('[figure]', err.message);
      return sendJSON(res, 500, { error: '识别图形失败：' + err.message });
    }
  }

  // ---------- AI 识别 IB 知识点 ----------
  if (pathname === '/api/tag' && req.method === 'POST') {
    const body = await readJSON(req);
    const it = db.items.filter(function (i) { return i.id === body.itemId; })[0];
    if (!it) return sendJSON(res, 404, { error: '题目不存在' });
    if (user.role !== 'admin' && it.ownerId !== user.id) return sendJSON(res, 403, { error: '只能给自己的题打标签' });
    const cfg = getConfig();
    if (!cfg.gradeKey) return sendJSON(res, 400, { error: '还没有配置 AI 密钥，请管理员到「设置」里填写' });
    try {
      const result = await callTagAPI(cfg, it);
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
      save();
      return sendJSON(res, 200, {
        ok: true,
        subject: it.subject,
        topics: result.topics,
        added: added,
        confidence: result.confidence
      });
    } catch (err) {
      console.error('[tag]', err.message);
      return sendJSON(res, 500, { error: '识别知识点失败：' + err.message });
    }
  }

  // ---------- 只生成标准答案（不判分） ----------
  if (pathname === '/api/answer' && req.method === 'POST') {
    const body = await readJSON(req);
    const it = db.items.filter(function (i) { return i.id === body.itemId; })[0];
    if (!it) return sendJSON(res, 404, { error: '题目不存在' });
    if (user.role !== 'admin' && it.ownerId !== user.id) return sendJSON(res, 403, { error: '只能给自己的题生成答案' });
    const cfg = getConfig();
    if (!cfg.gradeKey) return sendJSON(res, 400, { error: '还没有配置 AI 密钥，请管理员到「设置」里填写' });
    try {
      const pseudo = {
        questionId: it.id,
        questionText: it.question || '',
        answerText: '（学生未作答。这次只需要标准答案和得分点，不需要判分，score 给 0 即可。）'
      };
      const grade = await callGradeAPI(cfg, pseudo, it);
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
      save();
      return sendJSON(res, 200, { ok: true, correctAnswer: it.correctAnswer, markScheme: it.markScheme });
    } catch (err) {
      console.error('[answer]', err.message);
      return sendJSON(res, 500, { error: '生成答案失败：' + err.message });
    }
  }

  // ---------- 图片题目转文字 ----------
  if (pathname === '/api/transcribe' && req.method === 'POST') {
    const body = await readJSON(req);
    const it = db.items.filter(function (i) { return i.id === body.itemId; })[0];
    if (!it) return sendJSON(res, 404, { error: '题目不存在' });
    if (user.role !== 'admin' && it.ownerId !== user.id) return sendJSON(res, 403, { error: '只能转自己的题目' });
    const cfg = getConfig();
    if (!cfg.gradeKey) return sendJSON(res, 400, { error: '还没有配置 AI 密钥，请管理员到「设置」里填写' });
    try {
      const result = await callTranscribeAPI(cfg, it);
      it.question = result.text;
      var imageRemoved = false;
      if (!result.hasImage && (it.imageIds || []).length) {
        it.imageIds = [];
        imageRemoved = true;
      }
      it.updatedAt = nowISO();
      save();
      return sendJSON(res, 200, { ok: true, question: it.question, hasImage: result.hasImage, imageRemoved: imageRemoved });
    } catch (err) {
      console.error('[transcribe]', err.message);
      return sendJSON(res, 500, { error: '图片转文字失败：' + err.message });
    }
  }

  // ---------- AI 实时批改 ----------
  if (pathname === '/api/grade' && req.method === 'POST') {
    const body = await readJSON(req);
    const sub = db.submissions.filter(function (s) { return s.id === body.submissionId; })[0];
    if (!sub) return sendJSON(res, 404, { error: '作答记录不存在' });
    if (user.role !== 'admin' && sub.ownerId !== user.id) return sendJSON(res, 403, { error: '只能批改自己的作答' });
    const cfg = getConfig();
    if (!cfg.gradeKey) return sendJSON(res, 400, { error: '还没有配置 AI 批改密钥，请管理员到「设置」里填写' });
    try {
      const item = db.items.filter(function (i) { return i.id === sub.questionId; })[0];
      const grade = await callGradeAPI(cfg, sub, item);
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
      save();
      return sendJSON(res, 200, { ok: true, grade: grade });
    } catch (err) {
      console.error('[grade]', err.message);
      return sendJSON(res, 500, { error: 'AI 批改失败：' + err.message });
    }
  }

  // ---------- 用户管理（仅管理员） ----------
  if (pathname === '/api/users' && req.method === 'GET') {
    if (user.role !== 'admin') return sendJSON(res, 403, { error: '需要管理员权限' });
    return sendJSON(res, 200, db.users.map(publicUser));
  }

  const userMatch = pathname.match(/^\/api\/users\/([A-Za-z0-9_-]{3,80})$/);
  if (userMatch && req.method === 'PATCH') {
    if (user.role !== 'admin') return sendJSON(res, 403, { error: '需要管理员权限' });
    const idx = findIndex(db.users, userMatch[1]);
    if (idx < 0) return sendJSON(res, 404, { error: '用户不存在' });
    const body = await readJSON(req);
    if (body.role === 'admin' || body.role === 'student') db.users[idx].role = body.role;
    if (typeof body.disabled === 'boolean') db.users[idx].disabled = body.disabled;
    save();
    return sendJSON(res, 200, publicUser(db.users[idx]));
  }

  // ---------- 管理端备份 ----------
  if (pathname === '/api/admin/backup' && req.method === 'GET') {
    if (user.role !== 'admin') return sendJSON(res, 403, { error: '需要管理员权限' });
    const copy = JSON.parse(JSON.stringify(db));
    delete copy.sessions;
    return sendJSON(res, 200, copy);
  }

  return sendJSON(res, 404, { error: '接口不存在' });
}

// ---------------- 服务启动 ----------------
const server = http.createServer(function (req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (e) {
    return sendText(res, 400, '400 Bad Request');
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (e) {
    return sendText(res, 400, '400 Bad Request');
  }

  const remote = String(req.socket.remoteAddress || '').replace('::ffff:', '');
  const isApi = pathname.indexOf('/api/') === 0;
  if (isApi || pathname === '/' || pathname === '/index.html' || pathname === '/login.html') {
    const t = new Date();
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    console.log('  [' + hh + ':' + mm + ':' + ss + '] ' + remote + '  ' + req.method + ' ' + pathname);
  }

  if (pathname.indexOf('/api/') === 0) {
    handleAPI(req, res, pathname, url).catch(function (err) {
      console.error('[API]', pathname, err && err.message);
      if (!res.headersSent) sendJSON(res, 500, { error: err && err.message ? err.message : '服务器错误' });
      else res.end();
    });
    return;
  }

  if (req.method !== 'GET') return sendText(res, 405, '405 Method Not Allowed');
  serveStatic(pathname, res);
});

server.listen(PORT, HOST, function () {
  const os = require('os');
  const nets = os.networkInterfaces();
  const candidates = [];
  Object.keys(nets).forEach(function (name) {
    (nets[name] || []).forEach(function (n) {
      if (n.family === 'IPv4' && !n.internal) candidates.push({ name: name, address: n.address });
    });
  });
  // 排除明显不是物理网卡的地址（169.254 自动地址、虚拟网卡）
  const usable = candidates.filter(function (c) {
    if (/^169\.254\./.test(c.address)) return false;
    if (/docker|wsl|vethernet|virtual|vmware|virtualbox|hyper-v|bluetooth|tap|loopback/i.test(c.name)) return false;
    return true;
  });
  const list = usable.length ? usable : candidates;

  console.log('');
  console.log('  错题站 · 班级版已启动');
  console.log('  ───────────────────────────────────────────');
  console.log('  本机访问： http://localhost:' + PORT + '/');
  if (list.length) {
    console.log('  同一 WiFi 下，同学用下面任意一个地址访问：');
    list.forEach(function (c) {
      console.log('    http://' + c.address + ':' + PORT + '/   (' + c.name + ')');
    });
  } else {
    console.log('  [提示] 没检测到局域网地址，请确认电脑已连上 WiFi。');
  }
  console.log('');
  console.log('  同学打不开时按顺序检查：');
  console.log('   1) 防火墙弹窗要选「专用网络」并允许（否则入站会被拦）');
  console.log('   2) 朋友必须连同一个 WiFi（手机流量 / 校园网不同网段不行）');
  console.log('   3) 校园网常有「AP 隔离」，设备之间无法互访 → 用手机热点');
  console.log('   4) 网络类型若是「公用网络」，改成「专用网络」');
  console.log('');
  console.log('  数据目录： ' + DATA_DIR);
  console.log('  关闭窗口即停止服务。');
  console.log('');
});

process.on('SIGINT', function () {
  console.log('\n正在保存数据…');
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) {}
  process.exit(0);
});
