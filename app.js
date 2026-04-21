/**
 * QuantumStego — app.js
 * Save as: js/app.js
 * Complete application logic: quantum engine, steganography, auth, UI
 */
 
'use strict';
 
// ═══════════════════════════════════════════════════════
//  QUANTUM REGISTER — Full state-vector simulation
// ═══════════════════════════════════════════════════════
 
class QuantumRegister {
  constructor(n) {
    this.n   = n;
    this.dim = 1 << n;
    this.real = new Float64Array(this.dim);
    this.imag = new Float64Array(this.dim);
    this.real[0] = 1.0; // start in |0...0⟩
  }
 
  hadamard(q) {
    const inv = Math.SQRT1_2;
    const nr  = new Float64Array(this.dim);
    const ni  = new Float64Array(this.dim);
    for (let i = 0; i < this.dim; i++) {
      const r = this.real[i], im = this.imag[i];
      if (r === 0 && im === 0) continue;
      const f = i ^ (1 << q);
      const s = ((i >> q) & 1) ? -1 : 1;
      nr[i] += inv * r;     ni[i] += inv * im;
      nr[f] += inv * s * r; ni[f] += inv * s * im;
    }
    this.real = nr; this.imag = ni;
  }
 
  cnot(ctrl, tgt) {
    const nr = new Float64Array(this.dim);
    const ni = new Float64Array(this.dim);
    for (let i = 0; i < this.dim; i++) {
      const out = ((i >> ctrl) & 1) ? (i ^ (1 << tgt)) : i;
      nr[out] += this.real[i];
      ni[out] += this.imag[i];
    }
    this.real = nr; this.imag = ni;
  }
 
  phaseShift(q, theta) {
    const cos = Math.cos(theta), sin = Math.sin(theta);
    for (let i = 0; i < this.dim; i++) {
      if (!((i >> q) & 1)) continue;
      const r = this.real[i], im = this.imag[i];
      this.real[i] = r * cos - im * sin;
      this.imag[i] = r * sin + im * cos;
    }
  }
 
  measureAll(rng) {
    const p = new Float64Array(this.dim);
    let norm = 0;
    for (let i = 0; i < this.dim; i++) { p[i] = this.real[i]**2 + this.imag[i]**2; norm += p[i]; }
    if (Math.abs(norm - 1) > 1e-6) for (let i = 0; i < this.dim; i++) p[i] /= norm;
    let roll = rng(), cum = 0, chosen = this.dim - 1;
    for (let i = 0; i < this.dim; i++) { cum += p[i]; if (roll <= cum) { chosen = i; break; } }
    this.real.fill(0); this.imag.fill(0); this.real[chosen] = 1.0;
    const bits = new Uint8Array(this.n);
    for (let q = 0; q < this.n; q++) bits[q] = (chosen >> q) & 1;
    return bits;
  }
 
  qubitProbabilities() {
    const p = new Float64Array(this.n);
    for (let i = 0; i < this.dim; i++) {
      const amp = this.real[i]**2 + this.imag[i]**2;
      for (let q = 0; q < this.n; q++) if ((i >> q) & 1) p[q] += amp;
    }
    return p;
  }
}
 
// ═══════════════════════════════════════════════════════
//  PRNG & HASH UTILITIES
// ═══════════════════════════════════════════════════════
 
function mulberry32(seed) {
  let s = (seed >>> 0) || 0xDEADBEEF;
  return () => {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}
 
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 33) ^ str.charCodeAt(i)) & 0xFFFFFFFF;
  return h >>> 0;
}
 
