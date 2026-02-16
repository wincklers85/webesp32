// ESP32 Virtual Lab — 100% statico, tutto in RAM, GitHub Pages friendly.
// "Arduino-like" sketch -> transpile -> run in JS runtime.
//
// Supporta (subset):
// - setup(), loop()
// - pinMode(pin, INPUT/OUTPUT/INPUT_PULLUP)
// - digitalWrite(pin, HIGH/LOW)
// - digitalRead(pin)
// - delay(ms) (async)
// - millis()
// - Serial.begin(), Serial.print/println()
// - Display: display.begin(), display.clearDisplay(), display.setCursor(x,y), display.print(), display.display()
//   (SSD1306 style, render su canvas 128x64)
//
// Bottoni: GPIO19 (LEFT), GPIO18 (OK), GPIO5 (RIGHT) con pullup; premuto = LOW.

const $ = (q) => document.querySelector(q);

const logEl = $("#log");
const codeEl = $("#code");
const voutEl = $("#vout");
const voutTxt = $("#voutTxt");
const powerBtn = $("#btnPower");
const runtimeState = $("#runtimeState");

const btnLoad = $("#btnLoad");
const btnRun = $("#btnRun");
const btnStop = $("#btnStop");
const btnReset = $("#btnReset");
const btnClearLog = $("#btnClearLog");
const btnInsertTest = $("#btnInsertTest");

const pillCompat = $("#pillCompat");
const pillLoop = $("#pillLoop");
const pillMillis = $("#pillMillis");

const pinsL = $("#pinsL");
const pinsR = $("#pinsR");
const selInfo = $("#selInfo");

const lcd = $("#lcd");
const lcdCtx = lcd.getContext("2d");

let psuV = 3.3;
let powerOn = false;

