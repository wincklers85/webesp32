// ESP32 Sandbox Lab (MVP)
// Nota: questo esegue "sketch" in JS con API Arduino-like.
// Per C++ reale serve compilation layer / backend.

const $ = (q) => document.querySelector(q);
const elBoard = $("#board");
const elPinsL = elBoard.querySelector(".pins.left");
const elPinsR = elBoard.querySelector(".pins.right");
const elSelPin = $("#selPin");
const elWires = $("#wiresList");
const elGrid = $("#deviceGrid");
const elLog = $("#log");

const elPsuV = $("#psuV");
const elPsuVtxt = $("#psuVtxt");
const elPowerBtn = $("#powerBtn");
const elWifiState = $("#wifiState");

const runBtn = $("#runBtn");
const stopBtn = $("#stopBtn");
const resetBtn = $("#resetBtn");
const clearWiresBtn = $("#clearWiresBtn");
const clearLogBtn = $("#clearLogBtn");
const btBtn = $("#btBtn");

let powerOn = false;
let psuV = 3.3;

function log(...args){
  elLog.textContent += args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ") + "\n";
  elLog.scrollTop = elLog.scrollHeight;
}
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

const GPIO = [
  // left
  { n:"3V3", type:"PWR" }, { n:"GND", type:"GND" },
  { n:"GPIO36", type:"ADC" }, { n:"GPIO39", type:"ADC" },
  { n:"GPIO34", type:"ADC" }, { n:"GPIO35", type:"ADC" },
  { n:"GPIO32", type:"IO" }, { n:"GPIO33", type:"IO" },
  { n:"GPIO25", type:"IO" }, { n:"GPIO26", type:"IO" },
  { n:"GPIO27", type:"IO" }, { n:"GPIO14", type:"IO" },
  { n:"GPIO12", type:"IO" }, { n:"GPIO13", type:"IO" },
  // right
  { n:"VIN", type:"PWR" }, { n:"GND2", type:"GND" },
  { n:"GPIO23", type:"IO" }, { n:"GPIO22", type:"IO" }, // I2C SCL default
  { n:"GPIO21", type:"IO" }, // I2C SDA default
  { n:"GPIO19", type:"IO" }, { n:"GPIO18", type:"IO" },
  { n:"GPIO5", type:"IO" }, { n:"GPIO17", type:"IO" },
  { n:"GPIO16", type:"IO" }, { n:"GPIO4", type:"IO" },
  { n:"GPIO2", type:"IO" }, { n:"GPIO15", type:"IO" }
];

// runtime pin states
const pinState = new Map();      // "GPIO23" -> 0/1/analog(0-4095)
const pinMode = new Map();       // "GPIO23" -> "INPUT"/"OUTPUT"/"INPUT_PULLUP"
for (const p of GPIO) { pinState.set(p.n, 0); pinMode.set(p.n, "INPUT"); }

let selectedPin = null;
let selectedTerminal = null;

// Wires: { from:{pin}, to:{deviceId, termName} }
const wires = [];
let deviceSeq = 1;
const devices = new Map(); // id -> device object

function refreshWires(){
  elWires.textContent = wires.length
    ? wires.map((w,i)=>`${String(i+1).padStart(2,"0")}) ${w.from.pin} ↔ ${w.to.deviceId}.${w.to.term}`).join("\n")
    : "— nessuna connessione —";
}

function setPinClass(pinName){
  const el = elBoard.querySelector(`[data-pin="${pinName}"]`);
  if(!el) return;
  el.classList.remove("high","low");
  const v = pinState.get(pinName) || 0;
  if (v === 1) el.classList.add("high");
  else el.classList.add("low");
}

function renderPins(){
  elPinsL.innerHTML = "";
  elPinsR.innerHTML = "";

  const left = GPIO.slice(0,14);
  const right = GPIO.slice(14);

  for(const p of left) elPinsL.appendChild(makePinEl(p));
  for(const p of right) elPinsR.appendChild(makePinEl(p));
  GPIO.forEach(p => setPinClass(p.n));
}

function makePinEl(p){
  const el = document.createElement("div");
  el.className = "pin low";
  el.dataset.pin = p.n;
  el.innerHTML = `
    <div>
      <div class="name">${p.n}</div>
      <div class="meta">${p.type}</div>
    </div>
    <div class="dot"></div>
  `;
  el.addEventListener("click", ()=>{
    // select pin for wiring
    elBoard.querySelectorAll(".pin.sel").forEach(x=>x.classList.remove("sel"));
    el.classList.add("sel");
    selectedPin = p.n;
    elSelPin.textContent = `Pin selezionato: ${p.n}`;
    tryCompleteWire();
  });
  return el;
}

