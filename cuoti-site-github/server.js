/* 本地静态服务器（可选，仅当浏览器直接双击打不开、或你想用 http://localhost 访问时使用）
 * 运行：node server.js [端口]
 * 只服务本文件夹，绑定 127.0.0.1，不对外网开放。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = parseInt(process.argv[2] || '8765', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

const server = http.createServer(function (req, res) {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const full = path.resolve(root, '.' + rel);
  if (!full.startsWith(root + path.sep) && full !== path.join(root, 'index.html')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }
  fs.readFile(full, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

server.on('error', function (e) {
  console.error('[ERROR] 启动失败：' + e.message);
  console.error('端口 ' + port + ' 可能被占用，试试： node server.js 8790');
  process.exit(1);
});

server.listen(port, '127.0.0.1', function () {
  console.log('');
  console.log('  错题站已启动： http://localhost:' + port + '/');
  console.log('  数据保存在浏览器里（IndexedDB），关闭窗口即停止。');
  console.log('');
});