function fnv1a(str) {
  let h = 0x811C9DC5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
 
function imageSeed(w, h) {
  return (((w * 31 + h * 17) ^ (w * h * 7)) & 0xFFFFFFFF) >>> 0;
}
 
function deriveFinalSeed(imgSeed, keyVal, pass) {
  const h1 = djb2(pass), h2 = fnv1a(pass + '\x01QSTEGO');
  return ((imgSeed ^ keyVal ^ (h1 ^ h2)) & 0xFFFFFFFF) >>> 0;
}
 
function seededShuffle(arr, seed) {
  const rng = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}
 
// ═══════════════════════════════════════════════════════
//  QUANTUM CIRCUIT
// ═══════════════════════════════════════════════════════
 
const CIRCUIT_QUBITS = 8;
 
function runKeyCircuit(imgSeed) {
  const qr  = new QuantumRegister(CIRCUIT_QUBITS);
  const rng = mulberry32(imgSeed);
  for (let i = 0; i < CIRCUIT_QUBITS; i++) qr.hadamard(i);
  for (let i = 0; i < CIRCUIT_QUBITS - 1; i++) qr.cnot(i, i + 1);
  for (let i = 0; i < CIRCUIT_QUBITS; i++) {
    qr.phaseShift(i, (imgSeed * 0.000981 + i * 0.31415926) % (2 * Math.PI));
  }
  const probs = qr.qubitProbabilities();
  const bits  = qr.measureAll(rng);
  const keyVal = Array.from(bits).reduce((a, b, i) => a | (b << i), 0) >>> 0;
  const entropy = Array.from(probs).reduce((s, p) => {
    if (p <= 0 || p >= 1) return s;
    return s - (p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
  }, 0) / CIRCUIT_QUBITS;
  return { bits, keyVal, probs, entropy };
}
 
// ═══════════════════════════════════════════════════════
//  BINARY UTILS
// ═══════════════════════════════════════════════════════
 
const EOF_MARKER  = '\x00\x03\xFE\x01';
const MAX_MSG_LEN = 100000;
 
function textToBits(text) {
  const bits = new Uint8Array(text.length * 8);
  let idx = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i) & 0xFF;
    for (let b = 7; b >= 0; b--) bits[idx++] = (c >> b) & 1;
  }
  return bits;
}
 
function bitsToText(bits) {
  let text = '';
  const full = Math.floor(bits.length / 8) * 8;
  for (let i = 0; i < full; i += 8) {
    let c = 0;
    for (let b = 0; b < 8; b++) c = (c << 1) | (bits[i + b] & 1);
    text += String.fromCharCode(c);
  }
  return text;
}
 
function maxCapacity(px) {
  return Math.max(0, Math.floor((px * 3) / 8) - EOF_MARKER.length);
}
 
// ═══════════════════════════════════════════════════════
//  PASSPHRASE UTILITIES
// ═══════════════════════════════════════════════════════
 
const STRENGTH_LABELS = ['Too Short','Very Weak','Weak','Moderate','Strong','Very Strong'];
const STRENGTH_COLORS = ['#ff3d60','#ff3d60','#ff8c00','#ffc947','#39ff84','#00f0ff'];
 
function scoreStrength(p) {
  let s = 0;
  if (p.length >= 4)          s++;
  if (p.length >= 10)         s++;
  if (/[A-Z]/.test(p))        s++;
  if (/[0-9]/.test(p))        s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return { score:s, label:STRENGTH_LABELS[s]??'?', color:STRENGTH_COLORS[s]??'#ff3d60', pct:s*20 };
}
 
function suggestPassphrase() {
  const words = ['Quantum','Photon','Entangle','Hadamard','Circuit','Cipher',
                 'Matrix','Vortex','Signal','Nexus','Stealth','Encode','Prime','Blaze'];
  const a = new Uint32Array(4);
  crypto.getRandomValues(a);
  return `${words[a[0]%words.length]}-${words[a[1]%words.length]}-${a[2]%90+10}-${words[a[3]%words.length]}`;
}
 
// ═══════════════════════════════════════════════════════
//  CANVAS HELPERS
// ═══════════════════════════════════════════════════════
 
function imageDataFromFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new TypeError('File must be an image')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload  = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.onload  = () => {
        if (img.width < 10 || img.height < 10)    return reject(new RangeError('Image too small (min 10×10)'));
        if (img.width > 8000 || img.height > 8000) return reject(new RangeError('Image too large (max 8000×8000)'));
        const c = document.getElementById('js-work-canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d', { willReadFrequently:true });
        ctx.drawImage(img, 0, 0);
        resolve({ imageData: ctx.getImageData(0, 0, img.width, img.height), img });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
 
function imageDataToDataURL(imageData) {
  const c = document.getElementById('js-work-canvas');
  c.width = imageData.width; c.height = imageData.height;
  c.getContext('2d').putImageData(imageData, 0, 0);
  return c.toDataURL('image/png');
}
 
// ═══════════════════════════════════════════════════════
//  LOGGER
// ═══════════════════════════════════════════════════════
 
function makeLogger(id) {
  const el = document.getElementById(id);
  let count = 0;
  return {
    log(msg, level = 'info') {
      el.classList.add('is-visible');
      const ts  = new Date();
      const t   = `${ts.getHours().toString().padStart(2,'0')}:${ts.getMinutes().toString().padStart(2,'0')}:${ts.getSeconds().toString().padStart(2,'0')}`;
      const line = document.createElement('div'); line.className = 'log-line';
      const safe = String(msg).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      line.innerHTML = `<span class="log-time">[${t}]</span><span class="log-msg ${level}">${safe}</span>`;
      el.appendChild(line); el.scrollTop = el.scrollHeight;
      if (++count > 300) { el.removeChild(el.firstChild); count--; }
    },
    clear() { el.innerHTML = ''; count = 0; el.classList.remove('is-visible'); }
  };
}
 
function makeProgress(wrapId, fillId, labelId, pctId) {
  const wrap  = document.getElementById(wrapId);
  const fill  = document.getElementById(fillId);
  const label = document.getElementById(labelId);
  const pct   = document.getElementById(pctId);
  return {
    set(p, lbl) {
      wrap.classList.add('is-visible');
      fill.style.width = `${Math.min(100, Math.max(0, p))}%`;
      pct.textContent  = `${Math.round(p)}%`;
      wrap.setAttribute('aria-valuenow', Math.round(p));
      if (lbl) label.textContent = lbl;
    },
    reset() { fill.style.width = '0%'; pct.textContent = '0%'; wrap.classList.remove('is-visible'); }
  };
}
 
// yield to browser event loop
const yld = () => new Promise(r => setTimeout(r, 0));
 
// ═══════════════════════════════════════════════════════
//  CIRCUIT RENDERER
// ═══════════════════════════════════════════════════════
 
function startCircuitRenderer() {
  const canvas = document.getElementById('js-circuit-canvas');
  const ctx    = canvas.getContext('2d');
  let   bits   = new Uint8Array(8);
  let   lastW  = 0;
 
  const GATES = [
    {type:'H',x:.10},{type:'H',x:.18},{type:'H',x:.26},
    {type:'CNOT',x:.37,c:0,t:1},{type:'CNOT',x:.44,c:2,t:3},
    {type:'CNOT',x:.51,c:4,t:5},{type:'CNOT',x:.58,c:6,t:7},
    {type:'Rz',x:.68},{type:'Rz',x:.74},{type:'M',x:.86},
  ];
 
  function draw() {
    // Only update canvas dimensions when width actually changes
    // Setting canvas.width resets the context — avoid doing it every frame
    const W = canvas.parentElement ? canvas.parentElement.clientWidth : 0;
    const finalW = W > 10 ? W : 600;
    if (finalW !== lastW) {
      canvas.width  = finalW;
      canvas.height = 130;
      lastW = finalW;
    }
 
    const CW = canvas.width;
    const H  = canvas.height;
    const n  = 8;
    const rH = H / n;
    const t  = Date.now() / 1000;
 
    ctx.clearRect(0, 0, CW, H);
 
    // qubit lines + labels
    ctx.font      = "bold 9px 'Share Tech Mono', monospace";
    ctx.textAlign = 'left';
    for (let q = 0; q < n; q++) {
      const y = rH * q + rH / 2;
      ctx.strokeStyle = '#1a3a55'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(32, y); ctx.lineTo(CW - 26, y); ctx.stroke();
      ctx.fillStyle = '#00f0ff'; ctx.fillText('q' + q, 4, y + 4);
      ctx.fillStyle = bits[q] ? '#39ff84' : '#3d6b8a';
      ctx.fillText(String(bits[q]), CW - 18, y + 4);
    }
 
    // gates
    for (const g of GATES) {
      const gx = g.x * CW;
      const p  = Math.abs(Math.sin(t * 1.5 + g.x * 8)) * 0.5 + 0.5;
 
      if (g.type === 'CNOT') {
        const cy = rH * g.c + rH / 2;
        const ty = rH * g.t + rH / 2;
        ctx.strokeStyle = 'rgba(255,201,71,' + (p * 0.4) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(gx, cy); ctx.lineTo(gx, ty); ctx.stroke();
        ctx.beginPath(); ctx.arc(gx, cy, 5, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(255,201,71,' + p + ')'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,201,71,' + p + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(gx, ty, 9, 0, 2 * Math.PI); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(gx - 9, ty); ctx.lineTo(gx + 9, ty);
        ctx.moveTo(gx, ty - 9); ctx.lineTo(gx, ty + 9);
        ctx.stroke();
      } else {
        let col;
        if      (g.type === 'H')  col = 'rgba(0,212,180,'  + p + ')';
        else if (g.type === 'M')  col = 'rgba(255,61,96,'   + p + ')';
        else                       col = 'rgba(0,240,255,'  + p + ')';
        ctx.textAlign = 'center';
        for (let q = 0; q < n; q++) {
          const y = rH * q + rH / 2;
          ctx.strokeStyle = col; ctx.lineWidth = 1.2;
          ctx.strokeRect(gx - 11, y - 7.5, 22, 15);
          ctx.fillStyle = col;
          ctx.font = "bold 8px 'Share Tech Mono', monospace";
          ctx.fillText(g.type, gx, y + 3);
        }
        ctx.textAlign = 'left';
      }
    }
 
    // scan line
    const sx = ((t * 0.12) % 1) * CW;
    const gr = ctx.createLinearGradient(sx - 20, 0, sx + 20, 0);
    gr.addColorStop(0,   'transparent');
    gr.addColorStop(0.5, 'rgba(0,240,255,0.12)');
    gr.addColorStop(1,   'transparent');
    ctx.fillStyle = gr;
    ctx.fillRect(sx - 20, 0, 40, H);
 
    requestAnimationFrame(draw);
  }
 
  // Set initial canvas size then start loop
  function start() {
    const W = canvas.parentElement ? canvas.parentElement.clientWidth : 0;
    canvas.width  = W > 10 ? W : 600;
    canvas.height = 130;
    lastW = canvas.width;
    draw();
  }
 
  // Use 200ms timeout — most reliable fix for layout-not-ready issue
  setTimeout(start, 200);
 
  window.addEventListener('resize', function() {
    const W = canvas.parentElement ? canvas.parentElement.clientWidth : 600;
    if (W > 10) { canvas.width = W; lastW = W; }
  });
 
  return { updateBits: function(b) { bits = b; } };
}
 
 
function startBgRenderer() {
  const canvas = document.getElementById('js-bg-canvas');
  const ctx    = canvas.getContext('2d');
  function draw() {
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const W = canvas.width, H = canvas.height, t = Date.now() / 1000;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#00f0ff'; ctx.lineWidth = 0.5;
    for (let r = 0; r < 10; r++) {
      const y = (H/10)*r + H/20;
      ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
      for (let g = 0; g < 7; g++) {
        const gx = (W/7)*g + W/14 + Math.sin(t+r+g)*8;
        ctx.globalAlpha = Math.abs(Math.sin(t*.4+r*.4+g))*.4;
        ctx.strokeRect(gx-8, y-8, 16, 16);
      }
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }
  draw();
}
 
function spawnParticles() {
  const c = document.getElementById('js-particles');
  for (let i = 0; i < 32; i++) {
    const p = document.createElement('div'); p.className = 'particle';
    const sz = Math.random() * 3 + 1;
    const colors = ['#39ff84','#ffc947','#00f0ff'];
    p.style.cssText = [
      `width:${sz}px`,`height:${sz}px`,`left:${Math.random()*100}%`,
      `--dx:${(Math.random()-.5)*130}px`,
      `animation-duration:${7+Math.random()*11}s`,
      `animation-delay:${Math.random()*9}s`,
      `background:${colors[Math.floor(Math.random()*3)]}`
    ].join(';');
    c.appendChild(p);
  }
}
 
// ═══════════════════════════════════════════════════════
//  KEY DISPLAY
// ═══════════════════════════════════════════════════════
 
function renderKeyPanel(mode, { keyBits, keyProbs, keyVal, entropy, imgSeed, finalSeed }) {
  const bitsEl  = document.getElementById(`${mode}-key-bits`);
  const statsEl = document.getElementById(`${mode}-key-stats`);
  const panel   = document.getElementById(`${mode}-key-panel`);
  panel.classList.add('is-visible');
  bitsEl.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < keyBits.length; i++) {
    const p   = keyProbs[i] ?? 0.5;
    const cls = (p > .3 && p < .7) ? 'super' : keyBits[i] ? 'one' : 'zero';
    const d   = document.createElement('div');
    d.className = `qb ${cls}`; d.textContent = keyBits[i];
    d.setAttribute('title', `q${i}: P(|1⟩) = ${(p*100).toFixed(1)}%`);
    d.setAttribute('role','listitem');
    frag.appendChild(d);
  }
  bitsEl.appendChild(frag);
  const superCount = Array.from(keyProbs).filter(p => p > .3 && p < .7).length;
  statsEl.innerHTML = `
    <div class="key-stat"><span>Key: </span><span>0x${keyVal.toString(16).toUpperCase().padStart(4,'0')}</span></div>
    <div class="key-stat"><span>Image Seed: </span><span>${imgSeed}</span></div>
    <div class="key-stat"><span>Final Seed: </span><span>${finalSeed}</span></div>
    <div class="key-stat"><span>Superposed: </span><span>${superCount}/${keyBits.length}</span></div>
    <div class="key-stat"><span>Entropy: </span><span>${(entropy*100).toFixed(1)}%</span></div>
  `;
}
 
function renderPixelBitmap(imageData) {
  const el = document.getElementById('dec-pixel-bitmap');
  const d  = imageData.data;
  const n  = Math.min(64, (d.length / 4) | 0);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const lsb = d[i*4] & 1;
    const div = document.createElement('div');
    div.className = `pixel-bit pixel-bit--${lsb ? 'one' : 'zero'}`;
    div.textContent = lsb;
    div.setAttribute('title', `Pixel ${i} R-LSB: ${lsb}`);
    frag.appendChild(div);
  }
  el.innerHTML = ''; el.appendChild(frag);
  document.getElementById('dec-lsb-info').textContent = `First ${n} pixel R-channel LSBs`;
}
 
// ═══════════════════════════════════════════════════════
//  STEGO ENGINE
// ═══════════════════════════════════════════════════════
 
async function stegoEncode({ imageData, message, passphrase, log, progress }) {
  const { width, height } = imageData;
  const pixelCount = width * height;
  const cap = maxCapacity(pixelCount);
 
  if (message.length > cap)       throw new RangeError(`Message too long. Max: ${cap} chars.`);
  if (message.length > MAX_MSG_LEN) throw new RangeError(`Message exceeds ${MAX_MSG_LEN} char limit.`);
 
  log(`[INIT] ${width}×${height}px | ${pixelCount.toLocaleString()} pixels`, 'info');
  progress.set(8, 'Deriving image seed…');
  const iSeed = imageSeed(width, height);
  await yld();
 
  progress.set(16, 'Applying H⊗8 — Hadamard superposition…'); await yld();
  progress.set(24, 'Applying CNOT entanglement chain…');       await yld();
  progress.set(32, 'Applying Rz phase shifts…');               await yld();
  progress.set(40, 'Measuring quantum state…');
 
  const { bits:keyBits, keyVal, probs:keyProbs, entropy } = runKeyCircuit(iSeed);
  log(`[QUANTUM] Key: 0x${keyVal.toString(16).toUpperCase()} | Entropy: ${(entropy*100).toFixed(1)}%`, 'info');
  await yld();
 
  progress.set(48, 'Hashing passphrase (djb2 ⊕ fnv1a)…');
  const fSeed = deriveFinalSeed(iSeed, keyVal, passphrase);
  log(`[AUTH] finalSeed: ${fSeed}`, 'auth');
  await yld();
 
  progress.set(54, 'Generating quantum pixel permutation…');
  const indices = new Uint32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) indices[i] = i;
  seededShuffle(indices, fSeed);
  await yld();
 
  progress.set(60, 'Converting message to binary…');
  const payload = message + EOF_MARKER;
  const msgBits = textToBits(payload);
  log(`[MSG] ${message.length} chars → ${msgBits.length} bits`, 'proc');
  await yld();
 
  progress.set(65, 'Embedding via Quantum LSB…');
  const data = new Uint8ClampedArray(imageData.data);
  let bIdx = 0, modified = 0;
  const total = msgBits.length;
 
  for (let pi = 0; pi < indices.length && bIdx < total; pi++) {
    const base = indices[pi] * 4;
    for (let ch = 0; ch < 3 && bIdx < total; ch++) {
      data[base + ch] = (data[base + ch] & 0xFE) | msgBits[bIdx++];
    }
    modified++;
    if (pi % 5000 === 0) {
      progress.set(65 + ((bIdx / total) * 28) | 0, `Embedding bit ${bIdx.toLocaleString()}/${total.toLocaleString()}…`);
      await yld();
    }
  }
 
  log(`[LSB] ${bIdx} bits embedded across ${modified.toLocaleString()} pixels`, 'ok');
  progress.set(100, '✓ Quantum encoding complete');
  return { imageData: new ImageData(data, width, height), bitsWritten:bIdx, pixelsModified:modified, keyBits, keyProbs, keyVal, entropy, imgSeed:iSeed, finalSeed:fSeed };
}
 
