(function(global) {
  "use strict";
  var X = {
    HOST: 62,
    VCU: 22,
    MCU: 2,
    BLE: 4,
    BMS: 7
  };
  var SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  var RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
  var TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
  var NAME_PREFIXES = [ "1CG", "1CM", "1K1", "N4G", "NBMax", "NBG30D", "NBSc", "MISc", "NB", "Segway", "NINEBOT", "Ninebot", "N2G", "S2", "S3", "ZT", "1TE" ];
  function sleep(ms) {
    return new Promise(function(r) {
      setTimeout(r, ms);
    });
  }
  function makeFrame(f) {
    if (f.data.length > 255) throw RangeError("frame too long");
    var t = new Uint8Array(7 + f.data.length);
    t[0] = 90;
    t[1] = 165;
    t[2] = f.data.length;
    t[3] = f.src;
    t[4] = f.dst;
    t[5] = f.cmd;
    t[6] = f.arg;
    t.set(f.data, 7);
    return t;
  }
  function parseFrame(e) {
    if (e.length < 7 || e[0] !== 90 || e[1] !== 165) return null;
    var len = e[2];
    if (e.length < 7 + len) return null;
    return {
      src: e[3],
      dst: e[4],
      cmd: e[5],
      arg: e[6],
      data: e.slice(7, 7 + len)
    };
  }
  var KEYSEED = Uint8Array.of(151, 207, 184, 2, 132, 65, 67, 222, 86, 0, 43, 59, 52, 120, 10, 93);
  async function sha1Key(a, b) {
    var n = new Uint8Array(32);
    n.set(a, 0);
    n.set(b, 16);
    return new Uint8Array(await crypto.subtle.digest("SHA-1", n)).slice(0, 16);
  }
  async function aesBlock(key, block) {
    var k = await crypto.subtle.importKey("raw", key, {
      name: "AES-CBC"
    }, false, [ "encrypt" ]);
    return new Uint8Array(await crypto.subtle.encrypt({
      name: "AES-CBC",
      iv: new Uint8Array(16)
    }, k, block)).slice(0, 16);
  }
  function xor16(a, b) {
    var d = new Uint8Array(16);
    for (var i = 0; i < 16; i++) d[i] = a[i] ^ b[i];
    return d;
  }
  class Nbc {
    constructor(name) {
      var enc = new TextEncoder;
      var d = typeof name === "string" ? enc.encode(name) : name;
      this.nameData = new Uint8Array(16);
      this.nameData.set(d.subarray(0, Math.min(16, d.length)));
      this.bleData = new Uint8Array(16);
      this.appData = new Uint8Array(16);
      this.sha1 = null;
      this.msgIt = 0;
      this.peerAddr = 0;
      this.initialKeyTail = new Uint8Array(14);
      this.initialKeyReceived = false;
      this.recalcReceived = false;
      this.pairedReceived = false;
    }
    async init() {
      this.sha1 = await sha1Key(this.nameData, KEYSEED);
    }
    setAppData(d) {
      if (d.length !== 16) throw Error("app_data must be 16 bytes");
      this.appData = d.slice();
    }
    async cryptoFirst(e) {
      var t = await aesBlock(this.sha1, KEYSEED);
      var n = new Uint8Array(e.length);
      for (var r = 0; r < e.length; r += 16) {
        var i = Math.min(16, e.length - r);
        for (var a = 0; a < i; a++) n[r + a] = e[r + a] ^ t[a];
      }
      return n;
    }
    async cryptoNext(e, t) {
      var n = new Uint8Array(16);
      n[0] = 1;
      n[1] = t >>> 24 & 255;
      n[2] = t >>> 16 & 255;
      n[3] = t >>> 8 & 255;
      n[4] = t & 255;
      n.set(this.bleData.subarray(0, 8), 5);
      var r = new Uint8Array(e.length), i = 0;
      for (var a = 0; a < e.length; a += 16) {
        i += 1;
        n[15] = i & 255;
        var o = await aesBlock(this.sha1, n);
        var s = Math.min(16, e.length - a);
        for (var c = 0; c < s; c++) r[a + c] = e[a + c] ^ o[c];
      }
      return r;
    }
    async computeMac(e, t) {
      var n = e.length - 3, r = new Uint8Array(16);
      r[0] = 89;
      r[1] = t >>> 24 & 255;
      r[2] = t >>> 16 & 255;
      r[3] = t >>> 8 & 255;
      r[4] = t & 255;
      r.set(this.bleData.subarray(0, 8), 5);
      r[15] = n & 255;
      var i = await aesBlock(this.sha1, r);
      var a = new Uint8Array(16);
      a.set(e.subarray(0, 3), 0);
      i = await aesBlock(this.sha1, xor16(a, i));
      for (var o = 0; o < n; o += 16) {
        var s = new Uint8Array(16);
        var l = Math.min(16, n - o);
        s.set(e.subarray(3 + o, 3 + o + l), 0);
        i = await aesBlock(this.sha1, xor16(s, i));
      }
      var u = new Uint8Array(16);
      u[0] = 1;
      u[1] = t >>> 24 & 255;
      u[2] = t >>> 16 & 255;
      u[3] = t >>> 8 & 255;
      u[4] = t & 255;
      u.set(this.bleData.subarray(0, 8), 5);
      var p = await aesBlock(this.sha1, u);
      return Uint8Array.of(p[0] ^ i[0], p[1] ^ i[1], p[2] ^ i[2], p[3] ^ i[3]);
    }
    async decrypt(e) {
      if (e.length < 9 || e[0] !== 90 || e[1] !== 165) return null;
      var t = this.msgIt, n = (e[e.length - 2] << 8 | e[e.length - 1]) & 65535;
      if (t & 32768 && !(e[e.length - 2] >> 7)) t += 65536;
      var r = t & 4294901760 | n;
      var i = e.length - 9, a = e.slice(3, 3 + i), o = e.slice(0, 3);
      var s = new Uint8Array(3 + i);
      s.set(o, 0);
      if (r === 0) {
        var c = await this.cryptoFirst(a);
        s.set(c, 3);
        if (s.length >= 23 && s[2] >= 22 && s[4] === 62 && s[5] === 91 && s[6] === 1) {
          this.bleData = s.slice(7, 23);
          this.peerAddr = s[3];
          if (s.length >= 37) this.initialKeyTail = s.slice(23, 37);
          this.sha1 = this.appData.some(function(v) {
            return v !== 0;
          }) ? await sha1Key(this.appData, this.bleData) : await sha1Key(this.nameData, this.bleData);
          this.initialKeyReceived = true;
        }
        return s;
      }
      var l = await this.cryptoNext(a, r);
      s.set(l, 3);
      if (s.length >= 23 && s[2] === 16 && s[3] === 62 && s[5] === 92 && s[6] === 0) this.appData = s.slice(7, 23);
      if (s.length >= 7 && s[2] === 0 && s[4] === 62 && s[5] === 92 && s[6] === 1) {
        this.sha1 = await sha1Key(this.appData, this.bleData);
        this.recalcReceived = true;
      }
      if (s.length >= 7 && s[2] === 0 && s[4] === 62 && s[5] === 93 && s[6] === 1) this.pairedReceived = true;
      this.msgIt = r;
      return s;
    }
    async encrypt(e) {
      if (e[0] !== 90 || e[1] !== 165) throw Error("frame must start with 5A A5");
      var t = e.slice(0, 3), n = e.slice(3);
      if (this.msgIt === 0) {
        var r = 0;
        for (var o of n) r = r + o & 65535;
        var i = (r ^ 65535) & 65535;
        var a = await this.cryptoFirst(n);
        var s = new Uint8Array(3 + a.length + 6);
        s.set(t, 0);
        s.set(a, 3);
        s[3 + a.length + 2] = i & 255;
        s[3 + a.length + 3] = i >>> 8 & 255;
        return s;
      }
      this.msgIt += 1;
      var c = await this.computeMac(e, this.msgIt);
      var l = await this.cryptoNext(n, this.msgIt);
      var u = new Uint8Array(3 + l.length + 6);
      u.set(t, 0);
      u.set(l, 3);
      u.set(c, 3 + l.length);
      u[3 + l.length + 4] = this.msgIt >>> 8 & 255;
      u[3 + l.length + 5] = this.msgIt & 255;
      return u;
    }
  }
  function createFrameAssembler(ble) {
    var listeners = new Set, buf = new Uint8Array(0);
    ble.onTx(function(chunk) {
      var merged = new Uint8Array(buf.length + chunk.length);
      merged.set(buf, 0);
      merged.set(chunk, buf.length);
      buf = merged;
      while (buf.length >= 3) {
        var start = -1;
        for (var i = 0; i <= buf.length - 2; i++) {
          if (buf[i] === 90 && buf[i + 1] === 165) {
            start = i;
            break;
          }
        }
        if (start < 0) {
          buf = buf.subarray(buf.length - 1);
          break;
        }
        if (start > 0) buf = buf.subarray(start);
        if (buf.length < 3) break;
        var frameLen = 3 + buf[2] + 10;
        if (buf.length < frameLen) break;
        var frame = buf.subarray(0, frameLen).slice();
        buf = buf.subarray(frameLen);
        listeners.forEach(function(cb) {
          cb(frame);
        });
      }
    });
    return {
      onFrame: function(cb) {
        listeners.add(cb);
        return function() {
          listeners.delete(cb);
        };
      }
    };
  }
  class BleDevice {
    constructor(device) {
      this.device = device;
      this.id = device.id;
      this.name = device.name || "Scooter";
      this._txChar = null;
      this._rxChar = null;
      this._listeners = [];
      this._writeChain = Promise.resolve();
      this.dead = false;
      this._linkCbs = [];
    }
    onTx(cb) {
      this._listeners.push(cb);
    }
    onLinkLost(cb) {
      this._linkCbs.push(cb);
    }
    _markDead() {
      if (this.dead) return;
      this.dead = true;
      this._linkCbs.forEach(function(cb) {
        try {
          cb();
        } catch (e) {}
      });
    }
    async connect() {
      this.dead = false;
      var server = await this.device.gatt.connect();
      this.device.addEventListener("gattserverdisconnected", this._markDead.bind(this));
      var svc = await server.getPrimaryService(SERVICE_UUID);
      this._rxChar = await svc.getCharacteristic(RX_UUID);
      this._txChar = await svc.getCharacteristic(TX_UUID);
      await this._txChar.startNotifications();
      this._txChar.addEventListener("characteristicvaluechanged", this._onValue.bind(this));
    }
    _onValue(ev) {
      var val = ev.target.value;
      if (val) {
        var data = new Uint8Array(val.buffer, val.byteOffset, val.byteLength).slice();
        for (var cb of this._listeners) cb(data);
      }
    }
    write(data) {
      var buf = new Uint8Array(data);
      var self = this;
      var run = this._writeChain.then(async function() {
        if (self.dead || !(self.device.gatt && self.device.gatt.connected)) throw new Error("Scooter is disconnected — reconnect and try again");
        try {
          if (self._rxChar.writeValueWithoutResponse) await self._rxChar.writeValueWithoutResponse(buf.buffer); else await self._rxChar.writeValue(buf.buffer);
        } catch (e) {
          if (!(self.device.gatt && self.device.gatt.connected)) self._markDead();
          throw e;
        }
      });
      this._writeChain = run.then(function() {}, function() {});
      return run;
    }
    async disconnect() {
      try {
        await this._txChar.stopNotifications();
      } catch (e) {}
      if (this.device.gatt && this.device.gatt.connected) this.device.gatt.disconnect();
    }
  }
  var KeyStore = {
    load: async function(id) {
      try {
        var raw = localStorage.getItem("nbc_" + id);
        return raw ? new Uint8Array(JSON.parse(raw)) : null;
      } catch (e) {
        return null;
      }
    },
    save: async function(id, data) {
      try {
        localStorage.setItem("nbc_" + id, JSON.stringify(Array.from(data)));
      } catch (e) {}
    },
    delete: async function(id) {
      try {
        localStorage.removeItem("nbc_" + id);
      } catch (e) {}
    }
  };
  class NbcSession {
    constructor(ble, bleName, store) {
      this.ble = ble;
      this.bleName = bleName;
      this.store = store || KeyStore;
      this.pending = [];
      this.dstTails = new Map;
      this.nbc = null;
      this.dead = false;
      this._aborted = false;
      this.assembler = createFrameAssembler(this.ble);
      this.assembler.onFrame(this._handleIncoming.bind(this));
      var self = this;
      ble.onLinkLost(function() {
        self.dead = true;
      });
    }
    _throwIfAborted() {
      if (this._aborted) throw new Error("cancelled");
    }
    isDead() {
      return !!(this._aborted || this.dead || this.ble && this.ble.dead);
    }
    async start(onPowerHint) {
      this._throwIfAborted();
      this.nbc = new Nbc(this.bleName);
      await this.nbc.init();
      this._throwIfAborted();
      var cached = await this.store.load(this.ble.id);
      if (cached && cached.length === 16) {
        this.nbc.setAppData(cached);
        try {
          await this._sendRequestInitialKey();
          await this._waitForInitialKey(1e4);
          this._throwIfAborted();
          await this._waitForConfirmReady(1e4);
          return;
        } catch (e) {
          this._throwIfAborted();
          await this.store.delete(this.ble.id);
          this.nbc = new Nbc(this.bleName);
          await this.nbc.init();
        }
      }
      this._throwIfAborted();
      await this._sendRequestInitialKey();
      await this._waitForInitialKey(1e4);
      if (onPowerHint) onPowerHint(true);
      for (var i = 0; i < 4; i++) await this._sendSaveAppKey();
      await this._waitForRecalcKey(6e4);
      this._throwIfAborted();
      if (onPowerHint) onPowerHint(false);
      await this._waitForConfirmReady(1e4);
      this._throwIfAborted();
      try {
        await this.store.save(this.ble.id, this.nbc.appData);
      } catch (e) {}
    }
    async _sendRequestInitialKey(dst) {
      this._throwIfAborted();
      if (dst == null) dst = this.bleName && this.bleName.indexOf("1CG") === 0 ? X.BLE : 33;
      this._keyDst = dst;
      await this.ble.write(await this.nbc.encrypt(Uint8Array.of(90, 165, 0, 62, dst, 91, 0)));
    }
    async _waitForInitialKey(timeout) {
      var chain = [ this._keyDst ];
      var alt = this._keyDst === X.BLE ? 33 : X.BLE;
      if (chain.indexOf(alt) < 0) chain.push(alt);
      if (chain.indexOf(X.VCU) < 0) chain.push(X.VCU);
      var perDst = Math.min(timeout || 1e4, 5e3);
      var t = Date.now(), lastSend = Date.now(), di = 0;
      while (!this.nbc.initialKeyReceived) {
        this._throwIfAborted();
        if (Date.now() - t > perDst) {
          di += 1;
          if (di >= chain.length) throw new Error("Handshake timeout");
          await this._sendRequestInitialKey(chain[di]);
          t = Date.now();
          lastSend = Date.now();
          continue;
        }
        if (Date.now() - lastSend > 1500) {
          await this._sendRequestInitialKey(chain[di]);
          lastSend = Date.now();
        }
        await sleep(100);
      }
    }
    async _sendSaveAppKey() {
      this._throwIfAborted();
      if (!this._pendingApp) this._pendingApp = crypto.getRandomValues(new Uint8Array(16));
      this.nbc.setAppData(this._pendingApp);
      var dst = this.nbc.peerAddr || X.BLE;
      var f = new Uint8Array(23);
      f.set([ 90, 165, 16, 62, dst, 92, 0 ], 0);
      f.set(this._pendingApp, 7);
      await this.ble.write(await this.nbc.encrypt(f));
    }
    async _waitForRecalcKey(timeout) {
      var t = Date.now(), last = Date.now();
      while (!this.nbc.recalcReceived) {
        this._throwIfAborted();
        if (Date.now() - t > timeout) throw new Error("Power button not pressed");
        if (Date.now() - last > 500) {
          await this._sendSaveAppKey();
          last = Date.now();
        }
        await sleep(50);
      }
      try {
        if (this._pendingApp) await this.store.save(this.ble.id, this._pendingApp);
      } catch (e) {}
    }
    async _sendConfirmReady() {
      this._throwIfAborted();
      var dst = this.nbc.peerAddr || X.BLE;
      var f = new Uint8Array(21);
      f.set([ 90, 165, 14, 62, dst, 93, 0 ], 0);
      f.set(this.nbc.initialKeyTail, 7);
      await this.ble.write(await this.nbc.encrypt(f));
    }
    async _waitForConfirmReady(timeout) {
      var t = Date.now(), last = 0;
      while (!this.nbc.pairedReceived) {
        this._throwIfAborted();
        if (Date.now() - t > timeout) throw new Error("Pairing not confirmed");
        if (Date.now() - last > 500) {
          await this._sendConfirmReady();
          last = Date.now();
        }
        await sleep(50);
      }
    }
    async _handleIncoming(raw) {
      if (!this.nbc) return;
      var dec;
      try {
        dec = await this.nbc.decrypt(raw);
      } catch (e) {
        return;
      }
      if (!dec) return;
      var frame = parseFrame(dec);
      if (!frame) return;
      if (frame.src === this.nbc.peerAddr && (frame.cmd === 91 || frame.cmd === 92 || frame.cmd === 93)) return;
      var idx = this.pending.findIndex(function(e) {
        return e.target === frame.src && (!e.expectedCmd || e.expectedCmd.has(frame.cmd));
      });
      if (idx >= 0) {
        var entry = this.pending.splice(idx, 1)[0];
        clearTimeout(entry.timer);
        entry.resolve(frame);
      }
    }
    request(frame, timeout, opts) {
      var dst = frame.dst;
      var prev = this.dstTails.get(dst) || Promise.resolve();
      var self = this;
      var run = prev.then(function() {
        return self._doRequest(frame, timeout, opts);
      }, function() {
        return self._doRequest(frame, timeout, opts);
      });
      var tail = run.then(function() {}, function() {});
      this.dstTails.set(dst, tail);
      tail.then(function() {
        if (self.dstTails.get(dst) === tail) self.dstTails.delete(dst);
      });
      return run;
    }
    flushPending() {
      this.pending.forEach(function(e) {
        clearTimeout(e.timer);
        try {
          e.reject(new Error("flushed"));
        } catch (x) {}
      });
      this.pending = [];
    }
    async _doRequest(frame, timeout, opts) {
      var self = this;
      if (this.isDead()) return Promise.reject(new Error("Scooter is disconnected — reconnect and try again"));
      var deadline = timeout || 1e4;
      return new Promise(function(resolve, reject) {
        var data = makeFrame(frame);
        var expected = opts && opts.expectedCmd ? new Set(Array.isArray(opts.expectedCmd) ? opts.expectedCmd : [ opts.expectedCmd ]) : null;
        var entry = {
          target: frame.dst,
          expectedCmd: expected,
          resolve: resolve,
          reject: reject
        };
        var timer = setTimeout(function() {
          var idx = self.pending.indexOf(entry);
          if (idx >= 0) self.pending.splice(idx, 1);
          reject(new Error("timeout dst=0x" + frame.dst.toString(16) + " cmd=0x" + frame.cmd.toString(16) + " arg=0x" + frame.arg.toString(16)));
        }, deadline);
        entry.timer = timer;
        self.pending.push(entry);
        self.nbc.encrypt(data).then(function(enc) {
          return self.ble.write(enc);
        }).catch(function(err) {
          clearTimeout(timer);
          var idx = self.pending.indexOf(entry);
          if (idx >= 0) self.pending.splice(idx, 1);
          reject(err);
        });
      });
    }
    async sendNoReply(frame) {
      if (this.isDead()) throw new Error("Scooter is disconnected — reconnect and try again");
      var enc = await this.nbc.encrypt(makeFrame(frame));
      await this.ble.write(enc);
    }
    async readRegister(dst, reg, len, timeout) {
      var f = {
        src: X.HOST,
        dst: dst,
        cmd: 1,
        arg: reg,
        data: Uint8Array.of(len & 255, len >> 8 & 255)
      };
      var resp = await this.request(f, timeout || 1500, {
        expectedCmd: 4
      });
      if (resp.arg !== reg) throw new Error("readRegister arg mismatch");
      if (resp.data.length !== len) throw new Error("readRegister length mismatch");
      return resp.data;
    }
    async writeRegister(dst, reg, data, timeout) {
      var f = {
        src: X.HOST,
        dst: dst,
        cmd: 2,
        arg: reg,
        data: data
      };
      var resp = await this.request(f, timeout || 1500, {
        expectedCmd: 5
      });
      if (resp.cmd !== 5 || resp.arg !== reg) throw new Error("writeRegister unexpected ack");
      if (resp.data.length >= 2 && resp.data[0] | resp.data[1] << 8) throw new Error("The scooter refused the change (write rejected)");
    }
    async writeRegisterFlash(dst, reg, data) {
      await this.sendNoReply({
        src: X.HOST,
        dst: dst,
        cmd: 3,
        arg: reg,
        data: data
      });
    }
    async setCap(kmh, timeout) {
      kmh = Math.max(0, Math.min(255, kmh | 0));
      var resp = await this.request({
        src: X.HOST,
        dst: X.VCU,
        cmd: 248,
        arg: kmh,
        data: new Uint8Array(0)
      }, timeout || 1500, {
        expectedCmd: 249
      });
      return resp.arg;
    }
    async calibRead(dst, offset, len, timeout) {
      var f = {
        src: X.HOST,
        dst: dst,
        cmd: 174,
        arg: offset,
        data: Uint8Array.of(len & 255, len >> 8 & 255)
      };
      var resp = await this.request(f, timeout || 900, {
        expectedCmd: 174
      });
      if (resp.arg !== offset) throw new Error("calib read arg mismatch off=0x" + offset.toString(16));
      return resp.data;
    }
    async calibWrite(dst, offset, data, timeout) {
      if (offset < 0 || data.length < 1 || offset + data.length > 256) throw new Error("calib write out of range");
      var f = {
        src: X.HOST,
        dst: dst,
        cmd: 173,
        arg: offset,
        data: data
      };
      var resp = await this.request(f, timeout || 1800, {
        expectedCmd: 173
      });
      if (resp.arg !== offset) throw new Error("calib write ack arg mismatch");
    }
    async flashReadSlot(slot, len, timeout) {
      var f = {
        src: X.HOST,
        dst: X.VCU,
        cmd: 241,
        arg: slot,
        data: new Uint8Array(0)
      };
      var resp = await this.request(f, timeout || 5e3, {
        expectedCmd: 244
      });
      if (resp.arg !== slot) throw new Error("f-read slot 0x" + slot.toString(16) + " rejected");
      if (resp.data.length !== len) throw new Error("f-read length mismatch expected " + len + " got " + resp.data.length);
      return resp.data;
    }
    async flashWriteSlot(slot, data, timeout) {
      var f = {
        src: X.HOST,
        dst: X.VCU,
        cmd: 242,
        arg: slot,
        data: data
      };
      var resp = await this.request(f, timeout || 5e3, {
        expectedCmd: 245
      });
      if (resp.arg !== slot) throw new Error("f-write slot 0x" + slot.toString(16) + " rejected");
    }
    async close() {
      this._aborted = true;
      this.dead = true;
      this.pending.forEach(function(e) {
        clearTimeout(e.timer);
        e.reject(new Error("session closed"));
      });
      this.pending = [];
      await this.ble.disconnect();
    }
  }
  var PROFILES = {
    ble: {
      dst: X.BLE,
      pageSize: 128,
      hd: true,
      postWaitMs: 8e3,
      pageTimeoutMs: 5e3,
      startTimeoutMs: 5e3,
      interPageDelayMs: 0,
      startExpected: [ 7, 11 ],
      pageExpected: [ 8, 11 ],
      csExpected: [ 9, 11 ]
    },
    vcu: {
      dst: X.VCU,
      pageSize: 128,
      hd: false,
      postWaitMs: 8e3,
      pageTimeoutMs: 2e3,
      startTimeoutMs: 5e3,
      interPageDelayMs: 0,
      startExpected: [ 7, 11 ],
      pageExpected: [ 8, 11 ],
      csExpected: [ 9, 11 ]
    },
    mcu: {
      dst: X.MCU,
      pageSize: 128,
      hd: false,
      postWaitMs: 8e3,
      pageTimeoutMs: 6e3,
      startTimeoutMs: 9e3,
      interPageDelayMs: 15,
      startExpected: [ 7, 11 ],
      pageExpected: [ 8, 11 ],
      csExpected: [ 9, 11 ]
    },
    bms: {
      dst: X.BMS,
      pageSize: 128,
      hd: false,
      postWaitMs: 8e3,
      pageTimeoutMs: 2e3,
      startTimeoutMs: 5e3,
      interPageDelayMs: 0,
      startExpected: [ 7, 11 ],
      pageExpected: [ 8, 11 ],
      csExpected: [ 9, 11 ]
    }
  };
  var WAKE = {
    reg: 228,
    regLen: 6,
    cmd: 121,
    payload: Uint8Array.of(1, 0),
    pollMs: 800,
    settleMs: 700,
    timeoutMs: 15e3,
    probeMs: 1500
  };
  var MCU_ARM_REG = 232, MCU_ARM_DATA = Uint8Array.of(67, 77);
  var MAX_RECONNECTS = 2;
  function isLinkError(e) {
    var m = e && e.message || String(e || "");
    return /is disconnected|not connected|NetworkError|Connection (closed|lost)|No device selected/i.test(m);
  }
  function linkLostText() {
    return "Connection lost · Bluetooth dropped during the update. The scooter may have rebooted or gone out of range. Turn it off and on, press Reconnect, then flash again.";
  }
  function checkAck(label, ack) {
    if (ack === 0) return;
    if (ack === 7) throw new Error(label + " rejected (ACK=7) · your scooter has locked firmware. It cannot be flashed over Bluetooth — it has to be unlocked with an ST-Link first.");
    if (ack === 255) throw new Error(label + " stopped (ACK=255) · the scooter cancelled the update. Turn it off and on, reconnect and try again.");
    if (ack === 9) throw new Error(label + " failed (ACK=9) · the scooter restarted itself during the update. Turn it off and on, reconnect and try again. If it always stops at 0%, flash the stock firmware first.");
    throw new Error(label + " failed (ACK=0x" + ack.toString(16) + ") · the scooter refused the update. Turn it off and on, reconnect and try again.");
  }
  async function isAwake(session) {
    try {
      return (await session.readRegister(X.MCU, WAKE.reg, WAKE.regLen, WAKE.probeMs)).length > 0;
    } catch (e) {
      return false;
    }
  }
  async function wakeUnit(session, onPhase) {
    if (await isAwake(session)) return true;
    if (onPhase) onPhase("waking");
    var nudge = async function() {
      try {
        await session.sendNoReply({
          src: X.HOST,
          dst: X.VCU,
          cmd: WAKE.cmd,
          arg: 0,
          data: WAKE.payload
        });
      } catch (e) {}
      try {
        await session.sendNoReply({
          src: X.HOST,
          dst: X.VCU,
          cmd: WAKE.cmd,
          arg: 0,
          data: WAKE.payload
        });
      } catch (e) {}
    };
    await nudge();
    var t0 = Date.now(), again = false;
    for (;;) {
      await sleep(WAKE.pollMs);
      if (await isAwake(session)) {
        await sleep(WAKE.settleMs);
        return true;
      }
      var waited = Date.now() - t0;
      if (!again && waited >= WAKE.timeoutMs / 2) {
        again = true;
        await nudge();
      }
      if (waited >= WAKE.timeoutMs) throw new Error("Scooter is not responding · wake it (press the power button), keep the phone next to it and retry.");
    }
  }
  function pageSlice(fw, idx, size) {
    var off = idx * size, b = new Uint8Array(size), n = Math.min(size, fw.length - off);
    if (n > 0) b.set(fw.subarray(off, off + n), 0);
    return b;
  }
  function startPayload(len, md5, hd) {
    var b = new Uint8Array(hd ? 20 : 4);
    b[0] = len & 255;
    b[1] = len >>> 8 & 255;
    b[2] = len >>> 16 & 255;
    b[3] = len >>> 24 & 255;
    if (hd && md5) b.set(md5, 4);
    return b;
  }
  function frame(dst, cmd, arg, data) {
    return {
      src: X.HOST,
      dst: dst,
      cmd: cmd,
      arg: arg,
      data: data
    };
  }
  async function uploadPagesBatched(session, p, fw, onProgress) {
    var total = Math.ceil(fw.length / p.pageSize);
    var idx = 0;
    while (idx < total) {
      var opening = idx === 0;
      if (!opening) {
        var ack = await session.request(frame(p.dst, 8, 0, pageSlice(fw, idx, p.pageSize)), 5e3, {
          expectedCmd: [ 8, 11 ]
        });
        checkAck("update_page", ack.arg);
        idx += 1;
        if (onProgress) onProgress(idx, total);
        if (idx >= total) break;
      }
      var from = idx, to = Math.min(from + (opening ? 8 : 7), total);
      for (var k = from; k < to; k++) {
        await session.sendNoReply(frame(p.dst, 8, k & 7, pageSlice(fw, k, p.pageSize)));
      }
      idx = to;
      if (onProgress) onProgress(idx, total);
    }
  }
  async function uploadPagesSequential(session, p, fw, onProgress) {
    var total = Math.ceil(fw.length / p.pageSize);
    for (var idx = 0; idx < total; idx++) {
      var ack = await session.request(frame(p.dst, 8, idx & 255, pageSlice(fw, idx, p.pageSize)), p.pageTimeoutMs, {
        expectedCmd: p.pageExpected
      });
      checkAck("update_page", ack.arg);
      if (onProgress) onProgress(idx + 1, total);
      if (p.interPageDelayMs > 0) await sleep(p.interPageDelayMs);
    }
  }
  function md5bytes(bytes) {
    function cmn(q, a, b, x, s, t) {
      a = a + (q + x + t) | 0;
      return (a << s | a >>> 32 - s) + b | 0;
    }
    function ff(a, b, c, d, x, s, t) {
      return cmn(b & c | ~b & d, a, b, x, s, t);
    }
    function gg(a, b, c, d, x, s, t) {
      return cmn(b & d | c & ~d, a, b, x, s, t);
    }
    function hh(a, b, c, d, x, s, t) {
      return cmn(b ^ c ^ d, a, b, x, s, t);
    }
    function ii(a, b, c, d, x, s, t) {
      return cmn(c ^ (b | ~d), a, b, x, s, t);
    }
    var n = bytes.length, state = new Int32Array([ 1732584193, -271733879, -1732584194, 271733878 ]);
    function md5blk(x) {
      var a = state[0], b = state[1], c = state[2], d = state[3];
      a = ff(a, b, c, d, x[0], 7, -680876936);
      d = ff(d, a, b, c, x[1], 12, -389564586);
      c = ff(c, d, a, b, x[2], 17, 606105819);
      b = ff(b, c, d, a, x[3], 22, -1044525330);
      a = ff(a, b, c, d, x[4], 7, -176418897);
      d = ff(d, a, b, c, x[5], 12, 1200080426);
      c = ff(c, d, a, b, x[6], 17, -1473231341);
      b = ff(b, c, d, a, x[7], 22, -45705983);
      a = ff(a, b, c, d, x[8], 7, 1770035416);
      d = ff(d, a, b, c, x[9], 12, -1958414417);
      c = ff(c, d, a, b, x[10], 17, -42063);
      b = ff(b, c, d, a, x[11], 22, -1990404162);
      a = ff(a, b, c, d, x[12], 7, 1804603682);
      d = ff(d, a, b, c, x[13], 12, -40341101);
      c = ff(c, d, a, b, x[14], 17, -1502002290);
      b = ff(b, c, d, a, x[15], 22, 1236535329);
      a = gg(a, b, c, d, x[1], 5, -165796510);
      d = gg(d, a, b, c, x[6], 9, -1069501632);
      c = gg(c, d, a, b, x[11], 14, 643717713);
      b = gg(b, c, d, a, x[0], 20, -373897302);
      a = gg(a, b, c, d, x[5], 5, -701558691);
      d = gg(d, a, b, c, x[10], 9, 38016083);
      c = gg(c, d, a, b, x[15], 14, -660478335);
      b = gg(b, c, d, a, x[4], 20, -405537848);
      a = gg(a, b, c, d, x[9], 5, 568446438);
      d = gg(d, a, b, c, x[14], 9, -1019803690);
      c = gg(c, d, a, b, x[3], 14, -187363961);
      b = gg(b, c, d, a, x[8], 20, 1163531501);
      a = gg(a, b, c, d, x[13], 5, -1444681467);
      d = gg(d, a, b, c, x[2], 9, -51403784);
      c = gg(c, d, a, b, x[7], 14, 1735328473);
      b = gg(b, c, d, a, x[12], 20, -1926607734);
      a = hh(a, b, c, d, x[5], 4, -378558);
      d = hh(d, a, b, c, x[8], 11, -2022574463);
      c = hh(c, d, a, b, x[11], 16, 1839030562);
      b = hh(b, c, d, a, x[14], 23, -35309556);
      a = hh(a, b, c, d, x[1], 4, -1530992060);
      d = hh(d, a, b, c, x[4], 11, 1272893353);
      c = hh(c, d, a, b, x[7], 16, -155497632);
      b = hh(b, c, d, a, x[10], 23, -1094730640);
      a = hh(a, b, c, d, x[13], 4, 681279174);
      d = hh(d, a, b, c, x[0], 11, -358537222);
      c = hh(c, d, a, b, x[3], 16, -722521979);
      b = hh(b, c, d, a, x[6], 23, 76029189);
      a = hh(a, b, c, d, x[9], 4, -640364487);
      d = hh(d, a, b, c, x[12], 11, -421815835);
      c = hh(c, d, a, b, x[15], 16, 530742520);
      b = hh(b, c, d, a, x[2], 23, -995338651);
      a = ii(a, b, c, d, x[0], 6, -198630844);
      d = ii(d, a, b, c, x[7], 10, 1126891415);
      c = ii(c, d, a, b, x[14], 15, -1416354905);
      b = ii(b, c, d, a, x[5], 21, -57434055);
      a = ii(a, b, c, d, x[12], 6, 1700485571);
      d = ii(d, a, b, c, x[3], 10, -1894986606);
      c = ii(c, d, a, b, x[10], 15, -1051523);
      b = ii(b, c, d, a, x[1], 21, -2054922799);
      a = ii(a, b, c, d, x[8], 6, 1873313359);
      d = ii(d, a, b, c, x[15], 10, -30611744);
      c = ii(c, d, a, b, x[6], 15, -1560198380);
      b = ii(b, c, d, a, x[13], 21, 1309151649);
      a = ii(a, b, c, d, x[4], 6, -145523070);
      d = ii(d, a, b, c, x[11], 10, -1120210379);
      c = ii(c, d, a, b, x[2], 15, 718787259);
      b = ii(b, c, d, a, x[9], 21, -343485551);
      state[0] = state[0] + a | 0;
      state[1] = state[1] + b | 0;
      state[2] = state[2] + c | 0;
      state[3] = state[3] + d | 0;
    }
    var i = 0, block = new Int32Array(16);
    for (;i + 64 <= n; i += 64) {
      for (var j = 0; j < 16; j++) block[j] = bytes[i + j * 4] | bytes[i + j * 4 + 1] << 8 | bytes[i + j * 4 + 2] << 16 | bytes[i + j * 4 + 3] << 24;
      md5blk(block);
    }
    var tail = new Uint8Array(64);
    tail.set(bytes.subarray(i));
    tail[n - i] = 128;
    if (n - i >= 56) {
      for (var j2 = 0; j2 < 16; j2++) block[j2] = tail[j2 * 4] | tail[j2 * 4 + 1] << 8 | tail[j2 * 4 + 2] << 16 | tail[j2 * 4 + 3] << 24;
      md5blk(block);
      tail = new Uint8Array(64);
    }
    var bitLen = n * 8;
    tail[56] = bitLen & 255;
    tail[57] = bitLen >>> 8 & 255;
    tail[58] = bitLen >>> 16 & 255;
    tail[59] = bitLen >>> 24 & 255;
    for (var j3 = 0; j3 < 16; j3++) block[j3] = tail[j3 * 4] | tail[j3 * 4 + 1] << 8 | tail[j3 * 4 + 2] << 16 | tail[j3 * 4 + 3] << 24;
    md5blk(block);
    var out = new Uint8Array(16);
    for (var e = 0; e < 4; e++) {
      var r = state[e];
      out[e * 4] = r & 255;
      out[e * 4 + 1] = r >>> 8 & 255;
      out[e * 4 + 2] = r >>> 16 & 255;
      out[e * 4 + 3] = r >>> 24 & 255;
    }
    return out;
  }
  async function runUpdate(session, partition, firmware, onPhase, onProgress) {
    var p = PROFILES[partition];
    if (!p) throw new Error("Unknown partition: " + partition);
    if (!firmware || !firmware.length) throw new Error("Empty firmware image");
    if (onPhase) onPhase("preparing");
    await wakeUnit(session, onPhase);
    if (partition === "mcu") {
      try {
        await session.writeRegister(X.MCU, MCU_ARM_REG, MCU_ARM_DATA);
      } catch (e) {
        try {
          await session.sendNoReply({
            src: X.HOST,
            dst: X.MCU,
            cmd: 4,
            arg: MCU_ARM_REG,
            data: MCU_ARM_DATA
          });
        } catch (e2) {}
      }
    }
    var md5 = p.hd ? md5bytes(firmware) : null;
    if (session.flushPending) session.flushPending();
    if (onPhase) onPhase("starting");
    var ack = await session.request(frame(p.dst, 7, 0, startPayload(firmware.length, md5, p.hd)), p.startTimeoutMs, {
      expectedCmd: p.startExpected
    });
    checkAck("start_update", ack.arg);
    if (onPhase) onPhase("flashing");
    if (p.hd) await uploadPagesBatched(session, p, firmware, onProgress); else await uploadPagesSequential(session, p, firmware, onProgress);
    if (onPhase) onPhase("finalizing");
    var sum = 0;
    for (var i = 0; i < firmware.length; i++) sum = sum + firmware[i] | 0;
    var inv = ~sum >>> 0;
    var csAck = await session.request(frame(p.dst, 9, 0, Uint8Array.of(inv & 255, inv >>> 8 & 255, inv >>> 16 & 255, inv >>> 24 & 255)), 1e4, {
      expectedCmd: p.csExpected
    });
    checkAck("update_checksum", csAck.arg);
    if (onPhase) onPhase("resetting");
    for (var r = 0; r < 4; r++) {
      try {
        await session.sendNoReply(frame(p.dst, 10, 0, new Uint8Array(0)));
      } catch (e) {}
      await sleep(100);
    }
    if (onPhase) onPhase("post-wait");
    await sleep(p.postWaitMs);
    if (onPhase) onPhase("done");
  }
  var connectHandle = {
    session: null,
    ble: null,
    device: null,
    aborted: false,
    gen: 0
  };
  function dropGatt(device) {
    try {
      if (device && device.gatt && device.gatt.connected) device.gatt.disconnect();
    } catch (e) {}
  }
  function abortConnect() {
    connectHandle.aborted = true;
    connectHandle.gen = (connectHandle.gen || 0) + 1;
    var s = connectHandle.session, ble = connectHandle.ble, dev = connectHandle.device;
    if (s) s._aborted = true;
    dropGatt(ble && ble.device || dev);
    if (s) {
      try {
        s.close();
      } catch (e) {}
    } else if (ble) {
      try {
        ble.disconnect();
      } catch (e) {}
    }
    connectHandle.session = null;
    connectHandle.ble = null;
  }
  function emitStatus(onStatus, phase, msg, extra) {
    extra = extra || {};
    extra.phase = phase;
    extra.power = extra.power === true;
    if (onStatus) onStatus(msg, extra);
  }
  async function requestScooter(anyDevice) {
    if (anyDevice) {
      return navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [ SERVICE_UUID ]
      });
    }
    return navigator.bluetooth.requestDevice({
      filters: NAME_PREFIXES.map(function(p) {
        return {
          namePrefix: p
        };
      }),
      optionalServices: [ SERVICE_UUID ]
    });
  }
  async function gapName(device) {
    try {
      var server = device.gatt;
      if (!server || !server.connected) return "";
      var svc = await server.getPrimaryService("generic_access");
      var ch = await svc.getCharacteristic("gap.device_name");
      var v = await ch.readValue();
      return (new TextDecoder).decode(v.buffer).replace(/\0/g, "").trim();
    } catch (e) {
      return "";
    }
  }
  async function pairKnownDevice(device, onStatus) {
    if (!device) throw new Error("No device");
    if (connectHandle.aborted) throw new Error("cancelled");
    connectHandle.session = null;
    connectHandle.ble = null;
    connectHandle.device = device;
    var gen = connectHandle.gen;
    function cancelled() {
      return connectHandle.aborted || connectHandle.gen !== gen;
    }
    var bleName = device.name || "";
    emitStatus(onStatus, "gatt", "Connecting to " + (bleName || "scooter"));
    var ble = new BleDevice(device);
    connectHandle.ble = ble;
    await ble.connect();
    if (cancelled()) {
      try {
        await ble.disconnect();
      } catch (e) {}
      throw new Error("cancelled");
    }
    if (!bleName) bleName = await gapName(device);
    if (!bleName) bleName = "Scooter";
    ble.name = bleName;
    var session = new NbcSession(ble, bleName);
    connectHandle.session = session;
    if (cancelled()) {
      try {
        await session.close();
      } catch (e) {}
      throw new Error("cancelled");
    }
    emitStatus(onStatus, "nbc", "Pairing");
    await session.start(function(waiting) {
      if (cancelled()) return;
      if (waiting) emitStatus(onStatus, "power", "Press the power button once", {
        power: true
      }); else emitStatus(onStatus, "nbc", "Finishing", {
        power: false
      });
    });
    if (cancelled()) {
      try {
        await session.close();
      } catch (e) {}
      throw new Error("cancelled");
    }
    emitStatus(onStatus, "ready", "Connected");
    try {
      localStorage.setItem("vexora.ble.id", device.id || "");
      localStorage.setItem("vexora.ble.name", bleName);
    } catch (e) {}
    return session;
  }
  async function pickAndConnect(onStatus, anyDevice) {
    if (!navigator.bluetooth) throw new Error("Web Bluetooth unavailable. Use Chrome or Edge over HTTPS.");
    connectHandle.aborted = false;
    connectHandle.session = null;
    connectHandle.ble = null;
    connectHandle.device = null;
    var gen = connectHandle.gen;
    function cancelled() {
      return connectHandle.aborted || connectHandle.gen !== gen;
    }
    emitStatus(onStatus, "pick", "Select a scooter");
    var device = await requestScooter(!!anyDevice);
    if (cancelled()) {
      dropGatt(device);
      throw new Error("cancelled");
    }
    return pairKnownDevice(device, onStatus);
  }
  async function reconnectLast(onStatus) {
    if (!navigator.bluetooth) throw new Error("Web Bluetooth unavailable. Use Chrome or Edge over HTTPS.");
    if (typeof navigator.bluetooth.getDevices !== "function") throw new Error("Reconnect needs Chrome or Edge.");
    connectHandle.aborted = false;
    connectHandle.session = null;
    connectHandle.ble = null;
    connectHandle.device = null;
    emitStatus(onStatus, "pick", "Reconnecting");
    var list = await navigator.bluetooth.getDevices();
    if (!list || !list.length) throw new Error("No saved scooter. Use Connect first.");
    var last = "";
    try {
      last = localStorage.getItem("vexora.ble.id") || "";
    } catch (e) {}
    var device = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === last) {
        device = list[i];
        break;
      }
    }
    if (!device) device = list[0];
    return pairKnownDevice(device, onStatus);
  }
  async function listPaired() {
    if (!navigator.bluetooth || typeof navigator.bluetooth.getDevices !== "function") return [];
    try {
      return await navigator.bluetooth.getDevices();
    } catch (e) {
      return [];
    }
  }
  async function reopenSession(session, onStatus) {
    var device = session && session.ble && session.ble.device;
    if (!device) throw new Error("No device to reconnect to");
    connectHandle.aborted = false;
    connectHandle.gen = (connectHandle.gen || 0) + 1;
    try {
      if (device.gatt && device.gatt.connected) device.gatt.disconnect();
    } catch (e) {}
    try {
      await session.close();
    } catch (e) {}
    await sleep(600);
    return await pairKnownDevice(device, onStatus);
  }
  async function waitForUnit(session, callbacks) {
    callbacks = callbacks || {};
    var onPhase = callbacks.onPhase || function() {};
    var graceMs = callbacks.graceMs == null ? 4e3 : callbacks.graceMs;
    var probeMs = callbacks.probeMs == null ? 18e3 : callbacks.probeMs;
    var totalMs = callbacks.totalMs == null ? 6e4 : callbacks.totalMs;
    var deadline = Date.now() + totalMs;
    onPhase("rebooting");
    await sleep(graceMs);
    if (session && !session.isDead()) {
      var probeDeadline = Math.min(deadline, Date.now() + probeMs);
      while (Date.now() < probeDeadline && !session.isDead()) {
        try {
          await session.readRegister(X.VCU, 16, 14, 1500);
          onPhase("live");
          return session;
        } catch (e) {}
        await sleep(1e3);
      }
    }
    onPhase("reconnecting");
    var back = null;
    while (Date.now() < deadline && !back) {
      try {
        back = await reopenSession(session, callbacks.onStatus);
        if (back && back.request) break;
        back = null;
      } catch (e) {
        back = null;
      }
      if (!back) await sleep(1500);
    }
    if (back) {
      onPhase("live");
      return back;
    }
    onPhase("failed");
    return null;
  }
  async function flash(partition, firmwareBytes, callbacks) {
    callbacks = callbacks || {};
    var onStatus = callbacks.onStatus || function() {};
    var onPhase = callbacks.onPhase || function() {};
    var onProgress = callbacks.onProgress || function() {};
    partition = (partition || "mcu").toLowerCase();
    if (!PROFILES[partition]) throw new Error("Unsupported partition: " + partition);
    var session = callbacks.session;
    var own = false;
    if (!session || !session.request) {
      session = await pickAndConnect(onStatus);
      own = true;
    }
    var reconnect = callbacks.reconnect || reopenSession;
    var tries = 0;
    try {
      for (;;) {
        try {
          await runUpdate(session, partition, firmwareBytes, onPhase, onProgress);
          onStatus("Done. Scooter reboots.");
          return session;
        } catch (e) {
          if (!isLinkError(e)) throw e;
          var back = false;
          while (tries < MAX_RECONNECTS && !back) {
            tries++;
            onStatus("Connection lost · reconnecting (" + tries + "/" + MAX_RECONNECTS + ")");
            if (onPhase) onPhase("reconnecting");
            await sleep(tries === 1 ? 1500 : 3500);
            try {
              var next = await reconnect(session, onStatus);
              if (next && next.request) {
                session = next;
                if (!callbacks.session) own = true;
                if (callbacks.onSession) try {
                  callbacks.onSession(next);
                } catch (e3) {}
                back = true;
                onStatus("Reconnected · restarting update");
                await sleep(400);
              }
            } catch (e2) {}
          }
          if (!back) throw new Error(linkLostText());
        }
      }
    } finally {
      if (own) {
        try {
          await session.close();
        } catch (e) {}
      }
    }
  }
  async function flashMcu(firmwareBytes, callbacks) {
    return flash("mcu", firmwareBytes, callbacks);
  }
  global.CfwFlasher = {
    flash: flash,
    flashMcu: flashMcu,
    flashVcu: function(b, c) {
      return flash("vcu", b, c);
    },
    flashBle: function(b, c) {
      return flash("ble", b, c);
    },
    flashBms: function(b, c) {
      return flash("bms", b, c);
    },
    connect: pickAndConnect,
    connectAny: function(cb) {
      return pickAndConnect(cb, true);
    },
    pick: async function() {
      return requestScooter(false);
    },
    connectDevice: function(device, onStatus) {
      connectHandle.aborted = false;
      connectHandle.session = null;
      connectHandle.device = null;
      connectHandle.ble = null;
      return pairKnownDevice(device, onStatus);
    },
    reconnect: reconnectLast,
    listPaired: listPaired,
    abortConnect: abortConnect,
    waitForUnit: waitForUnit,
    reopen: reopenSession,
    X: X,
    PROFILES: PROFILES
  };
})(window);