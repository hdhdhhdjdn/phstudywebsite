/* 错题站 · 云端客户端（登录 / 数据接口 / 存储适配层）
 * 只有在通过 http(s) 打开、且服务器提供 /api/health 时才会进入云端模式；
 * 直接双击 file:// 打开时自动回退到本地 IndexedDB 模式。
 */
(function (root) {
  'use strict';

  function req(method, url, body) {
    const opts = { method: method, credentials: 'same-origin', headers: { 'X-Cuoti-Path': url } };
    if (body !== undefined && body !== null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (r) {
      const ct = r.headers.get('Content-Type') || '';
      if (ct.indexOf('application/json') >= 0) {
        return r.json().then(function (data) {
          if (!r.ok) {
            const err = new Error(data && data.error ? data.error : ('HTTP ' + r.status));
            err.status = r.status;
            throw err;
          }
          return data;
        });
      }
      if (!r.ok) {
        const err = new Error('HTTP ' + r.status);
        err.status = r.status;
        throw err;
      }
      return r.text();
    });
  }

  const store = {
    getAll: function (name) {
      return req('GET', '/api/' + name);
    },
    get: function (name, key) {
      if (name === 'images') {
        return fetch('/api/images/' + encodeURIComponent(key), { credentials: 'same-origin', headers: { 'X-Cuoti-Path': '/api/images/' + encodeURIComponent(key) } })
          .then(function (r) {
            if (!r.ok) return null;
            return r.blob().then(function (blob) { return { id: key, blob: blob, type: blob.type || 'image/jpeg' }; });
          })
          .catch(function () { return null; });
      }
      return req('GET', '/api/' + name + '/' + encodeURIComponent(key)).catch(function () { return null; });
    },
    put: function (name, value) {
      if (name === 'images') {
        return fetch('/api/images/upload?id=' + encodeURIComponent(value.id), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': (value.blob && value.blob.type) || 'image/jpeg', 'X-Cuoti-Path': '/api/images/upload?id=' + encodeURIComponent(value.id) },
          body: value.blob
        }).then(function (r) {
          if (!r.ok) throw new Error('图片上传失败');
          return { id: value.id };
        });
      }
      if (value && value.id) {
        return req('PUT', '/api/' + name + '/' + encodeURIComponent(value.id), value)
          .catch(function (err) {
            // 新建的对象（本地生成了 id）PUT 会 404，自动改用 POST 创建
            if (err && err.status === 404) return req('POST', '/api/' + name, value);
            throw err;
          });
      }
      return req('POST', '/api/' + name, value);
    },
    del: function (name, key) {
      return req('DELETE', '/api/' + name + '/' + encodeURIComponent(key));
    },
    putMany: function (name, arr) {
      return Promise.all(arr.map(function (v) { return store.put(name, v); }));
    },
    delMany: function (name, keys) {
      return Promise.all(keys.map(function (k) { return store.del(name, k); }));
    },
    clearAll: function () {
      return Promise.reject(new Error('云端模式不支持一键清空，请使用管理员备份功能'));
    }
  };

  const Cloud = {
    store: store,
    detected: false,
    user: null,
    detect: function () {
      if (root.location && root.location.protocol === 'file:') return Promise.resolve(false);
      return fetch('/api/health', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          Cloud.detected = !!(j && j.ok);
          Cloud.health = j || null;
          return Cloud.detected;
        })
        .catch(function () { return false; });
    },
    grade: function (submissionId) {
      return req('POST', '/api/grade', { submissionId: submissionId });
    },
    transcribe: function (itemId) {
      return req('POST', '/api/transcribe', { itemId: itemId });
    },
    answer: function (itemId) {
      return req('POST', '/api/answer', { itemId: itemId });
    },
    tag: function (itemId) {
      return req('POST', '/api/tag', { itemId: itemId });
    },
    detectFigure: function (itemId) {
      return req('POST', '/api/detect-figure', { itemId: itemId });
    },
    getConfig: function () { return req('GET', '/api/config'); },
    saveConfig: function (cfg) { return req('POST', '/api/config', cfg); },
    me: function () {
      return req('GET', '/api/me').then(function (d) { Cloud.user = d.user; return d.user; });
    },
    login: function (username, password) {
      return req('POST', '/api/login', { username: username, password: password }).then(function (d) {
        Cloud.user = d.user;
        return d.user;
      });
    },
    register: function (username, password, displayName, code) {
      return req('POST', '/api/register', {
        username: username,
        password: password,
        displayName: displayName,
        code: code || ''
      }).then(function (d) {
        Cloud.user = d.user;
        return d.user;
      });
    },
    logout: function () {
      return req('POST', '/api/logout').then(function () { Cloud.user = null; });
    }
  };

  root.Cloud = Cloud;
  if (typeof module !== 'undefined' && module.exports) module.exports = Cloud;
})(typeof globalThis !== 'undefined' ? globalThis : this);
