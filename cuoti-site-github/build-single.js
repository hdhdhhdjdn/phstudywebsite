/* 把多文件版本打包成单个 HTML（方便发给同学 / 双击打开）
 * 运行：node build-single.js
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

html = html.replace('<link rel="stylesheet" href="css/style.css">', '<style>\n' + css + '\n</style>');
// 单文件版不内联 KaTeX（体积过大），改用 app.js 自带渲染兜底
html = html.replace('<link rel="stylesheet" href="css/katex.min.css">', '');
html = html.replace('<script src="js/katex.min.js"></script>', '');

const files = ['js/zip.js', 'js/db.js', 'js/api.js', 'js/seed.js', 'js/app.js'];
const js = files.map(function (f) {
  return '/* ==================== ' + f + ' ==================== */\n' +
    fs.readFileSync(path.join(root, f), 'utf8');
}).join('\n\n');

files.forEach(function (f) {
  html = html.replace('<script src="' + f + '"></script>\n', '');
  html = html.replace('<script src="' + f + '"></script>', '');
});

html = html.replace('</body>', '<script>\n' + js + '\n</script>\n</body>');

const outPath = path.join(root, '错题站.html');
fs.writeFileSync(outPath, html, 'utf8');

const leftOver = ['src="js/', 'href="css/'].filter(function (s) { return html.indexOf(s) >= 0; });
if (leftOver.length) {
  console.error('打包失败：还有外部引用 ' + leftOver.join(', '));
  process.exit(1);
}
console.log('已生成 ' + outPath + '（' + (html.length / 1024).toFixed(1) + ' KB）');