// --- Devices
function addDevice(kind){
  const id = `D${deviceSeq++}`;
  const d = createDeviceModel(id, kind);
  devices.set(id, d);
  elGrid.appendChild(renderDevice(d));
  refreshWires();
}

function createDeviceModel(id, kind){
  const base = { id, kind, state:{}, terms:[] };
  if(kind==="led"){
    base.title = "LED";
    base.terms = ["ANODE","CATHODE"];
    base.state.on = false;
  }else if(kind==="button"){
    base.title = "Pulsante";
    base.terms = ["SIG","GND"];
    base.state.pressed = false;
  }else if(kind==="temp"){
    base.title = "Sensore Temp (ADC)";
    base.terms = ["OUT","GND","VCC"];
    base.state.c = 24;
  }else if(kind==="hum"){
    base.title = "Sensore Umidità (ADC)";
    base.terms = ["OUT","GND","VCC"];
    base.state.rh = 55;
  }else if(kind==="motion"){
    base.title = "PIR (Digital)";
    base.terms = ["OUT","GND","VCC"];
    base.state.motion = false;
  }else if(kind==="oled"){
    base.title = "OLED SSD1306 (I2C)";
    base.terms = ["SDA","SCL","GND","VCC"];
    base.state.lines = ["SSD1306 READY", "—", "—"];
  }else if(kind==="relay"){
    base.title = "Relè (Digital)";
    base.terms = ["IN","GND","VCC"];
    base.state.on = false;
  }
  return base;
}

function renderDevice(d){
  const el = document.createElement("div");
  el.className = "device";
  el.dataset.device = d.id;

  const terms = d.terms.map(t => `<div class="term" data-term="${t}">${t}<span class="mini"></span></div>`).join("");

  el.innerHTML = `
    <div class="head">
      <div class="title">${d.id} • ${d.title}</div>
      <div class="x" title="Rimuovi">✕</div>
    </div>
    <div class="body">
      <div class="terminals">${terms}</div>
      <div class="controls"></div>
    </div>
  `;

  el.querySelector(".x").addEventListener("click", ()=>{
    // remove device + wires
    for(let i=wires.length-1;i>=0;i--){
      if(wires[i].to.deviceId === d.id) wires.splice(i,1);
    }
    devices.delete(d.id);
    el.remove();
    refreshWires();
  });

  // terminals wiring click
  el.querySelectorAll(".term").forEach(tel=>{
    tel.addEventListener("click", ()=>{
      elGrid.querySelectorAll(".term.sel").forEach(x=>x.classList.remove("sel"));
      tel.classList.add("sel");
      selectedTerminal = { deviceId: d.id, term: tel.dataset.term };
      tryCompleteWire();
    });
  });

  // controls by kind
  const ctl = el.querySelector(".controls");
  ctl.appendChild(renderControls(d, el));

  updateDeviceUI(d, el);
  return el;
}

function renderControls(d, el){
  const wrap = document.createElement("div");
  wrap.style.display = "grid";
  wrap.style.gap = "8px";

  if(d.kind==="button"){
    const btn = document.createElement("button");
    btn.className = "btn small";
    btn.textContent = "Hold / Release";
    btn.addEventListener("click", ()=>{
      d.state.pressed = !d.state.pressed;
      updateDeviceUI(d, el);
    });
    wrap.appendChild(btn);
  }

  if(d.kind==="motion"){
    const btn = document.createElement("button");
    btn.className = "btn small";
    btn.textContent = "Toggle Motion";
    btn.addEventListener("click", ()=>{
      d.state.motion = !d.state.motion;
      updateDeviceUI(d, el);
    });
    wrap.appendChild(btn);
  }

  if(d.kind==="temp"){
    wrap.appendChild(sliderRow("°C", d.state.c,  -10, 80, 0.5, (v)=>{
      d.state.c = v;
      updateDeviceUI(d, el);
    }));
  }

  if(d.kind==="hum"){
    wrap.appendChild(sliderRow("%RH", d.state.rh, 0, 100, 1, (v)=>{
      d.state.rh = v;
      updateDeviceUI(d, el);
    }));
  }

  if(d.kind==="oled"){
    const box = document.createElement("div");
    box.className = "oled";
    box.innerHTML = d.state.lines.map(s=>`<div class="line"></div>`).join("");
    wrap.appendChild(box);
  }

  if(d.kind==="led"){
    const row = document.createElement("div");
    row.className = "kv";
    row.innerHTML = `<label>Stato</label><div class="ledlamp" data-ledlamp="1"></div>`;
    wrap.appendChild(row);
  }

  if(d.kind==="relay"){
    const row = document.createElement("div");
    row.className = "kv";
    row.innerHTML = `<label>Stato</label><span class="mono" data-rel="1">OFF</span>`;
    wrap.appendChild(row);
  }

  return wrap;
}