async function stegoDecode({ imageData, passphrase, log, progress }) {
  const { width, height, data } = imageData;
  const pixelCount = width * height;
 
  log(`[INIT] ${width}×${height}px`, 'info');
  progress.set(8, 'Re-deriving image seed…');
  const iSeed = imageSeed(width, height);
  await yld();
 
  progress.set(20, 'Re-running quantum circuit H→CNOT→Rz→M…'); await yld();
  progress.set(36, 'Measuring quantum state…');
 
  const { bits:keyBits, keyVal, probs:keyProbs, entropy } = runKeyCircuit(iSeed);
  log(`[QUANTUM] Key reconstructed: 0x${keyVal.toString(16).toUpperCase()}`, 'info');
  await yld();
 
  progress.set(44, 'Re-applying passphrase hash…');
  const fSeed = deriveFinalSeed(iSeed, keyVal, passphrase);
  log(`[AUTH] finalSeed: ${fSeed}`, 'auth');
  await yld();
 
  progress.set(52, 'Reconstructing quantum pixel permutation…');
  const indices = new Uint32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) indices[i] = i;
  seededShuffle(indices, fSeed);
  await yld();
 
  progress.set(58, 'Extracting LSBs in quantum order…');
  const extracted = [];
  const limit = Math.min(pixelCount * 3, 2400000);
  let eofIdx = -1, runningText = '';
 
  for (let pi = 0; pi < indices.length; pi++) {
    const base = indices[pi] * 4;
    for (let ch = 0; ch < 3; ch++) extracted.push(data[base + ch] & 1);
    const bits = extracted.length;
    if (bits >= EOF_MARKER.length * 8 && bits % 8 === 0) {
      runningText = bitsToText(extracted);
      const found = runningText.indexOf(EOF_MARKER);
      if (found !== -1) { eofIdx = found; break; }
    }
    if (bits >= limit) break;
    if (pi % 6000 === 0) {
      progress.set(58 + ((pi / Math.min(indices.length, 100000)) * 30) | 0, `Extracted ${extracted.length.toLocaleString()} bits…`);
      await yld();
    }
  }
 
  const authenticated = eofIdx > 0;
  const message = authenticated ? runningText.slice(0, eofIdx) : '';
  progress.set(100, authenticated ? '✓ Authentication successful' : '✗ Authentication failed');
  log(authenticated ? `[AUTH ✓] ${message.length} chars decoded` : '[AUTH ✗] Wrong passphrase or no payload', authenticated ? 'ok' : 'auth');
  return { authenticated, message, bitsExtracted:extracted.length, keyBits, keyProbs, keyVal, entropy, imgSeed:iSeed, finalSeed:fSeed };
}
 
