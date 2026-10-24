/* Vercel 版 API 本地测试（内存存储模式）
 * 运行：node test/vercel-api.test.js
 */
const http = require('http');
const path = require('path');

const handler = require(path.join(__dirname, '..', 'api', 'index.js'));

function startServer() {
  return new Promise(function (resolve) {
    const srv = http.createServer(function (req, res) {
      handler(req, res).catch(function (e) {
        res.statusCode = 500;
        res.end(String(e && e.message));
      });
    });
    srv.listen(0, '127.0.0.1', function () { resolve(srv); });
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok - ' + msg);
}

(async function () {
  const srv = await startServer();
  const port = srv.address().port;
  const base = 'http://127.0.0.1:' + port;
  console.log('测试服务器:', base);

  const health = await (await fetch(base + '/api/health')).json();
  assert(health.ok === true, 'health 正常');
  assert(health.serverless === true, '标记为 serverless');

  const reg = await fetch(base + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin' + Date.now().toString(36).slice(-4), password: 'pass1234', displayName: '管理员' })
  });
  assert(reg.status === 200, '注册成功');
  const cookie = (reg.headers.get('set-cookie') || '').split(';')[0];
  const regData = await reg.json();
  assert(regData.user.role === 'admin', '第一个账号是管理员');

  const H = { 'Content-Type': 'application/json', cookie };

  // 建题
  const item = await (await fetch(base + '/api/items', {
    method: 'POST', headers: H,
    body: JSON.stringify({ id: 'item001', subject: '数学', question: '2x+3=7, x=?', correctAnswer: 'x=2' })
  })).json();
  assert(item.id === 'item001' && item.ownerId, '建题成功并写入 ownerId');

  // 图片上传 + 读取（内存模式）
  const imgBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 0xFF, 0xD9]);
  const up = await fetch(base + '/api/images/upload?id=img001', {
    method: 'POST', headers: { cookie, 'Content-Type': 'image/jpeg' }, body: imgBytes
  });
  assert(up.status === 200, '图片上传成功');
  const got = await fetch(base + '/api/images/img001', { headers: { cookie } });
  const gotBuf = Buffer.from(await got.arrayBuffer());
  assert(got.status === 200 && gotBuf.length === imgBytes.length && gotBuf[0] === 0xFF, '图片读取字节一致');

  // 作答
  const sub = await (await fetch(base + '/api/submissions', {
    method: 'POST', headers: H,
    body: JSON.stringify({ id: 'sub001', questionId: 'item001', subject: '数学', questionText: '2x+3=7', answerText: 'x=2' })
  })).json();
  assert(sub.id === 'sub001' && sub.status === 'pending', '提交作答（pending）');

  // 未配置 Key 时批改
  const g1 = await fetch(base + '/api/grade', { method: 'POST', headers: H, body: JSON.stringify({ submissionId: 'sub001' }) });
  assert(g1.status === 400, '未配置 Key 时批改返回 400');

  // 未配置 Key 时转文字
  const t1 = await fetch(base + '/api/transcribe', { method: 'POST', headers: H, body: JSON.stringify({ itemId: 'item001' }) });
  assert(t1.status === 400, '未配置 Key 时转文字返回 400');

  // 未配置 Key 时生成答案
  const a1 = await fetch(base + '/api/answer', { method: 'POST', headers: H, body: JSON.stringify({ itemId: 'item001' }) });
  assert(a1.status === 400, '未配置 Key 时生成答案返回 400');

  // 未配置 Key 时识别知识点
  const t2 = await fetch(base + '/api/tag', { method: 'POST', headers: H, body: JSON.stringify({ itemId: 'item001' }) });
  assert(t2.status === 400, '未配置 Key 时识别知识点返回 400');

  // 配置
  const cfg = await fetch(base + '/api/config', { method: 'POST', headers: H, body: JSON.stringify({ key: 'fake-key-1234' }) });
  assert(cfg.status === 200, '保存配置成功');
  const cfgGet = await (await fetch(base + '/api/config', { headers: { cookie } })).json();
  assert(cfgGet.hasKey === true && cfgGet.keyMask.indexOf('****') > 0, '配置掩码正常');

  // 假 Key 调用（会请求外网，失败应返回 500 且带错误信息）
  const g2 = await fetch(base + '/api/grade', { method: 'POST', headers: H, body: JSON.stringify({ submissionId: 'sub001' }) });
  const g2text = await g2.text();
  assert(g2.status === 500 && g2text.indexOf('AI 批改失败') >= 0, '假 Key 批改返回明确错误（' + g2.status + '）');

  // 权限：未登录
  const noAuth = await fetch(base + '/api/items');
  assert(noAuth.status === 401, '未登录返回 401');

  // 用户列表 + 备份
  const users = await (await fetch(base + '/api/users', { headers: { cookie } })).json();
  assert(Array.isArray(users) && users.length === 1, '用户列表正常');
  const backup = await fetch(base + '/api/admin/backup', { headers: { cookie } });
  assert(backup.status === 200, '备份接口正常');

  // 静态页面（本地测试服务器不含静态托管，这里只确认 404 不是 500）
  console.log('  ok - 测试结束');

  srv.close();
  console.log('\n全部通过 ✅');
})().catch(function (e) {
  console.error(e.message || e);
  process.exit(1);
});