function sliderRow(label, value, min, max, step, onChange){
  const row = document.createElement("div");
  row.className = "kv";
  row.innerHTML = `
    <label>${label}</label>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${value}">
    <span class="mono">${value}</span>
  `;
  const input = row.querySelector("input");
  const txt = row.querySelector("span");
  input.addEventListener("input", ()=>{
    const v = Number(input.value);
    txt.textContent = String(v);
    onChange(v);
  });
  return row;
}

function updateDeviceUI(d, el){
  // show terminal mapped pin
  el.querySelectorAll(".term").forEach(t=>{
    const label = t.querySelector(".mini");
    const w = wires.find(w => w.to.deviceId===d.id && w.to.term===t.dataset.term);
    label.textContent = w ? `• ${w.from.pin}` : "";
  });

  if(d.kind==="led"){
    const lamp = el.querySelector(".ledlamp");
    lamp.classList.toggle("on", !!d.state.on);
  }
  if(d.kind==="relay"){
    const sp = el.querySelector('[data-rel="1"]');
    sp.textContent = d.state.on ? "ON" : "OFF";
    sp.style.color = d.state.on ? "var(--ok)" : "var(--muted)";
  }
  if(d.kind==="oled"){
    const box = el.querySelector(".oled");
    const lines = box.querySelectorAll(".line");
    d.state.lines.forEach((s,i)=>{ if(lines[i]) lines[i].textContent = s; });
  }
}

function tryCompleteWire(){
  if(!selectedPin || !selectedTerminal) return;

  // replace if already wired
  const existing = wires.find(w => w.to.deviceId===selectedTerminal.deviceId && w.to.term===selectedTerminal.term);
  if(existing) existing.from.pin = selectedPin;
  else wires.push({ from:{pin:selectedPin}, to:{...selectedTerminal} });

  // clear selections
  selectedTerminal = null;
  selectedPin = null;
  elSelPin.textContent = "Pin selezionato: —";
  elBoard.querySelectorAll(".pin.sel").forEach(x=>x.classList.remove("sel"));
  elGrid.querySelectorAll(".term.sel").forEach(x=>x.classList.remove("sel"));

  refreshWires();
  // update all devices pin badges
  for(const [id,d] of devices){
    const el = elGrid.querySelector(`[data-device="${id}"]`);
    if(el) updateDeviceUI(d, el);
  }
}

// --- Power / PSU
function setPower(on){
  powerOn = on;
  elPowerBtn.textContent = `Power: ${on ? "ON" : "OFF"}`;
  elPowerBtn.style.borderColor = on ? "rgba(70,230,166,.6)" : "var(--line)";
  elPowerBtn.style.background = on ? "rgba(70,230,166,.12)" : "rgba(255,255,255,.04)";
}
elPsuV.addEventListener("input", ()=>{
  psuV = Number(elPsuV.value);
  elPsuVtxt.textContent = psuV.toFixed(1) + "V";
});
elPowerBtn.addEventListener("click", ()=> setPower(!powerOn));

// --- Wi-Fi mock
const wifi = {
  networks: [
    { ssid:"MoliniMesh", rssi:-48, enc:"WPA2" },
    { ssid:"ProLoco-Event", rssi:-62, enc:"WPA2" },
    { ssid:"OmenLab", rssi:-71, enc:"Open" }
  ],
  connected: null
};
function wifiStatus(txt){ elWifiState.textContent = "Wi-Fi: " + txt; }

// --- Sketch runtime (Arduino-like JS)
let loopTimer = null;
let running = false;