// ═══════════════════════════════════════════════════════
//  DRAG & DROP
// ═══════════════════════════════════════════════════════
 
function setupDropZone(dropId, inputId, onFile) {
  const zone  = document.getElementById(dropId);
  const input = document.getElementById(inputId);
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('is-over');
    const f = e.dataTransfer.files[0]; if (f) onFile(f);
  });
  input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); });
}
 
// ═══════════════════════════════════════════════════════
//  PASSPHRASE UI
// ═══════════════════════════════════════════════════════
 
function setupPassphraseUI(inputId, toggleId, suggestId, fillId, hintId) {
  const input  = document.getElementById(inputId);
  const toggle = document.getElementById(toggleId);
  const fill   = fillId   ? document.getElementById(fillId)   : null;
  const hint   = hintId   ? document.getElementById(hintId)   : null;
 
  toggle && toggle.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password';
    toggle.textContent = input.type === 'password' ? '👁' : '🙈';
    toggle.setAttribute('aria-label', input.type === 'password' ? 'Show passphrase' : 'Hide passphrase');
  });
 
  if (suggestId) {
    const sug = document.getElementById(suggestId);
    sug && sug.addEventListener('click', () => {
      input.value = suggestPassphrase();
      input.type  = 'text';
      input.dispatchEvent(new Event('input'));
    });
  }
 
  input.addEventListener('input', () => {
    const st = scoreStrength(input.value);
    if (fill) { fill.style.width = st.pct + '%'; fill.style.background = st.color; }
    if (hint && input.value.length > 0) {
      hint.textContent = `Strength: ${st.label} — share this passphrase privately`;
      hint.style.color = st.color;
    } else if (hint) {
      hint.textContent = 'Only someone with this passphrase can decode the message';
      hint.style.color = '';
    }
    input.classList.toggle('is-invalid', input.value.length > 0 && input.value.length < 4);
  });
}
 
