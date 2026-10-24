/* MiniZip 往返测试（Node 运行）：node test/zip.test.js */
const fs = require('fs');
const path = require('path');
const MiniZip = require('../js/zip.js');

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok - ' + msg);
}

(async function () {
  const files = [
    { name: 'library.json', data: new TextEncoder().encode(JSON.stringify({ hello: '世界', n: 42 })) },
    { name: 'images/abc.jpg', data: new Uint8Array([255, 216, 255, 224, 0, 1, 2, 3]) },
    { name: 'images/empty.bin', data: new Uint8Array(0) }
  ];

  const blob = MiniZip.create(files);
  const buf = new Uint8Array(await blob.arrayBuffer());
  console.log('zip size =', buf.length, 'bytes');
  assert(buf[0] === 0x50 && buf[1] === 0x4B, 'PK 头正确');

  const samplePath = path.join(__dirname, 'sample.zip');
  fs.writeFileSync(samplePath, Buffer.from(buf));
  console.log('  已写出 ' + samplePath + '（用于 Windows 交叉验证）');

  const entries = MiniZip.read(buf);
  assert(entries.length === 3, '条目数 = 3');

  const lib = JSON.parse(new TextDecoder().decode(entries[0].data));
  assert(lib.hello === '世界' && lib.n === 42, 'UTF-8 JSON 内容一致');

  const img = entries[1];
  assert(img.name === 'images/abc.jpg', '文件名一致');
  assert(img.data.length === 8 && img.data[0] === 255 && img.data[7] === 3, '二进制内容一致');
  assert(entries[2].name === 'images/empty.bin' && entries[2].data.length === 0, '空文件正常');

  // 空 zip
  const empty = MiniZip.create([]);
  const emptyEntries = MiniZip.read(new Uint8Array(await empty.arrayBuffer()));
  assert(emptyEntries.length === 0, '空 zip 可读');

  // CRC32 已知值："123456789" -> 0xCBF43926
  const crc = MiniZip.crc32(new TextEncoder().encode('123456789'));
  assert(crc === 0xCBF43926, 'CRC32 校验值正确（0xCBF43926）');

  console.log('\n全部通过 ✅');
})().catch(function (e) {
  console.error(e.message || e);
  process.exit(1);
});