function log(line){
  const t = new Date().toLocaleTimeString();
  logEl.textContent += `[${t}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}
function setState(s){
  runtimeState.textContent = `STATE: ${s}`;
}
function setCompat(ok, msg){
  pillCompat.textContent = ok ? "Compat: OK" : "Compat: WARN";
  pillCompat.style.borderColor = ok ? "rgba(0,0,0,.08)" : "rgba(243,156,18,.35)";
  pillCompat.style.background = ok ? "var(--soft)" : "rgba(243,156,18,.12)";
  if(msg) log(msg);
}

voutEl.addEventListener("input", ()=>{
  psuV = Number(voutEl.value);
  voutTxt.textContent = psuV.toFixed(1) + "V";
});
powerBtn.addEventListener("click", ()=>{
  powerOn = !powerOn;
  powerBtn.textContent = `Power: ${powerOn ? "ON" : "OFF"}`;
  powerBtn.style.background = powerOn ? "rgba(0,184,148,.12)" : "var(--soft)";
  powerBtn.style.borderColor = powerOn ? "rgba(0,184,148,.25)" : "var(--border)";
  log(powerOn ? "PSU ON." : "PSU OFF.");
  if(!powerOn) {
    // Spegni display (effetto)
    display.clearDisplay();
    display.display();
  }
});

btnClearLog.addEventListener("click", ()=> logEl.textContent = "");

btnInsertTest.addEventListener("click", ()=>{
  codeEl.value = DEFAULT_SKETCH;
  log("Programma test caricato.");
});

btnLoad.addEventListener("click", ()=>{
  compileAndPrepare(codeEl.value);
});

btnRun.addEventListener("click", ()=>{
  if(!prepared) {
    log("Non compilato. Premi 'Carica codice' prima.");
    return;
  }
  startRuntime();
});

btnStop.addEventListener("click", ()=>{
  stopRuntime("Stop richiesto.");
});

btnReset.addEventListener("click", ()=>{
  resetAll();
});

// ----- GPIO simulation -----
const GPIO_LIST_L = [
  "3V3","EN","GPIO36","GPIO39","GPIO34","GPIO35","GPIO32","GPIO33","GPIO25","GPIO26","GPIO27","GPIO14","GPIO12","GND","GPIO13"
];
const GPIO_LIST_R = [
  "VIN","GND","GPIO23","GPIO22","GPIO1","GPIO3","GPIO21","GPIO19","GPIO18","GPIO5","GPIO17","GPIO16","GPIO4","GPIO0","GPIO2","GPIO15"
];

const pinModes = new Map(); // pin -> "INPUT"/"OUTPUT"/"INPUT_PULLUP"
const pinValues = new Map(); // pin -> 0/1
for(const p of [...GPIO_LIST_L, ...GPIO_LIST_R]){
  if(p.startsWith("GPIO")) {
    pinModes.set(p, "INPUT");
    pinValues.set(p, 0);
  }
}

function renderPins(){
  pinsL.innerHTML = GPIO_LIST_L.map(p => pinRow(p)).join("");
  pinsR.innerHTML = GPIO_LIST_R.map(p => pinRow(p)).join("");
}
function pinRow(p){
  const isGpio = p.startsWith("GPIO");
  const v = isGpio ? (pinValues.get(p) ? "high" : "low") : "low";
  return `<div class="pin ${v}" data-pin="${p}">
    <span>${p}</span>
    <span class="dot"></span>
  </div>`;
}
function refreshPin(p){
  const el = document.querySelector(`.pin[data-pin="${p}"]`);
  if(!el) return;
  el.classList.remove("high","low");
  el.classList.add(pinValues.get(p) ? "high" : "low");
}

renderPins();

// ----- Buttons -> GPIO -----
const BTN_LEFT = "GPIO19";
const BTN_OK   = "GPIO18";
const BTN_RIGHT= "GPIO5";

// pullups by default for these buttons in our test wiring
pinModes.set(BTN_LEFT, "INPUT_PULLUP");
pinModes.set(BTN_OK, "INPUT_PULLUP");
pinModes.set(BTN_RIGHT, "INPUT_PULLUP");

function setButton(pin, pressed){
  // INPUT_PULLUP: not pressed = HIGH(1), pressed = LOW(0)
  if(pinModes.get(pin) !== "INPUT_PULLUP") return;
  pinValues.set(pin, pressed ? 0 : 1);
  refreshPin(pin);
}

function bindMomentary(btnEl, pin){
  btnEl.addEventListener("pointerdown", ()=>{ setButton(pin, true); });
  btnEl.addEventListener("pointerup", ()=>{ setButton(pin, false); });
  btnEl.addEventListener("pointerleave", ()=>{ setButton(pin, false); });
  btnEl.addEventListener("touchstart", (e)=>{ e.preventDefault(); setButton(pin, true); }, {passive:false});
  btnEl.addEventListener("touchend", (e)=>{ e.preventDefault(); setButton(pin, false); }, {passive:false});
}
bindMomentary($("#btnLeft"), BTN_LEFT);
bindMomentary($("#btnOk"), BTN_OK);
bindMomentary($("#btnRight"), BTN_RIGHT);

// ----- LCD / SSD1306-like -----
const LCD_W = 128, LCD_H = 64;
const buffer = new Uint8Array(LCD_W * LCD_H); // 0/1 pixels
const textLayer = []; // staged text draws
let cursorX = 0, cursorY = 0;

// tiny 5x7 font (subset ASCII) -> we’ll draw using canvas fillRect per pixel.
// For simplicity: use Canvas built-in monospace and then threshold into pixels (fast enough for 128x64).
// This gives a very realistic “OLED” feel without shipping a font table.
const off = document.createElement("canvas");
off.width = LCD_W; off.height = LCD_H;
const offCtx = off.getContext("2d");

function clearBuf(){
  buffer.fill(0);
  textLayer.length = 0;
}

function renderBufToCanvas(){
  // OLED effect: green-ish pixels, but keep simple: white pixels on black.
  lcdCtx.clearRect(0,0,LCD_W,LCD_H);
  const img = lcdCtx.getImageData(0,0,LCD_W,LCD_H);
  const d = img.data;
  for(let i=0;i<buffer.length;i++){
    const on = buffer[i] ? 255 : 0;
    const idx = i*4;
    d[idx+0] = on;
    d[idx+1] = on;
    d[idx+2] = on;
    d[idx+3] = 255;
  }
  lcdCtx.putImageData(img,0,0);
}

function drawTextToBuf(){
  // rasterize textLayer into buffer
  offCtx.clearRect(0,0,LCD_W,LCD_H);
  offCtx.fillStyle = "#000";
  offCtx.fillRect(0,0,LCD_W,LCD_H);
  offCtx.fillStyle = "#fff";
  offCtx.font = "10px ui-monospace, Menlo, Consolas, monospace";
  offCtx.textBaseline = "top";

  for(const t of textLayer){
    offCtx.fillText(t.text, t.x, t.y);
  }

  const img = offCtx.getImageData(0,0,LCD_W,LCD_H).data;
  for(let y=0;y<LCD_H;y++){
    for(let x=0;x<LCD_W;x++){
      const i = (y*LCD_W + x);
      const p = img[i*4]; // red channel
      buffer[i] = p > 40 ? 1 : 0;
    }
  }
}

const display = {
  begin(){ return true; },
  clearDisplay(){
    clearBuf();
  },
  setCursor(x,y){
    cursorX = x|0; cursorY = y|0;
  },
  print(s){
    textLayer.push({ x: cursorX, y: cursorY, text: String(s) });
    // naive cursor advance
    cursorX += String(s).length * 6;
  },
  println(s){
    textLayer.push({ x: cursorX, y: cursorY, text: String(s) });
    cursorX = 0;
    cursorY += 10;
  },
  display(){
    if(!powerOn){
      // when off: blank
      clearBuf();
      renderBufToCanvas();
      return;
    }
    drawTextToBuf();
    renderBufToCanvas();
  }
};

// power-on default blank
clearBuf();
renderBufToCanvas();

// ----- Arduino-like runtime -----
const Arduino = {
  HIGH: 1,
  LOW: 0,
  INPUT: "INPUT",
  OUTPUT: "OUTPUT",
  INPUT_PULLUP: "INPUT_PULLUP",

  pinMode(pin, mode){
    if(!pinValues.has(pin)) throw new Error(`pinMode(): pin non valido: ${pin}`);
    pinModes.set(pin, mode);
    // pullup default high
    if(mode === "INPUT_PULLUP") { pinValues.set(pin, 1); refreshPin(pin); }
  },
  digitalWrite(pin, val){
    if(pinModes.get(pin) !== "OUTPUT") {
      // Arduino often allows but it's wrong; we error to be strict & useful
      throw new Error(`digitalWrite(): ${pin} non è OUTPUT`);
    }
    pinValues.set(pin, val ? 1 : 0);
    refreshPin(pin);
  },
  digitalRead(pin){
    if(!pinValues.has(pin)) throw new Error(`digitalRead(): pin non valido: ${pin}`);
    // INPUT_PULLUP already handled by pinValues updates
    return pinValues.get(pin) ? 1 : 0;
  },
  delay(ms){
    return new Promise(res => setTimeout(res, Math.max(0, ms|0)));
  },
  millis(){
    return runtimeMillis();
  },
  Serial: {
    begin(_baud){ /* noop */ },
    print(...a){ log(a.join(" ")); },
    println(...a){ log(a.join(" ")); }
  },
  display
};

// ----- Compilation / transpile -----
let prepared = null; // {setupFn, loopFn}
let loopHandle = null;
let t0 = 0;
let loopTicks = 0;

function runtimeMillis(){
  if(!t0) return 0;
  return Math.floor(performance.now() - t0);
}

function setLoopPills(){
  pillLoop.textContent = `Loop: ${loopTicks}`;
  pillMillis.textContent = `millis: ${runtimeMillis()}`;
}

function stopRuntime(reason){
  if(loopHandle){
    clearTimeout(loopHandle);
    loopHandle = null;
  }
  if(reason) log(reason);
  setState("idle");
}

function resetAll(){
  stopRuntime("Reset.");
  // reset pins
  for(const p of pinValues.keys()){
    pinModes.set(p, "INPUT");
    pinValues.set(p, 0);
    refreshPin(p);
  }
  // restore our default button pullups
  pinModes.set(BTN_LEFT,"INPUT_PULLUP"); pinValues.set(BTN_LEFT,1); refreshPin(BTN_LEFT);
  pinModes.set(BTN_OK,"INPUT_PULLUP");   pinValues.set(BTN_OK,1);   refreshPin(BTN_OK);
  pinModes.set(BTN_RIGHT,"INPUT_PULLUP");pinValues.set(BTN_RIGHT,1);refreshPin(BTN_RIGHT);

  // reset display
  display.clearDisplay();
  display.setCursor(0,0);
  display.display();

  prepared = null;
  loopTicks = 0;
  t0 = 0;
  setLoopPills();
  setCompat(true);
}

function compileAndPrepare(src){
  stopRuntime();
  loopTicks = 0;
  setLoopPills();

  const { js, warnings } = transpileArduinoToJS(src);

  // show warnings as "sketch warnings"
  if(warnings.length){
    setCompat(false, "Compatibilità: alcune istruzioni non sono supportate, vedi warning sotto.");
    for(const w of warnings) log(`warning: ${w}`);
  } else {
    setCompat(true);
  }

  // wrap into async module and extract setup/loop
  const wrapped = `
    "use strict";
    return (async function(Arduino){
      const {
        HIGH, LOW, INPUT, OUTPUT, INPUT_PULLUP,
        pinMode, digitalWrite, digitalRead, delay, millis,
        Serial, display
      } = Arduino;

      ${js}

      if (typeof setup !== "function") throw new Error("setup() mancante");
      if (typeof loop !== "function") throw new Error("loop() mancante");

      return { setup, loop };
    });
  `;

  let factory;
  try{
    factory = new Function(wrapped)();
  }catch(e){
    // Syntax error in JS output -> map to approximate Arduino line
    reportCompileError(e, src);
    prepared = null;
    return;
  }

  prepared = { factory, src };
  log("Compilazione OK (Arduino-like). Premi RUN.");
  setState("ready");
}

function reportCompileError(err, originalSrc){
  // try to extract line number from err.stack
  const msg = String(err && err.message ? err.message : err);
  const stack = String(err && err.stack ? err.stack : "");
  let line = null;

  // Chrome typical: "<anonymous>:LINE:COLUMN"
  const m = stack.match(/<anonymous>:(\d+):(\d+)/);
  if(m) line = Number(m[1]);

  // our wrapper adds some header lines; approximate mapping:
  // We can’t perfectly map without sourcemaps; give useful "near line" by searching error token.
  log(`errore: ${msg}`);
  if(line){
    log(`nota: errore durante parsing. (linea interna JS: ${line})`);
  }
  log("Suggerimento: usa solo subset supportato: setup/loop, pinMode/digitalRead/digitalWrite/delay, Serial, display.");
}

async function startRuntime(){
  if(!prepared) return;
  if(!powerOn){
    log("PSU OFF: accendi Power per vedere LCD.");
  }
  setState("running");
  t0 = performance.now();
  loopTicks = 0;
  setLoopPills();

  let sketch;
  try{
    sketch = await prepared.factory(Arduino);
  }catch(e){
    log(`errore: ${e.message || e}`);
    setState("idle");
    return;
  }

  try{
    await sketch.setup();
  }catch(e){
    log(`errore in setup(): ${e.message || e}`);
    setState("idle");
    return;
  }

  // cooperative loop runner
  const tick = async () => {
    if(!prepared || !loopHandle) return;
    try{
      loopTicks++;
      setLoopPills();
      await sketch.loop();
      // update display each tick (like buffered SSD1306)
      display.display();
      // schedule next
      loopHandle = setTimeout(tick, 16);
    }catch(e){
      log(`errore in loop(): ${e.message || e}`);
      stopRuntime("Runtime fermato per errore.");
    }
  };

  loopHandle = setTimeout(tick, 16);
}

function transpileArduinoToJS(src){
  const warnings = [];
  let s = src;

  // normalize line endings
  s = s.replace(/\r\n/g, "\n");

  // remove includes
  s = s.replace(/^\s*#include[^\n]*\n/gm, (m)=>{ warnings.push(`ignoro ${m.trim()}`); return ""; });

  // remove Arduino types (very rough)
  // convert: const int x = 5; -> let x = 5;
  s = s.replace(/\b(const\s+)?(unsigned\s+)?(long|int|float|double|bool|byte|char|String|uint8_t|uint16_t|uint32_t|size_t)\b/g, (m)=>{
    // keep "String" -> treat as JS string; remove type
    return "";
  });

  // fix function signatures: void setup() { -> function setup() {
  s = s.replace(/\bvoid\s+setup\s*\(\s*\)\s*\{/g, "function setup(){");
  s = s.replace(/\bvoid\s+loop\s*\(\s*\)\s*\{/g, "async function loop(){");

  // replace booleans
  s = s.replace(/\btrue\b/g, "true").replace(/\bfalse\b/g, "false");

  // replace constants
  s = s.replace(/\bHIGH\b/g, "HIGH");
  s = s.replace(/\bLOW\b/g, "LOW");
  s = s.replace(/\bINPUT_PULLUP\b/g, "INPUT_PULLUP");
  s = s.replace(/\bINPUT\b/g, "INPUT");
  s = s.replace(/\bOUTPUT\b/g, "OUTPUT");

  // replace common libs usage into our display object:
  // Adafruit_SSD1306 display;  -> let display; (we already provide display)
  s = s.replace(/\bAdafruit_SSD1306\b/g, "");
  s = s.replace(/\bAdafruit_GFX\b/g, "");

  // Common calls:
  // display.begin(...) -> display.begin(...)
  // display.clearDisplay() -> ok
  // display.setCursor(x,y) -> ok
  // display.print(x) -> ok
  // display.display() -> ok

  // digitalWrite(23, HIGH) -> digitalWrite("GPIO23", HIGH) if numeric pin
  s = s.replace(/\b(pinMode|digitalWrite|digitalRead)\s*\(\s*(\d+)\s*,/g, (m, fn, n)=>{
    return `${fn}("GPIO${n}",`;
  });
  s = s.replace(/\b(digitalRead)\s*\(\s*(\d+)\s*\)/g, (m, fn, n)=>{
    return `${fn}("GPIO${n}")`;
  });

  // pinMode( "GPIO23", OUTPUT ) already ok.

  // delay(ms); must be awaited inside async loop. If user wrote delay(200); we auto-inject await when inside loop heuristic:
  // simple: replace "delay(" with "await delay(" (safe even in setup; setup can be sync, but awaiting in non-async would break)
  // So: we only do it inside loop() body — easiest: after we made loop async, replace within loop block using regex
  s = patchDelayAwaitInLoop(s);

  // millis() -> millis()
  // Serial.println -> Serial.println
  // Replace Serial.print/println with Serial.println (keep)
  // no change

  // Strip trailing semicolons are fine in JS; keep them.

  // Quick unsupported feature detection
  if(/\bfor\s*\(|\bwhile\s*\(|\bswitch\s*\(/.test(s)){
    // allowed, but might work; don't warn.
  }
  if(/\bWiFi\b|\bBluetooth\b|\bBLE\b/.test(src)){
    warnings.push("WiFi/BT non emulati in questa versione (solo GPIO/LCD/Tasti/Serial).");
  }
  if(/\battachInterrupt\b/.test(src)){
    warnings.push("Interrupt non emulati: usa polling in loop().");
  }
  if(/\bdelayMicroseconds\b/.test(src)){
    warnings.push("delayMicroseconds non emulato: usa delay(ms).");
  }

  return { js: s, warnings };
}

function patchDelayAwaitInLoop(s){
  // naive block extraction for loop(): find "async function loop(){" then match braces
  const idx = s.indexOf("async function loop(){");
  if(idx < 0) return s;
  const start = s.indexOf("{", idx);
  if(start < 0) return s;

  let i = start;
  let depth = 0;
  for(; i < s.length; i++){
    if(s[i] === "{") depth++;
    else if(s[i] === "}") { depth--; if(depth === 0) break; }
  }
  if(i >= s.length) return s;

  const head = s.slice(0, start+1);
  const body = s.slice(start+1, i);
  const tail = s.slice(i);

  // inside body: replace "delay(" with "await delay("
  // but avoid double await
  const body2 = body.replace(/(^|[^\w])delay\s*\(/g, (m, p1)=>{
    // if preceded by "await " already, it won't match like this; good
    return `${p1}await delay(`;
  });

  return head + body2 + tail;
}

// ----- Default test sketch -----
const DEFAULT_SKETCH = `#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// Wiring fisso nel Virtual Lab:
// SDA=21, SCL=22, LEFT=19, OK=18, RIGHT=5 (pullup)

void setup() {
  Serial.begin(115200);

  pinMode(19, INPUT_PULLUP);
  pinMode(18, INPUT_PULLUP);
  pinMode(5,  INPUT_PULLUP);

  display.begin();
  display.clearDisplay();
  display.setCursor(0,0);
  display.print("ESP32 Virtual Lab");
  display.setCursor(0,10);
  display.print("Premi i tasti...");
  display.display();
}

void loop() {
  int l = digitalRead(19);
  int o = digitalRead(18);
  int r = digitalRead(5);

  display.clearDisplay();
  display.setCursor(0,0);
  display.print("LCD 128x64 mono");
  display.setCursor(0,12);
  display.print("LEFT: "); display.print(l==LOW ? "DOWN":"UP");
  display.setCursor(0,22);
  display.print("OK:   "); display.print(o==LOW ? "DOWN":"UP");
  display.setCursor(0,32);
  display.print("RIGHT:"); display.print(r==LOW ? "DOWN":"UP");

  display.setCursor(0,48);
  display.print("millis=");
  display.print(millis());

  display.display();
  delay(80);
}
`;

// init
codeEl.value = DEFAULT_SKETCH;
log("Pronto. Premi 'Carica codice' poi 'Run'.");
setState("idle");
setCompat(true);

// show default pullup highs
pinValues.set(BTN_LEFT,1); refreshPin(BTN_LEFT);
pinValues.set(BTN_OK,1); refreshPin(BTN_OK);
pinValues.set(BTN_RIGHT,1); refreshPin(BTN_RIGHT);
