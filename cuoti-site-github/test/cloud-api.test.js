/* 班级版 API 的 UTF-8 / Cookie 往返测试（Node 运行）
 * 用法：node test/cloud-api.test.js [baseUrl]
 */
const base = process.argv[2] || 'http://localhost:8866';

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok - ' + msg);
}

async function main() {
  const username = 'u' + Date.now().toString(36).slice(-6);
  const reg = await fetch(base + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username, password: 'pass1234', displayName: '中文昵称' })
  });
  assert(reg.status === 200, '注册成功');
  const cookie = (reg.headers.get('set-cookie') || '').split(';')[0];
  assert(/^sid=/.test(cookie), '拿到会话 cookie');
  const regData = await reg.json();
  assert(regData.user.displayName === '中文昵称', '中文昵称 UTF-8 正确');

  const me = await fetch(base + '/api/me', { headers: { cookie } });
  const meData = await me.json();
  assert(meData.user.username === username, 'cookie 鉴权可用');

  const item = {
    subject: '化学',
    source: '测验 · 第1题',
    question: '为什么 ΔH = Σ断键 − Σ成键？',
    myAnswer: '不知道',
    correctAnswer: '因为断键吸热、成键放热',
    causes: ['K'],
    topics: [],
    markScheme: [{ point: '断键吸热', missed: true }],
    note: '中文备注'
  };
  const created = await fetch(base + '/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(item)
  });
  assert(created.status === 200, '创建错题成功');
  const createdData = await created.json();
  assert(createdData.question === item.question, '题干中文往返一致');
  assert(createdData.ownerId, '自动写入 ownerId');

  const list = await (await fetch(base + '/api/items', { headers: { cookie } })).json();
  const found = list.filter(function (x) { return x.id === createdData.id; })[0];
  assert(!!found, '共享题库里能读到刚创建的题');

  // ---------- 作答记录（submissions） ----------
  const subRes = await fetch(base + '/api/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ questionId: createdData.id, subject: '化学', questionText: item.question, answerText: '因为断键吸热、成键放热', status: 'pending' })
  });
  assert(subRes.status === 200, '提交作答成功');
  const subData = await subRes.json();
  assert(subData.status === 'pending', '默认状态为待批改');
  assert(!!subData.studentName, '自动写入学生名');

  const subsMine = await (await fetch(base + '/api/submissions', { headers: { cookie } })).json();
  assert(subsMine.some(function (x) { return x.id === subData.id; }), '本人能读回自己的作答');

  // 第二个账号（学生）看不到别人的作答
  const username2 = 'v' + Date.now().toString(36).slice(-6);
  const reg2 = await fetch(base + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username2, password: 'pass1234', displayName: '同学乙' })
  });
  const cookie2 = (reg2.headers.get('set-cookie') || '').split(';')[0];
  const reg2Data = await reg2.json();
  assert(reg2Data.user.role === 'student', '第二个注册账号是学生');
  const subsOther = await (await fetch(base + '/api/submissions', { headers: { cookie: cookie2 } })).json();
  assert(!subsOther.some(function (x) { return x.id === subData.id; }), '学生看不到别人的作答');

  // 管理员能看到全部
  const subsAdmin = await (await fetch(base + '/api/submissions', { headers: { cookie } })).json();
  assert(subsAdmin.some(function (x) { return x.id === subData.id; }), '管理员能看到全部作答');

  // 学生不能改别人的作答
  const patchRes = await fetch(base + '/api/submissions/' + subData.id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie: cookie2 },
    body: JSON.stringify({ status: 'graded' })
  });
  assert(patchRes.status === 403, '学生不能改别人的作答（403）');

  const noAuth = await fetch(base + '/api/items');
  assert(noAuth.status === 401, '未登录读接口返回 401');

  // 客户端"先 PUT 后 POST"的兼容逻辑：PUT 不存在的 id 应 404，POST 同 id 应成功
  const newId = 'cli' + Date.now().toString(36);
  const putMissing = await fetch(base + '/api/items/' + newId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ question: 'x' })
  });
  assert(putMissing.status === 404, 'PUT 不存在的 id 返回 404（前端会自动改 POST）');
  const postWithId = await fetch(base + '/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ id: newId, subject: '物理', question: '客户端预生成 id 的题目' })
  });
  assert(postWithId.status === 200, 'POST 带预生成 id 创建成功');
  const postWithIdData = await postWithId.json();
  assert(postWithIdData.id === newId, '服务端保留客户端 id');

  const badLogin = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username, password: 'wrong' })
  });
  assert(badLogin.status === 401, '错误密码返回 401');

  console.log('\n全部通过 ✅');
}

main().catch(function (e) {
  console.error(e.message || e);
  process.exit(1);
});