const Arduino = {
  INPUT:"INPUT",
  OUTPUT:"OUTPUT",
  INPUT_PULLUP:"INPUT_PULLUP",
  HIGH:1,
  LOW:0,

  pinMode(pin, mode){
    pinMode.set(pin, mode);
  },
  digitalWrite(pin, val){
    pinState.set(pin, val ? 1 : 0);
    setPinClass(pin);
    propagateFromPin(pin);
  },
  digitalRead(pin){
    // if a device drives this pin, return that
    const v = resolveDigitalInput(pin);
    return v;
  },
  analogRead(pin){
    const v = resolveAnalogInput(pin);
    return v;
  },
  delay(ms){
    return new Promise(res=>setTimeout(res, ms));
  },
  Serial:{
    begin(){},
    print: (...a)=>log(...a),
    println: (...a)=>log(...a),
  },
  WiFi:{
    scanNetworks(){
      wifiStatus("scan…");
      return wifi.networks;
    },
    begin(ssid, pass){
      wifiStatus(`connecting to ${ssid}…`);
      // fake connect
      wifi.connected = ssid;
      setTimeout(()=>wifiStatus(`connected: ${ssid}`), 600);
      return true;
    },
    status(){
      return wifi.connected ? "WL_CONNECTED" : "WL_DISCONNECTED";
    }
  },
  SSD1306:{
    // simple fake display: writeLine(i,text)
    writeLine(lineIndex, text){
      for(const d of devices.values()){
        if(d.kind==="oled"){
          d.state.lines[lineIndex] = String(text).slice(0,22);
          const el = elGrid.querySelector(`[data-device="${d.id}"]`);
          if(el) updateDeviceUI(d, el);
        }
      }
    }
  }
};

function resolveDigitalInput(pin){
  // If a device output is wired to this pin, read it.
  // button: SIG -> 0 when pressed if wired to GND, else 1 if pullup (simple)
  for(const w of wires){
    if(w.from.pin !== pin) continue;
    const d = devices.get(w.to.deviceId);
    if(!d) continue;

    if(d.kind==="button" && w.to.term==="SIG"){
      // pressed -> LOW, else HIGH if pullup else LOW
      const mode = pinMode.get(pin);
      if(d.state.pressed) return 0;
      if(mode === "INPUT_PULLUP") return 1;
      return 0;
    }
    if(d.kind==="motion" && w.to.term==="OUT"){
      return d.state.motion ? 1 : 0;
    }
  }
  // default
  return pinState.get(pin) ? 1 : 0;
}

function resolveAnalogInput(pin){
  // map sensors to 0..4095
  for(const w of wires){
    if(w.from.pin !== pin) continue;
    const d = devices.get(w.to.deviceId);
    if(!d) continue;

    if(d.kind==="temp" && w.to.term==="OUT"){
      // -10..80 => 0..4095
      const v = (d.state.c + 10) / 90;
      return Math.round(clamp(v,0,1)*4095);
    }
    if(d.kind==="hum" && w.to.term==="OUT"){
      const v = d.state.rh / 100;
      return Math.round(clamp(v,0,1)*4095);
    }
  }
  return 0;
}

function propagateFromPin(pin){
  // if a pin drives an LED anode / relay IN etc.
  for(const w of wires){
    if(w.from.pin !== pin) continue;
    const d = devices.get(w.to.deviceId);
    if(!d) continue;

    const v = pinState.get(pin) ? 1 : 0;

    if(d.kind==="led" && w.to.term==="ANODE"){
      // simple power logic: must have PSU ON and CATHODE wired to GND
      const cath = wires.find(x=>x.to.deviceId===d.id && x.to.term==="CATHODE");
      const cathOK = cath && (cath.from.pin === "GND" || cath.from.pin === "GND2");
      d.state.on = !!(powerOn && v===1 && cathOK);
      updateDeviceUI(d, elGrid.querySelector(`[data-device="${d.id}"]`));
    }

    if(d.kind==="relay" && w.to.term==="IN"){
      const gnd = wires.find(x=>x.to.deviceId===d.id && x.to.term==="GND");
      const vcc = wires.find(x=>x.to.deviceId===d.id && x.to.term==="VCC");
      const pwrOK = powerOn && gnd && (gnd.from.pin==="GND"||gnd.from.pin==="GND2") && vcc && (vcc.from.pin==="3V3"||vcc.from.pin==="VIN");
      d.state.on = !!(pwrOK && v===1);
      updateDeviceUI(d, elGrid.querySelector(`[data-device="${d.id}"]`));
    }
  }
}

