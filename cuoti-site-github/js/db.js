/* 错题站 · IndexedDB 封装
 * stores: items（错题）, topics（知识点）, images（图片 Blob）, meta（键值）
 */
(function (root) {
  'use strict';

  var DB_NAME = 'cuoti-db';
  var DB_VER = 4;

  function reqPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB 请求失败')); };
    });
  }

  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!root.indexedDB) {
        reject(new Error('当前浏览器不支持 IndexedDB，请使用 Chrome / Edge 打开'));
        return;
      }
      var req = root.indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('topics')) db.createObjectStore('topics', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('inbox')) db.createObjectStore('inbox', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('submissions')) db.createObjectStore('submissions', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('打开数据库失败')); };
      req.onblocked = function () { reject(new Error('数据库被其他标签页占用，请关闭其他错题站页面后重试')); };
    });
    dbPromise.catch(function () { dbPromise = null; });
    return dbPromise;
  }

  function run(storeName, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, mode);
        var store = tx.objectStore(storeName);
        var out;
        try {
          out = fn(store, tx);
        } catch (e) {
          reject(e);
          return;
        }
        tx.oncomplete = function () { resolve(out); };
        tx.onerror = function () { reject(tx.error || new Error('数据库写入失败')); };
        tx.onabort = function () { reject(tx.error || new Error('数据库事务中断')); };
      });
    });
  }

  var DB = {
    available: function () { return !!root.indexedDB; },
    open: open,
    getAll: function (name) {
      return open().then(function (db) {
        return reqPromise(db.transaction(name, 'readonly').objectStore(name).getAll());
      });
    },
    get: function (name, key) {
      return open().then(function (db) {
        return reqPromise(db.transaction(name, 'readonly').objectStore(name).get(key));
      });
    },
    put: function (name, value) {
      return run(name, 'readwrite', function (store) { store.put(value); });
    },
    putMany: function (name, arr) {
      return run(name, 'readwrite', function (store) {
        for (var i = 0; i < arr.length; i++) store.put(arr[i]);
      });
    },
    del: function (name, key) {
      return run(name, 'readwrite', function (store) { store.delete(key); });
    },
    delMany: function (name, keys) {
      return run(name, 'readwrite', function (store) {
        for (var i = 0; i < keys.length; i++) store.delete(keys[i]);
      });
    },
    clearAll: function () {
      var names = ['items', 'topics', 'images', 'inbox', 'submissions', 'progress', 'meta'];
      return Promise.all(names.map(function (n) {
        return run(n, 'readwrite', function (store) { store.clear(); });
      }));
    }
  };

  root.DB = DB;
})(typeof globalThis !== 'undefined' ? globalThis : this);
