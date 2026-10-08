#!/usr/bin/env node
/**
 * Vexora · build de protección
 * Genera protected/ a partir de public/ (fuente legible):
 *  - JS propio  -> ofuscado (strings cifradas RC4, identificadores ilegibles,
 *                  anti-debug que bloquea DevTools, anti-reformateo)
 *  - sw.js      -> solo minificado (un service worker debe ser 100% fiable)
 *  - vendor     -> intacto (jszip, librería open-source)
 *  - HTML       -> comentarios fuera + scripts inline minificados
 *
 * Uso:  node build-protect.js   (después de editar public/)
 * Nota: los globals entre archivos (TEA, Sim, VEXORA, showView…) se
 * preservan con renameGlobals:false + reservedNames + prefijo único por archivo.
 */
const fs = require("fs");
const path = require("path");
const JavaScriptObfuscator = require("javascript-obfuscator");
const { minify } = require("terser");

const SRC = path.join(__dirname, "public");
const DST = path.join(__dirname, "protected");

// JS propio que se ofusca (todo menos vendor y sw.js)
const OBFUSCATE = [
  "assets/vexora.js", "assets/i18n.js", "assets/consent.js",
  "assets/flasher.js", "assets/sim.js", "assets/live.js",
  "assets/app.js", "assets/extra.js", "assets/polish.js", "assets/tire.js",
  "cfw/assets/cfw.js",
  "forge/assets/zip3.js", "forge/assets/app.js",
];

// Worker del servidor (v1.8.0): server/worker.js -> protected/_worker.js.
// Ofuscado SIN selfDefending (no hace falta en servidor y es más fiable en workerd);
// al final se le añade el `export default` (módulo ES de Pages advanced mode).
const SERVER_SRC = path.join(__dirname, "server", "worker.js");

// Globals compartidos entre archivos: NUNCA renombrar
const RESERVED = [
  "TEA", "Sim", "ZIP3", "VEXORA", "Vexora", "VexoraLive", "VexoraCfw",
  "VexoraX", "I18N", "Consent", "showView", "JSZip",
  "lastBuiltFirmwareEnc", "lastBuiltPartition",
  "abortConnect", "checkAck", "createFrameAssembler", "dropGatt",
  "emitStatus", "frame", "isLinkError", "linkLostText",
];

const OBF_OPTS = (prefix) => ({
  compact: true,
  // (Sin debugProtection: F12/DevTools queda usable; se decidió no bloquearlo.
  // La protección sigue siendo strings RC4 + identificadores ilegibles.)
  // Rompe el código si alguien lo reformatea/prettifica
  selfDefending: true,
  // Cifrado de todas las cadenas (RC4) — nada legible
  stringArray: true,
  stringArrayEncoding: ["rc4"],
  stringArrayThreshold: 1,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersType: "function",
  // Identificadores ilegibles, únicos por archivo (sin colisiones entre scripts)
  identifierNamesGenerator: "hexadecimal",
  identifiersPrefix: prefix,
  renameGlobals: false,
  reservedNames: RESERVED,
  // Extras
  transformObjectKeys: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  unicodeEscapeSequence: false,
  // Rendimiento: sin aplanado de control (el flasher/BLE va a tiempo real)
  controlFlowFlattening: false,
  deadCodeInjection: false,
  disableConsoleOutput: false,
});

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name === ".DS_Store") continue;
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function minifyInlineHtml(html) {
  // 1) minificar cada <script> inline (sin src) con terser
  const scripts = [];
  html = html.replace(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, (m, code) => {
    scripts.push(code);
    return "<script>__INLINE_" + (scripts.length - 1) + "__</script>";
  });
  for (let i = 0; i < scripts.length; i++) {
    const r = await minify(scripts[i], { compress: true, mangle: true, format: { comments: false } });
    let out = r.code || "";
    if (/<\/?script/i.test(out)) out = scripts[i].trim(); // seguridad: nunca romper el tag
    scripts[i] = out;
  }
  html = html.replace(/<script>__INLINE_(\d+)__<\/script>/g, (m, i) => "<script>" + scripts[i] + "</script>");
  // 2) quitar comentarios HTML y líneas vacías
  html = html.replace(/[ \t]*<!--(?!\[if)[\s\S]*?-->\n?/g, "");
  html = html.replace(/\n{2,}/g, "\n").replace(/[ \t]+$/gm, "");
  return html;
}

(async () => {
  if (fs.existsSync(DST)) fs.rmSync(DST, { recursive: true, force: true });
  copyDir(SRC, DST);
  console.log("copiado public/ -> protected/");

  // Ofuscar JS propio
  let i = 0;
  for (const rel of OBFUSCATE) {
    const p = path.join(DST, rel);
    const src = fs.readFileSync(p, "utf8");
    const res = JavaScriptObfuscator.obfuscate(src, OBF_OPTS("f" + (i++) + "x"));
    fs.writeFileSync(p, res.getObfuscatedCode());
    console.log("ofuscado ", rel, Math.round(src.length / 1024) + "KB ->", Math.round(res.getObfuscatedCode().length / 1024) + "KB");
  }

  // sw.js: solo minificar (fiabilidad del service worker)
  const swp = path.join(DST, "sw.js");
  const swmin = await minify(fs.readFileSync(swp, "utf8"), { compress: true, mangle: false, format: { comments: false } });
  fs.writeFileSync(swp, swmin.code);

  // _worker.js: lógica de servidor (TEA, offsets, parches) — ofuscada + módulo ES
  const wsrc = fs.readFileSync(SERVER_SRC, "utf8");
  const wopts = OBF_OPTS("fsrvx");
  wopts.selfDefending = false;
  const wres = JavaScriptObfuscator.obfuscate(wsrc, wopts);
  const workerJs = wres.getObfuscatedCode().replace(/\s+$/, "") + "\nexport default VexoraServer;\n";
  fs.writeFileSync(path.join(DST, "_worker.js"), workerJs);
  console.log("worker   server/worker.js -> protected/_worker.js", Math.round(wsrc.length / 1024) + "KB ->", Math.round(workerJs.length / 1024) + "KB");

  // .assetsignore: en el despliegue alternativo por Workers, _worker.js es el
  // entrypoint (main) y NO debe subirse también como asset público.
  fs.writeFileSync(path.join(DST, ".assetsignore"), "_worker.js\n");
  console.log("assets   protected/.assetsignore (_worker.js excluido de assets)");

  // HTML: comentarios fuera + inline minificado
  for (const rel of ["index.html", "cfw/index.html", "forge/index.html", "404.html", "admin.html"]) {
    const p = path.join(DST, rel);
    let h = fs.readFileSync(p, "utf8");
    h = await minifyInlineHtml(h);
    fs.writeFileSync(p, h);
    console.log("html     ", rel);
  }
  console.log("OK · protected/ generado");
})().catch((e) => { console.error("FALLO:", e.message); process.exit(1); });