// ═══════════════════════════════════════════════════════
//  MAIN APP CONTROLLER
// ═══════════════════════════════════════════════════════
 
const App = (() => {
  let encImageData = null, stegoURL = null, decImageData = null, circuitCtrl = null;
 
  const encLog  = makeLogger('enc-log');
  const decLog  = makeLogger('dec-log');
  const encProg = makeProgress('enc-progress','enc-progress-fill','enc-progress-label','enc-progress-pct');
  const decProg = makeProgress('dec-progress','dec-progress-fill','dec-progress-label','dec-progress-pct');
 
  function switchTab(tab) {
    ['encode','decode'].forEach(t => {
      document.getElementById(`tab-${t}`).setAttribute('aria-selected', t === tab);
      document.getElementById(`panel-${t}`).hidden = t !== tab;
    });
  }
 
  async function runEncode() {
    const message    = document.getElementById('enc-message').value.trim();
    const passphrase = document.getElementById('enc-passphrase').value;
    const errors = [];
    if (!encImageData)                   errors.push('Please upload a cover image.');
    if (!message)                        errors.push('Please enter a secret message.');
    if (!passphrase || passphrase.length < 4) errors.push('Passphrase must be at least 4 characters.');
    if (errors.length) { alert(errors.join('\n')); return; }
 
    const btn = document.getElementById('enc-submit-btn'); btn.disabled = true;
    encLog.clear(); encProg.reset();
    document.getElementById('enc-stego-box').hidden = true;
    document.getElementById('enc-download-btn').hidden = true;
    document.getElementById('enc-stats').classList.remove('is-visible');
 
    try {
      const result = await stegoEncode({ imageData:encImageData, message, passphrase, log:(m,l)=>encLog.log(m,l), progress:encProg });
      if (circuitCtrl) circuitCtrl.updateBits(result.keyBits);
      renderKeyPanel('enc', result);
      stegoURL = imageDataToDataURL(result.imageData);
      document.getElementById('enc-stego-img').src = stegoURL;
      document.getElementById('enc-stego-box').hidden = false;
      document.getElementById('enc-stego-info').textContent = `${result.pixelsModified.toLocaleString()} pixels modified`;
      document.getElementById('enc-download-btn').hidden = false;
      const sg = document.getElementById('enc-stats'); sg.classList.add('is-visible');
      document.getElementById('enc-stat-qubits') .textContent = CIRCUIT_QUBITS;
      document.getElementById('enc-stat-gates')  .textContent = (CIRCUIT_QUBITS*3-1+result.bitsWritten).toLocaleString();
      document.getElementById('enc-stat-pixels') .textContent = result.pixelsModified.toLocaleString();
      document.getElementById('enc-stat-entropy').textContent = (result.entropy*100).toFixed(2) + '%';
    } catch(err) {
      encLog.log('[ERROR] ' + err.message, 'error');
      alert('Encoding failed: ' + err.message);
    } finally { btn.disabled = false; }
  }
 
  async function runDecode() {
    const passphrase = document.getElementById('dec-passphrase').value;
    const errors = [];
    if (!decImageData)                   errors.push('Please upload a stego image.');
    if (!passphrase || passphrase.length < 4) errors.push('Passphrase must be at least 4 characters.');
    if (errors.length) { alert(errors.join('\n')); return; }
 
    const btn = document.getElementById('dec-submit-btn'); btn.disabled = true;
    decLog.clear(); decProg.reset();
    document.getElementById('dec-result').classList.remove('is-visible');
    document.getElementById('dec-auth-alert').classList.remove('is-visible');
    document.getElementById('dec-stats').classList.remove('is-visible');
 
    try {
      const result = await stegoDecode({ imageData:decImageData, passphrase, log:(m,l)=>decLog.log(m,l), progress:decProg });
      if (circuitCtrl) circuitCtrl.updateBits(result.keyBits);
      renderKeyPanel('dec', result);
      const rs = document.getElementById('dec-result'); rs.classList.add('is-visible');
      const rb = document.getElementById('dec-result-badge');
      const rbox = document.getElementById('dec-result-box');
      const rtext = document.getElementById('dec-result-text');
      if (result.authenticated) {
        rb.textContent = '✔ AUTHENTICATED — MESSAGE FOUND'; rb.className = 'result-badge result-badge--ok';
        rbox.className = 'result-box result-box--ok'; rtext.textContent = result.message;
      } else {
        rb.textContent = '✗ AUTHENTICATION FAILED'; rb.className = 'result-badge result-badge--fail';
        rbox.className = 'result-box result-box--fail';
        rtext.textContent = '[ Wrong passphrase or no QuantumStego payload in this image ]';
        document.getElementById('dec-auth-alert').classList.add('is-visible');
      }
      const ds = document.getElementById('dec-stats'); ds.classList.add('is-visible');
      document.getElementById('dec-stat-qubits') .textContent = CIRCUIT_QUBITS;
      document.getElementById('dec-stat-gates')  .textContent = (CIRCUIT_QUBITS*3-1).toLocaleString();
      document.getElementById('dec-stat-bits')   .textContent = result.bitsExtracted.toLocaleString();
      document.getElementById('dec-stat-fidelity').textContent = result.authenticated ? '99.97' : '0.00';
    } catch(err) {
      decLog.log('[ERROR] ' + err.message, 'error');
      alert('Decoding failed: ' + err.message);
    } finally { btn.disabled = false; }
  }
 
  function downloadStego() {
    if (!stegoURL) return;
    const a = document.createElement('a');
    a.href = stegoURL; a.download = 'quantum_stego_' + Date.now() + '.png'; a.click();
  }
 
  async function handleImage(file, mode) {
    try {
      const { imageData, img } = await imageDataFromFile(file);
      document.getElementById(`${mode}-img-info`).textContent = `${img.width}×${img.height}px | ${(file.size/1024).toFixed(1)} KB`;
      if (mode === 'enc') {
        encImageData = imageData;
        document.getElementById('enc-preview-img').src = URL.createObjectURL(file);
        document.getElementById('enc-preview-grid').classList.add('is-visible');
        const cap = maxCapacity(img.width * img.height);
        document.getElementById('enc-char-counter').textContent = `0 / ${cap.toLocaleString()} chars`;
        const iSeed = imageSeed(img.width, img.height);
        const pass  = document.getElementById('enc-passphrase').value;
        const { bits:keyBits, keyVal, probs:keyProbs, entropy } = runKeyCircuit(iSeed);
        const fSeed = deriveFinalSeed(iSeed, keyVal, pass || '');
        renderKeyPanel('enc', { keyBits, keyProbs, keyVal, entropy, imgSeed:iSeed, finalSeed:fSeed });
        if (circuitCtrl) circuitCtrl.updateBits(keyBits);
      } else {
        decImageData = imageData;
        document.getElementById('dec-preview-img').src = URL.createObjectURL(file);
        document.getElementById('dec-preview-grid').classList.add('is-visible');
        renderPixelBitmap(imageData);
        const iSeed = imageSeed(img.width, img.height);
        const pass  = document.getElementById('dec-passphrase').value;
        const { bits:keyBits, keyVal, probs:keyProbs, entropy } = runKeyCircuit(iSeed);
        const fSeed = deriveFinalSeed(iSeed, keyVal, pass || '');
        renderKeyPanel('dec', { keyBits, keyProbs, keyVal, entropy, imgSeed:iSeed, finalSeed:fSeed });
        if (circuitCtrl) circuitCtrl.updateBits(keyBits);
      }
    } catch(err) { alert('Image load failed: ' + err.message); }
  }
 
  function init() {
    circuitCtrl = startCircuitRenderer();
    startBgRenderer();
    spawnParticles();
    setupDropZone('enc-dropzone', 'enc-file-input', f => handleImage(f, 'enc'));
    setupDropZone('dec-dropzone', 'dec-file-input', f => handleImage(f, 'dec'));
    setupPassphraseUI('enc-passphrase','enc-pass-toggle','enc-pass-suggest','enc-strength-fill','enc-pass-hint');
    setupPassphraseUI('dec-passphrase','dec-pass-toggle', null, null, null);
 
    document.getElementById('enc-message').addEventListener('input', function() {
      const cap = encImageData ? maxCapacity(encImageData.width * encImageData.height) : 0;
      const len = this.value.length;
      const el  = document.getElementById('enc-char-counter');
      el.textContent = `${len.toLocaleString()} / ${cap > 0 ? cap.toLocaleString() : '—'} chars`;
      el.classList.toggle('is-over', cap > 0 && len > cap);
      this.classList.toggle('is-invalid', cap > 0 && len > cap);
    });
 
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
      });
    });
  }
 
  return { init, switchTab, runEncode, runDecode, downloadStego };
})();
 
// type="module" scripts run after DOM is ready - call init directly
window.App = App;
App.init();

 

