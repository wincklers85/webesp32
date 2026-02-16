const logEl = document.getElementById("log");
const vout = document.getElementById("vout");
const voutTxt = document.getElementById("voutTxt");
const psuTxt = document.getElementById("psu");

const btnPower = document.getElementById("btnPower");
const btnReset = document.getElementById("btnReset");
const btnOpenCode = document.getElementById("btnOpenCode");
const btnBt = document.getElementById("btnBt");

const frame = document.getElementById("simFrame");

let powerOn = false;

function log(msg){
  const t = new Date().toLocaleTimeString();
  logEl.textContent += `[${t}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function buildPins(){
  const left = [
    "3V3","EN","GPIO36","GPIO39","GPIO34","GPIO35","GPIO32","GPIO33","GPIO25","GPIO26","GPIO27","GPIO14","GPIO12","GND","GPIO13"
  ];
  const right = [
    "VIN","GND","GPIO23","GPIO22(SCL)","GPIO1(TX)","GPIO3(RX)","GPIO21(SDA)","GPIO19(◀)","GPIO18(OK)","GPIO5(▶)","GPIO17","GPIO16","GPIO4","GPIO0","GPIO2","GPIO15"
  ];

  const pinsL = document.getElementById("pinsL");
  const pinsR = document.getElementById("pinsR");

  pinsL.innerHTML = left.map(p => `<div class="pin"><span>${p}</span><span class="dot"></span></div>`).join("");
  pinsR.innerHTML = right.map(p => `<div class="pin ${p.includes("GPIO22")||p.includes("GPIO21")||p.includes("GPIO19")||p.includes("GPIO18")||p.includes("GPIO5") ? "active":""}"><span>${p}</span><span class="dot"></span></div>`).join("");
}

buildPins();

function setPower(on){
  powerOn = on;
  btnPower.textContent = `Power: ${on ? "ON" : "OFF"}`;
  log(on ? "Alimentazione ON (UI)" : "Alimentazione OFF (UI)");
  // Non possiamo “spegnere” davvero Wokwi da qui (iframe isolato),
  // ma possiamo fare un reset ricaricando l’iframe.
  if(!on){
    // effetto “power off”: ricarico simulazione (opzionale)
    // frame.src = frame.src;
  }
}

btnPower.addEventListener("click", () => setPower(!powerOn));

btnReset.addEventListener("click", () => {
  log("Reset richiesto: ricarico simulazione");
  frame.src = frame.src; // reset “brutale” ma efficace su GitHub Pages
});

btnOpenCode.addEventListener("click", () => {
  // Su Wokwi embedded hai già editor+compile; questo apre il progetto completo in nuova scheda
  const full = frame.src.replace("/embed", "");
  window.open(full, "_blank", "noopener,noreferrer");
  log("Apro editor Wokwi in nuova scheda (compile + errori stile IDE).");
});

// Web Bluetooth: GitHub Pages è HTTPS quindi è possibile.
// Ma NON è “Bluetooth dell’ESP32 simulato”: è BT vero del browser.
// Qui ti metto solo il gancio.
btnBt.addEventListener("click", async () => {
  try{
    if(!navigator.bluetooth) {
      log("Web Bluetooth non supportato su questo browser/dispositivo.");
      return;
    }
    log("Richiesta dispositivo Bluetooth...");
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true
    });
    log(`Connesso (selezionato): ${device.name || "Senza nome"}`);
  }catch(e){
    log(`BT annullato/errore: ${e.message}`);
  }
});

vout.addEventListener("input", () => {
  voutTxt.textContent = `${vout.value}V`;
  psuTxt.textContent = `PSU: ${vout.value}V`;
});
