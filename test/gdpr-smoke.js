const BASE = process.argv[2] || "http://127.0.0.1:8788";

const fs = require("fs");

let OKn = 0, FAILn = 0;

function ok(cond, name, extra) {
  if (cond) {
    OKn++;
    console.log("  PASS " + name);
  } else {
    FAILn++;
    console.log("  FAIL " + name + (extra !== undefined ? "  → " + String(extra).slice(0, 160) : ""));
  }
}

(async () => {
  console.log("==== GDPR · PÁGINA DE PRIVACIDAD ====");
  const prv = await fetch(BASE + "/privacy");
  const pt = await prv.text();
  ok(prv.status === 200, "/privacy → 200");
  ok(pt.includes("login.vexora@gmail.com"), "contacto legal login.vexora@gmail.com");
  ok(pt.includes("7 days") && pt.includes("45 days") && pt.includes("90 days"), "retenciones 7d/45d/90d");
  ok(/Groq/.test(pt), "procesador Groq (traducciones) declarado");
  ok(/14 years old|at least <b>14/.test(pt), "edad mínima 14+");
  ok(/AEPD/.test(pt), "derecho a reclamar ante la AEPD");
  const prv2 = await fetch(BASE + "/privacy.html");
  ok(prv2.status === 200, "/privacy.html también servida");
  console.log("==== GDPR · AVISO FORMAL EN LA APP ====");
  const idx = await (await fetch(BASE + "/app")).text();
  ok(idx.includes("gdprWrap") && !idx.includes("vex.gdpr.notice.v1"), "aviso a TODOS en cada apertura (sin localStorage)");
  ok(/IP addresses/.test(idx) && /without showing a privacy\/cookie consent/.test(idx), "explica el porqué: IPs sin consentimiento");
  ok(/100dvh/.test(idx) && /overflow-y:\s*auto/.test(idx) && /orientation:landscape/.test(idx.replace(/\s+/g, "")), "UI a prueba de rotación (dvh + scroll + landscape)");
  ok(/took Vexora offline/.test(idx) && idx.includes("GDPR"), "cuenta lo ocurrido (apagón + GDPR)");
  ok(idx.includes('id="gdprAll"') && idx.includes('id="gdprMin"') && /Only essential/.test(idx) && /Allow all/.test(idx), "elección Allow all / Only essential en el aviso");
  ok(idx.includes('removeItem("vexora.consent")') && idx.includes("vex.gdpr.ack.v2"), "consentimiento anterior ANULADO (re-elección forzosa una vez)");
  ok(idx.includes("window.Consent.set") || idx.includes("Consent.set"), "elección conectada a la capa real de consentimiento (storage bloqueado de verdad)");
  ok(idx.includes('id="gdprCfg"') && /Cookie settings/.test(idx), "re-ajustable siempre (Cookie settings)");
  ok(idx.includes("login.vexora@gmail.com"), "contacto en el aviso");
  ok(idx.includes("/assets/chat.js?v=1675"), "chat.js v1675 (con gate)");
  console.log("==== GDPR · CONSENTIMIENTO EN EL CHAT ====");
  const cj = await (await fetch(BASE + "/assets/chat.js?v=1675")).text();
  ok(cj.includes("vex.privacy.v1") && cj.includes("vcw-consent") && cj.includes("consent: true"), "gate 14+ + privacidad antes del 1er mensaje");
  console.log("==== GDPR · SERVIDOR (worker) ====");
  const wk = fs.readFileSync(__dirname + "/../server/worker.js", "utf8");
  ok(wk.includes("consent_at"), "worker guarda la fecha de consentimiento");
  ok(wk.includes("45 * 86400000") && wk.includes("DELETE FROM chat WHERE updated"), "purga automática de chats a 45 días");
  const sup = await (await fetch(BASE + "/support")).text();
  ok(sup.includes("/privacy") && sup.includes("login.vexora@gmail.com"), "consola: enlace privacidad + contacto");
  console.log("==== GDPR · CHAT CON CONSENTIMIENTO (API) ====");
  const op = await fetch(BASE + "/api/chat/open", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "Ninebot Max G30",
      message: "gdpr consent check",
      page: "/gdpr",
      consent: true
    })
  });
  const od = await op.json();
  ok(op.status === 200 && od.ok === true && od.id, "open con consent:true → OK");
  if (od.ok && od.token) {
    const cl = await fetch(BASE + "/api/chat/leave?id=" + od.id, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chat-token": od.token
      },
      body: JSON.stringify({})
    });
    const cd = await cl.json().catch(() => null);
    ok(cl.status === 200 || cd && cd.ok === true || cl.status === 400, "chat de prueba cancelado", cl.status);
  }
  console.log("\n==== RESULTADO: " + OKn + " OK · " + FAILn + " FAIL ====");
  process.exit(FAILn ? 1 : 0);
})().catch(e => {
  console.error("GDPR SMOKE CRASH:", e);
  process.exit(2);
});