function resetRuntime(){
  stopRuntime();
  for(const p of GPIO){ pinState.set(p.n, 0); pinMode.set(p.n, "INPUT"); }
  GPIO.forEach(p => setPinClass(p.n));
  wifi.connected = null;
  wifiStatus("idle");
  log("RESET.");
}

async function startRuntime(){
  if(running) return;
  running = true;
  log("RUN.");

  // build user sketch as function
  const userCode = $("#code").value;

  const wrapped = `
    "use strict";
    return (async function(Arduino){
      const { pinMode, digitalWrite, digitalRead, analogRead, delay, Serial, WiFi, SSD1306, INPUT, OUTPUT, INPUT_PULLUP, HIGH, LOW } = Arduino;

      ${userCode}

      if (typeof setup === "function") await setup();

      async function __loopTick(){
        if (typeof loop === "function") await loop();
      }
      return { __loopTick };
    });
  `;

  let factory;
  try{
    factory = new Function(wrapped)();
  }catch(e){
    log("Errore compile JS:", String(e));
    running = false;
    return;
  }

  let sketch;
  try{
    sketch = await factory(Arduino);
  }catch(e){
    log("Errore in setup():", String(e));
    running = false;
    return;
  }

  // loop ~60ms tick (user can delay)
  loopTimer = setInterval(async ()=>{
    if(!running) return;
    try{
      await sketch.__loopTick();
      // refresh pin visuals
      GPIO.forEach(p => setPinClass(p.n));
    }catch(e){
      log("Errore in loop():", String(e));
      stopRuntime();
    }
  }, 60);
}

function stopRuntime(){
  running = false;
  if(loopTimer){ clearInterval(loopTimer); loopTimer = null; }
  log("STOP.");
}

// --- Web Bluetooth (best-effort)
async function connectBT(){
  if(!navigator.bluetooth){
    log("Web Bluetooth non disponibile in questo browser/dispositivo.");
    return;
  }
  try{
    log("BT: richiesta dispositivo…");
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices:true,
      optionalServices:[0x180F] // Battery Service (esempio)
    });
    log("BT: scelto:", device.name || "(senza nome)");
    // Qui puoi espandere: connect GATT, leggere servizi, ecc.
  }catch(e){
    log("BT error:", String(e));
  }
}

// --- UI wiring
document.querySelectorAll("[data-add]").forEach(b=>{
  b.addEventListener("click", ()=> addDevice(b.dataset.add));
});

clearWiresBtn.addEventListener("click", ()=>{
  wires.length = 0;
  refreshWires();
  for(const [id,d] of devices){
    const el = elGrid.querySelector(`[data-device="${id}"]`);
    if(el) updateDeviceUI(d, el);
  }
});

clearLogBtn.addEventListener("click", ()=> elLog.textContent="");

runBtn.addEventListener("click", startRuntime);
stopBtn.addEventListener("click", stopRuntime);
resetBtn.addEventListener("click", resetRuntime);
btBtn.addEventListener("click", connectBT);

// --- init
renderPins();
setPower(false);
refreshWires();

$("#code").value = `// Esempio: LED su GPIO23, pulsante su GPIO19 (INPUT_PULLUP), OLED finto
function setup(){
  Serial.begin(115200);

  pinMode("GPIO23", OUTPUT);
  pinMode("GPIO19", INPUT_PULLUP);

  // Wi-Fi scan + connect (fake)
  const nets = WiFi.scanNetworks();
  Serial.println("Reti:", nets.map(n=>n.ssid).join(", "));
  WiFi.begin("MoliniMesh", "password");

  SSD1306.writeLine(0, "ESP32 Sandbox");
  SSD1306.writeLine(1, "WiFi: connecting");
}

async function loop(){
  const pressed = digitalRead("GPIO19") === LOW; // pullup
  digitalWrite("GPIO23", pressed ? HIGH : LOW);

  SSD1306.writeLine(2, pressed ? "BTN: PRESSED" : "BTN: idle");
  await delay(120);
}
`;
log("Pronto. Aggiungi un LED e collegalo: ANODE -> GPIO23, CATHODE -> GND. Aggiungi un Pulsante: SIG -> GPIO19, GND -> GND.");
