/* 静态一致性检查（Node 运行）：node test/dom-check.js
 * 1) app.js 里引用的 #id 是否都在 index.html 存在
 * 2) index.html 里的 data-action 是否都在 app.js 的点击处理里出现
 * 3) 单文件打包所需的 script/link 标签是否齐全
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

let errors = 0;
function fail(msg) {
  errors++;
  console.log('  ✗ ' + msg);
}

// ---------- 1. id 引用 ----------
const htmlIds = new Set();
let m;
const idRe = /\bid="([^"]+)"/g;
while ((m = idRe.exec(html))) htmlIds.add(m[1]);

const refs = new Set();
const refRe = /\$\('#([A-Za-z0-9_-]+)'\)/g;
while ((m = refRe.exec(app))) refs.add(m[1]);
const modalRe = /(?:showModal|hideModal)\('([A-Za-z0-9_-]+)'\)/g;
while ((m = modalRe.exec(app))) refs.add(m[1]);

console.log('检查 id 引用：app.js 用到 ' + refs.size + ' 个，index.html 定义 ' + htmlIds.size + ' 个');
refs.forEach(function (id) {
  if (!htmlIds.has(id)) fail('app.js 引用了不存在的 #' + id);
});

// ---------- 2. data-action ----------
const actions = new Set();
const actRe = /data-action="([^"]+)"/g;
while ((m = actRe.exec(html))) actions.add(m[1]);
console.log('检查 data-action：index.html 中 ' + actions.size + ' 个');
actions.forEach(function (a) {
  if (app.indexOf("action === '" + a + "'") < 0) fail('app.js 没有处理 data-action="' + a + '"');
});

// ---------- 3. 打包所需标签 ----------
console.log('检查单文件打包入口');
if (html.indexOf('<link rel="stylesheet" href="css/style.css">') < 0) fail('缺少 css 引用');
['js/zip.js', 'js/db.js', 'js/api.js', 'js/seed.js', 'js/app.js'].forEach(function (f) {
  if (html.indexOf('src="' + f + '"') < 0) fail('缺少脚本引用 ' + f);
});

// ---------- 4. 内联安全性 ----------
['js/zip.js', 'js/db.js', 'js/api.js', 'js/seed.js', 'js/app.js'].forEach(function (f) {
  const code = fs.readFileSync(path.join(root, f), 'utf8');
  if (code.indexOf('</script>') >= 0) fail(f + ' 里含有 </script>，无法内联为单文件');
});

// ---------- 5. 元素数量提示 ----------
console.log('\n统计：HTML ' + html.split('\n').length + ' 行，app.js ' + app.split('\n').length + ' 行');

if (errors) {
  console.log('\n发现 ' + errors + ' 个问题 ❌');
  process.exit(1);
}
console.log('\n全部通过 ✅');
