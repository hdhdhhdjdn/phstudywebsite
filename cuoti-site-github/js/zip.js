/* MiniZip —— 极简 ZIP 读写（store 模式，不压缩）。
 * 用途：错题站导出 / 导入「题库包」（library.json + images/*.jpg）。
 * 浏览器与 Node 均可使用：暴露 window.MiniZip / module.exports。
 */
(function (root) {
  'use strict';

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function toU8(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof data === 'string') return new TextEncoder().encode(data);
    throw new Error('MiniZip: 不支持的数据类型');
  }

  function dosDateTime(d) {
    d = d || new Date();
    var year = Math.max(1980, d.getFullYear());
    var date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    return { date: date & 0xFFFF, time: time & 0xFFFF };
  }

  /* files: [{ name: string, data: Uint8Array|ArrayBuffer|string }]
   * 返回 Blob（application/zip） */
  function create(files, opts) {
    opts = opts || {};
    var dt = dosDateTime(opts.date);
    var parts = [];
    var central = [];
    var offset = 0;

    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var data = toU8(f.data);
      var nameBytes = new TextEncoder().encode(f.name);
      var crc = crc32(data);

      var local = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);   // local file header
      lv.setUint16(4, 20, true);           // version needed
      lv.setUint16(6, 0x0800, true);       // UTF-8 文件名
      lv.setUint16(8, 0, true);            // method 0 = store
      lv.setUint16(10, dt.time, true);
      lv.setUint16(12, dt.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      var cd = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);   // central directory header
      cv.setUint16(4, 20, true);           // version made by
      cv.setUint16(6, 20, true);           // version needed
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dt.time, true);
      cv.setUint16(14, dt.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);           // extra len
      cv.setUint16(32, 0, true);           // comment len
      cv.setUint16(34, 0, true);           // disk
      cv.setUint16(36, 0, true);           // internal attrs
      cv.setUint32(38, 0, true);           // external attrs
      cv.setUint32(42, offset, true);      // local header offset
      cd.set(nameBytes, 46);

      parts.push(local, data);
      central.push(cd);
      offset += local.length + data.length;
    }

    var cdSize = 0;
    for (var j = 0; j < central.length; j++) cdSize += central[j].length;

    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob(parts.concat(central, [eocd]), { type: 'application/zip' });
  }

  /* 读取 store 模式的 ZIP，返回 [{ name, data: Uint8Array }] */
  function read(buffer) {
    var u8 = toU8(buffer);
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var len = u8.byteLength;
    if (len < 22) throw new Error('文件太小，不是有效的题库包');

    var eocd = -1;
    var min = Math.max(0, len - 22 - 65535);
    for (var i = len - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 ZIP 题库包');

    var count = dv.getUint16(eocd + 10, true);
    var cdSize = dv.getUint32(eocd + 12, true);
    var cdOffset = dv.getUint32(eocd + 16, true);
    var dec = new TextDecoder('utf-8');
    var res = [];
    var p = cdOffset;
    var end = cdOffset + cdSize;

    for (var n = 0; n < count && p + 46 <= end; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var compSize = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var commentLen = dv.getUint16(p + 32, true);
      var localOff = dv.getUint32(p + 42, true);
      var name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));

      if (method !== 0) {
        throw new Error('题库包使用了压缩格式，请使用错题站导出的 .zip 题库包');
      }

      var lNameLen = dv.getUint16(localOff + 26, true);
      var lExtraLen = dv.getUint16(localOff + 28, true);
      var start = localOff + 30 + lNameLen + lExtraLen;
      res.push({ name: name, data: u8.subarray(start, start + compSize) });

      p += 46 + nameLen + extraLen + commentLen;
    }
    return res;
  }

  var api = { create: create, read: read, crc32: crc32 };
  root.MiniZip = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
