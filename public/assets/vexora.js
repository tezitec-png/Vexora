window.VEXORA = {
  name: "Vexora CFW",
  vcu: "1.1.9",
  mcu: "1.1.9",
  app: "2.9.0",
  vcuNibble: 281,
  identOff: 1052,
  identFlash: 134222876,
  verPtrOff: [ 33200, 35360 ],
  isVcu: function(ver) {
    return /^1\.(0|1)\.\d+$/.test(String(ver || ""));
  },
  isMcu: function(ver) {
    return /^1\.(0|1)\.\d+$/.test(String(ver || ""));
  },
  detectModel: function(sn) {
    sn = String(sn || "").toUpperCase();
    if (sn.indexOf("1K1") === 0) return "zt3";
    if (sn.indexOf("1CG") === 0) return "g3";
    return "";
  }
};