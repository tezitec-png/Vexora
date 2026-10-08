const Sim = (() => {
  function create(onTelemetry, log) {
    let t = 0;
    let limit = 25;
    let mode = 2;
    let running = false;
    let timer = null;
    const serial = "DEMO-G3";
    function snapshot() {
      t += .8;
      const cruise = 18 + Math.sin(t / 6) * 8;
      const speed = Math.max(0, Math.min(limit || 42, cruise + Math.sin(t * 1.7) * 1.4));
      const battery = Math.max(12, 78 - t * .04);
      return {
        ts: Date.now(),
        speed: +speed.toFixed(1),
        battery: Math.round(battery),
        limit: limit,
        rated: 25,
        range: +(battery * .42).toFixed(1),
        odo: 1842.3 + t * .004,
        trip: +(t * .012).toFixed(2),
        mode: mode,
        power: Math.round(speed * 18 + Math.random() * 40),
        demo: true,
        serial: serial
      };
    }
    return {
      demo: true,
      serial: serial,
      btName: serial,
      paired: false,
      connected: false,
      async pick() {
        return {
          name: serial
        };
      },
      async connect() {
        log("sim", "Demo — no hay Bluetooth real");
        running = true;
        this.paired = true;
        this.connected = true;
        const tick = () => {
          if (!running) return;
          onTelemetry(snapshot());
          timer = setTimeout(tick, 400);
        };
        tick();
      },
      startPoll() {},
      stopPoll() {
        running = false;
        if (timer) clearTimeout(timer);
        timer = null;
      },
      disconnect() {
        this.stopPoll();
        this.paired = false;
        this.connected = false;
        log("sim", "Demo cortada");
      },
      async setLimit(kmh) {
        limit = Math.max(0, Math.min(45, Math.round(kmh)));
        return {
          wrote: limit,
          readback: limit,
          ok: true
        };
      },
      async setMode(m) {
        mode = m;
      },
      async snapshot() {
        return snapshot();
      }
    };
  }
  return {
    create: create
  };
})();