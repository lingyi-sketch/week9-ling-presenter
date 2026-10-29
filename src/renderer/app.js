// ===== 화면 요소 =====
const $ = id => document.getElementById(id);
const site = $('site');
const avatar = $('avatar');
const lingi = $('lingi');
const bubble = $('bubble');
const bubbleText = $('bubble-text');
const mouth = $('mouth');

const state = {
  cfg: null,
  knowledge: null,
  segments: [],          // [{ path, lines: [{ text, focus?, bridge? }], text }]
  segIndex: 0,
  presenting: false,
  recording: null,
  history: [],
  faq: { fillers: [], fillers2: [], items: [] },
  recentFillers: [],
  cloudOff: false,       // 자동 모드에서 클라우드 음성이 실패하면 OS 기본 음성으로 전환
  follow: true,
  focusPoint: null
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ===== 상태 표시 =====
let statusTimer;
function status(msg, { error = false, sticky = false } = {}) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'show' + (error ? ' error' : '');
  clearTimeout(statusTimer);
  if (!sticky) statusTimer = setTimeout(() => (el.className = ''), error ? 7000 : 3500);
}
const clearStatus = () => ($('status').className = '');

function setMood(mood) {
  avatar.classList.remove('idle', 'thinking', 'listening');
  if (mood) avatar.classList.add(mood);
  document.body.classList.toggle('busy', mood === 'thinking' || mood === 'listening');
}

function say(text, { question, dots } = {}) {
  bubbleText.textContent = '';
  if (question) {
    const q = document.createElement('span');
    q.className = 'q';
    q.textContent = 'Q. ' + question;
    bubbleText.appendChild(q);
  }
  bubbleText.appendChild(document.createTextNode(text));
  bubble.classList.toggle('dots', !!dots);
  bubble.classList.remove('hidden');
  placeBubble();
}
const hideBubble = () => bubble.classList.add('hidden');

// ===== 캐릭터: 마우스 따라다니기 =====
const pos = { x: window.innerWidth - 180, y: window.innerHeight - 260 };
const mouse = { x: pos.x, y: pos.y };
const AV_W = 120, AV_H = 128;

function onMouse(x, y) { mouse.x = x; mouse.y = y; }
window.addEventListener('mousemove', e => onMouse(e.clientX, e.clientY));

function targetPos() {
  // 발표·답변 중에는 지금 강조한 내용 옆에 선다
  if (state.focusPoint) return { ...state.focusPoint };
  if (!state.follow) return { x: window.innerWidth - AV_W - 40, y: window.innerHeight - AV_H - 90 };
  // 커서 오른쪽 아래에 살짝 떨어져서 따라온다 (화면 밖으로 나가지 않게)
  let x = mouse.x + 36, y = mouse.y + 24;
  if (x + AV_W > window.innerWidth - 8) x = mouse.x - AV_W - 36;
  if (y + AV_H > window.innerHeight - 76) y = window.innerHeight - 76 - AV_H;
  return { x: Math.max(8, x), y: Math.max(8, y) };
}

function placeBubble() {
  // 말풍선이 화면 밖으로 나가지 않게 좌우를 보정
  if (bubble.classList.contains('hidden')) return;
  const bw = bubble.offsetWidth;
  const center = pos.x + AV_W / 2;
  const left = Math.min(Math.max(8, center - bw / 2), window.innerWidth - bw - 8);
  const shift = left - center;
  bubble.style.setProperty('--bubble-shift', `${shift}px`);
  bubble.style.setProperty('--tail', `${Math.min(Math.max(20, -shift), bw - 20)}px`);
}

let lastX = pos.x;
function tick() {
  const t = targetPos();
  const bubbleH = bubble.classList.contains('hidden') ? 0 : bubble.offsetHeight + 12;
  t.y = Math.max(t.y, bubbleH + 8);
  pos.x += (t.x - pos.x) * 0.12;
  pos.y += (t.y - pos.y) * 0.12;
  // 움직이는 방향으로 살짝 기울인다 (말풍선은 기울이지 않고 캐릭터만)
  const tilt = Math.max(-12, Math.min(12, (pos.x - lastX) * 1.5));
  avatar.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  lingi.style.rotate = `${tilt}deg`;
  lastX = pos.x;
  placeBubble();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ===== 포트폴리오 화면 =====
function origin() { return new URL(state.cfg.portfolioUrl).origin; }
function currentPath() {
  try { return new URL(site.getURL()).pathname.replace(/\/$/, '') || '/'; } catch { return ''; }
}

// 페이지를 옮기고, 본문이 그려지면(최대 6초) 끝난다. 이미 그 페이지면 바로 끝난다.
function navigate(path) {
  if (!path || currentPath() === path) return Promise.resolve();
  return new Promise(resolve => {
    let finished = false;
    const finish = () => { if (!finished) { finished = true; site.removeEventListener('did-stop-loading', onStop); resolve(); } };
    const onStop = async () => {
      // 클라이언트에서 그리는 페이지라 본문 글자가 나올 때까지 잠깐 확인
      for (let i = 0; i < 20 && !finished; i++) {
        const n = await site.executeJavaScript(`((document.querySelector('main')||document.body).innerText||'').replace(/불러오는 중[^\\n]*/,'').trim().length`).catch(() => 999);
        if (n > 40) break;
        await sleep(100);
      }
      finish();
    };
    site.addEventListener('did-stop-loading', onStop);
    site.loadURL(origin() + path);
    setTimeout(finish, 6000);
  });
}

// 강조: 대본에 적어 둔 화면 글자(target)를 찾고, 없으면 문장(sentence)과 가장 비슷한 요소를 찾는다.
// 찾은 요소를 화면 가운데로 스크롤해 금색 테두리를 두르고, 스크롤이 끝났을 때의 위치를 돌려준다.
const FOCUS_JS = ({ target, sentence }) => `(() => {
  const target = ${JSON.stringify(target || '')};
  const sentence = ${JSON.stringify(sentence || '')};
  const norm = s => (s || '').replace(/\\s+/g, '').toLowerCase();
  const root = document.querySelector('main') || document.body;
  const els = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,figcaption,blockquote,a,span,div,img')]
    .filter(el => el.offsetParent && el.getBoundingClientRect().height > 0);
  let best = null;
  if (target) {
    const t = norm(target);
    let bestLen = Infinity;
    for (const el of els) {
      const txt = norm(el.tagName === 'IMG' ? el.alt : el.innerText);
      if (txt.includes(t) && txt.length < bestLen) { bestLen = txt.length; best = el; }
    }
  }
  if (!best && sentence) {
    const grams = s => { const x = norm(s).replace(/[.,!?'"()\\[\\]·…~:;-]/g, ''); const g = new Set(); for (let i = 0; i < x.length - 1; i++) g.add(x.slice(i, i + 2)); return g; };
    const want = grams(sentence);
    let bestScore = 0, bestHit = 0;
    for (const el of els) {
      if (el.children.length > 3) continue;
      const text = (el.innerText || '').trim();
      if (text.length < 2 || text.length > 500) continue;
      const g = grams(text);
      let hit = 0;
      for (const x of g) if (want.has(x)) hit++;
      const score = hit / Math.sqrt(g.size + 4) * (/^H\\d$/.test(el.tagName) ? 1.6 : 1);
      if (score > bestScore) { bestScore = score; best = el; bestHit = hit; }
    }
    if (bestScore < 0.8 || bestHit < 5) best = null;
  }
  document.querySelectorAll('[data-ling-focus]').forEach(e => { e.style.outline = ''; e.style.boxShadow = ''; e.removeAttribute('data-ling-focus'); });
  if (!best) return null;
  best.setAttribute('data-ling-focus', '');
  best.style.outline = '3px solid #e8c98f';
  best.style.outlineOffset = '4px';
  best.style.boxShadow = '0 0 0 8px rgba(232,201,143,.25)';
  const r = best.getBoundingClientRect();
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
  const goal = Math.min(maxScroll, Math.max(0, scrollY + r.top - (innerHeight - Math.min(r.height, innerHeight)) / 2));
  scrollTo({ top: goal, behavior: 'smooth' });
  const top = r.top + scrollY - goal;
  return { left: r.left, right: r.right, top, bottom: top + r.height };
})()`;

async function highlight(what) {
  let rect = null;
  try { rect = await site.executeJavaScript(FOCUS_JS(what)); } catch {}
  if (!rect) return false;
  const vr = site.getBoundingClientRect();
  const W = window.innerWidth, H = window.innerHeight;
  // 요소 오른쪽에 자리가 있으면 오른쪽, 없으면 왼쪽에 선다
  let x = vr.left + rect.right + 16;
  if (x + AV_W > W - 8) x = vr.left + rect.left - AV_W - 16;
  if (x < 8) x = Math.min(W - AV_W - 8, vr.left + rect.right - AV_W);
  const y = vr.top + (Math.max(rect.top, 0) + Math.min(rect.bottom, vr.height)) / 2 - AV_H / 2;
  state.focusPoint = { x: Math.max(8, Math.min(W - AV_W - 8, x)), y: Math.max(8, Math.min(H - AV_H - 80, y)) };
  return true;
}

// 테두리만 지운다 (아바타는 그 자리에 둔다)
function clearHighlight() {
  site.executeJavaScript(`document.querySelectorAll('[data-ling-focus]').forEach(e => { e.style.outline = ''; e.style.boxShadow = ''; e.removeAttribute('data-ling-focus'); })`).catch(() => {});
}
// 테두리를 지우고 아바타도 다시 마우스를 따라가게 한다
function clearFocus() {
  state.focusPoint = null;
  clearHighlight();
}

site.addEventListener('ipc-message', e => {
  if (e.channel === 'mouse') {
    const r = site.getBoundingClientRect();
    onMouse(r.left + e.args[0], r.top + e.args[1]);
  } else if (e.channel === 'key') handleKey(e.args[0]);
  else if (e.channel === 'explain') explainPointed(e.args[0], e.args[1], e.args[2]);
});

// ===== 가리켜서 설명하기 (👆 모드에서 페이지의 한 부분을 클릭) =====
function setExplainMode(on) {
  state.explainMode = on;
  $('btn-explain').classList.toggle('on', on);
  site.send('explain-mode', on);
  status(on ? '👆 설명 모드: 설명을 듣고 싶은 부분을 클릭하세요. (F4로 끄기)' : '설명 모드를 껐어요.');
}

function explainPointed(text, x, y) {
  if (!hasGeminiKey() || state.recording) return;
  if (state.presenting) stopIntro();
  const r = site.getBoundingClientRect();
  const W = window.innerWidth, H = window.innerHeight;
  // 클릭한 곳 오른쪽(자리가 없으면 왼쪽)으로 다가간다
  let ax = r.left + x + 40;
  if (ax + AV_W > W - 8) ax = r.left + x - AV_W - 40;
  state.focusPoint = { x: Math.max(8, Math.min(W - AV_W - 8, ax)), y: Math.max(8, Math.min(H - AV_H - 80, r.top + y - AV_H / 2)) };
  ask({
    questionText: `화면에서 지금 가리킨 부분을 청중에게 설명해 줘. 이 부분이 무엇인지, 내가 어떤 의도로 만들었는지를 사이트 내용에 근거해 말해 줘. 가리킨 부분의 내용: """${text}"""`,
    label: '👆 이 부분은요?',
    pointed: true
  });
}

// ===== 음성 출력 =====
// 음성은 AudioBuffer로 풀어서 재생한다: 문장 사이의 무음을 찾아 문장별 시작 시각을 알 수 있다.
let speakToken = 0;
let currentSource = null;
let audioCtx = null;
const ctx = () => (audioCtx = audioCtx || new AudioContext());
const bufferCache = new Map();     // 문장 묶음 text → Promise<AudioBuffer|null>
const LEAD = 0.3;                  // 강조는 말보다 0.3초 먼저

function splitSentences(text) {
  return (text.match(/[^.!?。！？\n]+[.!?。！？]*\s*/g) || [text]).map(s => s.trim()).filter(Boolean);
}

function stopSpeaking({ keepFocus = false } = {}) {
  speakToken++;
  if (currentSource) { try { currentSource.stop(); } catch {} currentSource = null; }
  speechSynthesis.cancel();
  avatar.classList.remove('speaking-css');
  mouth.style.transform = '';
  if (!keepFocus) clearFocus();
}

const cloudOn = () => state.cfg.ttsMode !== 'system' && !(state.cfg.ttsMode === 'auto' && state.cloudOff);

function b64ToBuffer(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

// 저장된 음성 → 없으면(허용될 때) 새로 만든다. 실패하면 오류를 던진다.
function loadVoice(text, { cachedOnly = false } = {}) {
  const key = (cachedOnly ? 'c:' : 'g:') + text;
  if (!bufferCache.has(key)) {
    const p = (async () => {
      let b64 = await window.api.ttsCached(text).catch(() => null);
      if (!b64 && !cachedOnly) b64 = await window.api.tts(text);
      if (!b64) return null;
      return ctx().decodeAudioData(b64ToBuffer(b64));
    })();
    p.catch(() => bufferCache.delete(key));
    bufferCache.set(key, p);
  }
  return bufferCache.get(key);
}
const prefetch = text => { if (state.cfg.ttsMode !== 'system') loadVoice(text, { cachedOnly: !cloudOn() }).catch(() => {}); };

// 문장별 시작·끝 시각(초): 음성 안의 무음 구간을 글자 수로 예상한 경계와 맞춰 고른다.
const timesCache = new WeakMap();
function sentenceTimes(buffer, units) {
  if (timesCache.has(buffer)) return timesCache.get(buffer);
  const data = buffer.getChannelData(0);
  const hop = Math.round(buffer.sampleRate * 0.01);
  const rms = [];
  for (let i = 0; i + hop <= data.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + hop; j++) s += data[j] * data[j];
    rms.push(Math.sqrt(s / hop));
  }
  const peak = Math.max(...rms, 1e-6);
  const thr = Math.max(peak * 0.08, 0.004);
  const loud = rms.map(v => v > thr);
  const first = Math.max(0, loud.indexOf(true)) * 0.01;
  const last = (loud.lastIndexOf(true) + 1) * 0.01 || buffer.duration;
  const runs = [];
  for (let i = 0; i < loud.length;) {
    if (loud[i]) { i++; continue; }
    let j = i;
    while (j < loud.length && !loud[j]) j++;
    if ((j - i) * 0.01 >= 0.12 && i * 0.01 > first && j * 0.01 < last) runs.push({ s: i * 0.01, e: j * 0.01 });
    i = j;
  }
  const total = units.reduce((n, u) => n + u.length, 0) || 1;
  const span = last - first;
  const times = units.map(() => ({ start: first, end: last }));
  let acc = 0, prev = first;
  for (let k = 1; k < units.length; k++) {
    acc += units[k - 1].length;
    const expect = first + span * acc / total;
    const tol = Math.max(1.5, 0.35 * span / units.length);
    // 문장 사이 쉼(보통 0.3초 이상)을 먼저 찾고, 없을 때만 짧은 숨 쉬는 틈을 쓴다
    const near = runs.filter(r => (r.s + r.e) / 2 > prev + 0.2 && Math.abs((r.s + r.e) / 2 - expect) <= tol);
    const long = near.filter(r => r.e - r.s >= 0.25);
    let pick = null;
    for (const r of long.length ? long : near) {
      const mid = (r.s + r.e) / 2;
      if (!pick || Math.abs(mid - expect) < Math.abs((pick.s + pick.e) / 2 - expect)) pick = r;
    }
    times[k - 1].end = pick ? pick.s : expect;
    times[k].start = pick ? pick.e : expect;
    prev = times[k].start;
  }
  timesCache.set(buffer, times);
  return times;
}

// units(문장 배열)를 한 덩어리 음성으로 말한다.
// hooks.onUnit(k): k번째 문장 시작 0.3초 전, hooks.onUnitEnd(k): k번째 문장이 끝나고 0.3초 뒤
// 반환값: 끝까지 말했으면 true, 멈췄거나 소리를 못 냈으면 false
// noFallback: 목소리 듣기처럼, 실패하면 OS 음성으로 바꾸지 않고 이유만 보여 줄 때
async function speak(units, hooks = {}, { cachedOnly = false, noFallback = false } = {}) {
  stopSpeaking({ keepFocus: true });
  const token = speakToken;
  const text = units.join(' ');
  if (state.cfg.ttsMode !== 'system') {
    try {
      const buffer = await loadVoice(text, { cachedOnly: cachedOnly || !cloudOn() });
      if (token !== speakToken) return false;
      if (buffer) return playBuffer(buffer, units, token, hooks);
      if (cachedOnly) return false;
    } catch (e) {
      if (token !== speakToken) return false;
      if (cachedOnly) return false;
      if (noFallback || state.cfg.ttsMode === 'cloud') { status(e.message, { error: true, sticky: noFallback }); return false; }
      state.cloudOff = true;
      status('음성을 만들 수 없어 OS 기본 음성으로 바꿉니다. (' + e.message + ')', { error: true });
    }
  }
  if (cachedOnly) return false;
  return speakSystem(units, token, hooks);
}

function playBuffer(buffer, units, token, hooks) {
  return new Promise(resolve => {
    const ac = ctx();
    ac.resume().catch(() => {});
    const times = sentenceTimes(buffer, units);
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const analyser = ac.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    analyser.connect(ac.destination);
    currentSource = src;
    const buf = new Uint8Array(analyser.fftSize);
    const t0 = ac.currentTime + 0.05;
    const fired = new Set(), ended = new Set();
    let shown = -1, done = false;
    // requestAnimationFrame은 창이 가려지면 멈추므로, 강조·페이지 이동 시각은 타이머로 확인한다
    const timer = setInterval(() => frame(), 30);
    const frame = () => {
      if (done || token !== speakToken) { clearInterval(timer); mouth.style.transform = ''; return; }
      const t = ac.currentTime - t0;
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      mouth.style.transform = `scaleY(${0.5 + Math.min(2.4, peak / 18)})`;
      times.forEach((tm, k) => {
        if (!fired.has(k) && t >= tm.start - LEAD) { fired.add(k); hooks.onUnit?.(k); }
        if (!ended.has(k) && t >= tm.end + 0.3) { ended.add(k); hooks.onUnitEnd?.(k); }
      });
      let idx = 0;
      times.forEach((tm, k) => { if (t >= tm.start - 0.05) idx = k; });
      if (idx !== shown) { shown = idx; say(units[idx]); }
    };
    src.onended = () => {
      done = true;
      clearInterval(timer);
      mouth.style.transform = '';
      if (currentSource === src) currentSource = null;
      resolve(token === speakToken);
    };
    src.start(t0);
  });
}

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  const want = state.cfg.systemVoice;
  if (want) { const v = voices.find(v => v.name === want); if (v) return v; }
  const lang = { ko: 'ko', zh: 'zh', en: 'en' }[state.cfg.lang];
  return voices.find(v => v.lang.toLowerCase().startsWith(lang)) || null;
}

async function speakSystem(units, token, hooks) {
  for (const [k, s] of units.entries()) {
    if (token !== speakToken) return false;
    say(s);
    hooks.onUnit?.(k);
    await new Promise(resolve => {
      const u = new SpeechSynthesisUtterance(s);
      const v = pickVoice();
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = { ko: 'ko-KR', zh: 'zh-CN', en: 'en-US' }[state.cfg.lang];
      u.rate = 1.02;
      u.onstart = () => avatar.classList.add('speaking-css');
      u.onend = u.onerror = () => { avatar.classList.remove('speaking-css'); resolve(); };
      speechSynthesis.speak(u);
    });
    hooks.onUnitEnd?.(k);
  }
  return token === speakToken;
}

// ===== 사이트 내용 =====
window.api.onSiteProgress(p => {
  if (p.current) say(`포트폴리오를 읽는 중이에요 (${p.done + 1}페이지: ${p.current})`, { dots: true });
});

async function ensureKnowledge(refresh = false) {
  if (state.knowledge && !refresh) return state.knowledge;
  setMood('thinking');
  try {
    state.knowledge = await window.api.getKnowledge(refresh);
    updateSiteInfo();
    return state.knowledge;
  } finally {
    setMood('idle');
  }
}

function updateSiteInfo() {
  const k = state.knowledge;
  $('site-info').textContent = k
    ? `읽어 둔 페이지 ${k.pages.length}개 · ${new Date(k.crawledAt).toLocaleString()} · ${k.pages.map(p => p.path).join(', ')}`
    : '';
}

// 질의응답·대본 생성에는 Gemini 키가 필요하다 (미리 만든 소개 음성 재생에는 필요 없음)
function hasGeminiKey() {
  if (state.cfg.hasKey) return true;
  status('먼저 ⚙ 설정에서 Gemini API 키를 입력해 주세요.', { error: true });
  openSettings();
  return false;
}

// ===== 대본 =====
function linesOf(seg) {
  if (seg.lines?.length) return seg.lines;
  return splitSentences(seg.text || '').map(text => ({ text }));
}
const segText = seg => linesOf(seg).map(l => l.text).join(' ');
const normalizeSeg = seg => ({ path: seg.path, lines: linesOf(seg), text: segText(seg) });

// ===== 소개 =====
async function toggleIntro() {
  if (state.presenting) return stopIntro();
  if (state.recording) return;
  try {
    if (!state.segments.length) {
      if (!hasGeminiKey()) return;
      await ensureKnowledge();
      setMood('thinking');
      say('발표 대본을 준비하고 있어요', { dots: true });
      state.segments = (await window.api.generateIntro(state.knowledge.pages)).map(normalizeSeg);
      state.segIndex = 0;
      await window.api.saveScript(state.segments);
      showScript();
      setMood('idle');
    }
    runIntro();
  } catch (e) {
    setMood('idle');
    hideBubble();
    status(e.message, { error: true });
  }
}

async function runIntro() {
  state.presenting = true;
  updateButtons();
  let navPending = null;   // 다리 문장에서 미리 시작한 페이지 이동
  while (state.presenting && state.segIndex < state.segments.length) {
    const myIndex = state.segIndex;
    const seg = state.segments[myIndex];
    const next = state.segments[myIndex + 1];
    const lines = linesOf(seg);
    prefetch(segText(seg));
    await (navPending || navigate(seg.path));
    navPending = null;
    if (!state.presenting) break;
    if (next) prefetch(segText(next));   // 다음 구간 음성을 미리 풀어 둔다
    const bridge = lines.findIndex(l => l.bridge);
    await speak(lines.map(l => l.text), {
      onUnit: k => {
        if (lines[k].focus) highlight({ target: lines[k].focus, sentence: lines[k].text });
        // 다리 문장이 시작되면 다음 페이지로 출발
        if (k === bridge && next && next.path !== currentPath() && state.segIndex === myIndex) navPending = navigate(next.path);
      },
      onUnitEnd: k => { if (lines[k].focus && !lines[k + 1]?.focus) clearHighlight(); }
    });
    if (!state.presenting) break;
    if (state.segIndex === myIndex) state.segIndex++;
    if (!navPending) await sleep(150);   // 다리 문장이 없으면 짧게 쉬고 바로 이동
  }
  clearFocus();
  if (state.segIndex >= state.segments.length) {
    state.segIndex = 0;
    say('궁금한 점이 있으면 🎤 버튼을 누르고 질문해 주세요!');
  }
  state.presenting = false;
  updateButtons();
}

function stopIntro() {
  state.presenting = false;
  stopSpeaking();
  updateButtons();
  status('소개를 멈췄어요. ▶ 를 누르면 이어서 합니다.');
}

function nextSegment() {
  if (!state.presenting) return;
  state.segIndex++;
  stopSpeaking();  // 현재 speak()가 끝나면서 루프가 다음 구간으로 넘어간다
}

// ===== 질의응답 =====
async function toggleMic() {
  if (state.recording) return finishRecording();
  if (!hasGeminiKey()) return;
  if (state.presenting) stopIntro();
  stopSpeaking();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.start();
    state.recording = { rec, stream, chunks, timer: setTimeout(finishRecording, 30000) };
    setMood('listening');
    say('듣고 있어요… 다 말했으면 🎤 를 한 번 더 눌러 주세요');
    updateButtons();
  } catch (e) {
    status('마이크를 열 수 없어요: ' + e.message, { error: true });
  }
}

async function finishRecording() {
  const r = state.recording;
  if (!r) return;
  state.recording = null;
  clearTimeout(r.timer);
  const stopped = new Promise(res => (r.rec.onstop = res));
  r.rec.stop();
  await stopped;
  r.stream.getTracks().forEach(t => t.stop());
  updateButtons();
  try {
    const wav = await blobToWavBase64(new Blob(r.chunks, { type: r.rec.mimeType }));
    await ask({ audioBase64: wav });
  } catch (e) {
    setMood('idle');
    say(e.message);
  }
}

// 맞장구: 직전 두 번 쓴 것은 빼고 고른다
function pickFiller(list) {
  const pool = list.filter(t => !state.recentFillers.includes(t));
  const pick = (pool.length ? pool : list)[Math.floor(Math.random() * (pool.length || list.length))];
  if (pick) state.recentFillers = [pick, ...state.recentFillers].slice(0, 2);
  return pick;
}

// 미리 녹음한 맞장구만 재생한다 (질의응답 중 추가 API 호출 없음)
async function playFiller(text, question) {
  say(text, { question });
  const ok = await speak([text], {}, { cachedOnly: true });
  if (!ok) await sleep(600);   // 녹음이 없으면 말풍선만 잠깐
}

// label: 말풍선에 보여 줄 질문 문구 (가리켜서 설명할 때는 긴 원문 대신 짧은 문구)
// pointed: 화면에서 가리킨 부분을 설명하는 경우 → 페이지를 옮기지 않고 그 자리에서 설명
let askToken = 0;
async function ask({ audioBase64, questionText, label, pointed }) {
  await ensureKnowledge();
  stopSpeaking({ keepFocus: pointed });
  const token = ++askToken;
  const shown = label || questionText;
  setMood('thinking');

  const items = state.faq.items || [];
  let result = null;
  const answerP = window.api.answer({
    pages: state.knowledge.pages, history: state.history, audioBase64, questionText,
    faqItems: items.map(({ id, question }) => ({ id, question }))
  }).then(r => ({ r }), e => ({ e }));
  // 예상 질문이면 맞장구가 나오는 동안 미리 그 페이지로 옮긴다
  let navP = Promise.resolve();
  answerP.then(x => {
    result = x;
    const item = x.r?.faqId && items.find(i => i.id === x.r.faqId);
    if (item?.path && !pointed && token === askToken) navP = navigate(item.path);
  });

  // 1) 질문을 보내자마자 맞장구 → 2) 그 뒤 1초가 지나도 답이 없으면 두 번째 맞장구 한 번
  const f1 = pickFiller(state.faq.fillers || []);
  if (f1) await playFiller(f1, shown); else say('…', { dots: true, question: shown });
  if (!result) await Promise.race([answerP, sleep(1000)]);
  if (!result && token === askToken) {
    const f2 = pickFiller(state.faq.fillers2 || []);
    if (f2) await playFiller(f2, shown);
    if (!result) say('…', { dots: true, question: shown });
  }
  const out = await answerP;
  if (token !== askToken) return;
  setMood('idle');
  if (out.e) { hideBubble(); status(out.e.message, { error: true }); return; }

  const r = out.r;
  const q = label || r.question;
  const item = r.faqId && items.find(i => i.id === r.faqId);
  const answer = item ? item.answer : r.answer;
  if (r.question) state.history.push({ question: q, answer });
  if (!pointed) {
    if (item) await navP;
    else if (r.question && r.path && r.path !== currentPath()) await navigate(r.path);
  }
  if (token !== askToken) return;
  const units = splitSentences(answer);
  await speak(units, {
    onUnit: k => {
      if (k !== 0 || pointed) return;
      if (!item) highlight({ sentence: units[0] });
      else if (item.focus) highlight({ target: item.focus, sentence: units[0] });
    }
  });
  if (token !== askToken) return;
  clearFocus();
  say(answer, { question: q });
}

// 녹음(webm/opus)을 16kHz 모노 WAV로 변환 (Gemini가 받는 형식)
async function blobToWavBase64(blob) {
  const decoded = await ctx().decodeAudioData(await blob.arrayBuffer());
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  if (peak < 0.002) {
    throw new Error('마이크에서 소리가 전혀 들어오지 않아요. 키보드의 마이크 끄기 키나 Windows 설정 > 시스템 > 소리 > 입력 음량을 확인해 주세요.');
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ===== 버튼 / 단축키 =====
function updateButtons() {
  const seg = state.segments.length;
  $('btn-intro').textContent = state.presenting ? '■ 멈춤'
    : seg && state.segIndex > 0 ? `▶ 이어서 (${state.segIndex + 1}/${seg})` : '▶ 소개 시작';
  $('btn-next').disabled = !state.presenting;
  $('btn-mic').classList.toggle('recording', !!state.recording);
  $('btn-mic').textContent = state.recording ? '⏺ 질문 보내기' : '🎤 질문하기';
}

function toggleFollow() {
  state.follow = !state.follow;
  $('btn-follow').classList.toggle('on', state.follow);
}

function handleKey(key) {
  if (key === 'F1') toggleIntro();
  else if (key === 'F2') toggleMic();
  else if (key === 'F3') toggleFollow();
  else if (key === 'F4') setExplainMode(!state.explainMode);
  else if (key === 'Escape') {
    if (!$('settings').classList.contains('hidden')) return closeSettings();
    if (state.presenting) stopIntro(); else { askToken++; stopSpeaking(); hideBubble(); setMood('idle'); }
  }
}
window.addEventListener('keydown', e => {
  if (['F1', 'F2', 'F3', 'F4', 'Escape'].includes(e.key)) { e.preventDefault(); handleKey(e.key); }
});

$('btn-intro').onclick = toggleIntro;
$('btn-next').onclick = nextSegment;
$('btn-mic').onclick = toggleMic;
$('btn-follow').onclick = toggleFollow;
$('btn-explain').onclick = () => setExplainMode(!state.explainMode);
$('ask-form').onsubmit = e => {
  e.preventDefault();
  const q = $('ask-input').value.trim();
  if (!q || !hasGeminiKey()) return;
  $('ask-input').value = '';
  if (state.presenting) stopIntro();
  ask({ questionText: q });
};

// ===== 대본 (저장·편집) =====
// 편집 형식: [번호] /경로, 한 줄에 한 문장, "★ 강조: 글자"는 바로 위 문장의 강조 대상, "» 문장"은 다리 문장
function showScript() {
  $('script-view').value = state.segments.map((s, i) => {
    const body = linesOf(s).map(l => (l.bridge ? '» ' : '') + l.text + (l.focus ? `\n★ 강조: ${l.focus}` : '')).join('\n');
    return `[${i + 1}] ${s.path}\n${body}`;
  }).join('\n\n');
}

function parseScript(text) {
  const segs = [];
  for (const block of text.split(/^\[\d+\]/m).slice(1)) {
    const rows = block.split('\n');
    const path = rows.shift().trim();
    const lines = [];
    for (const raw of rows) {
      const row = raw.trim();
      if (!row) continue;
      const star = row.match(/^★\s*강조\s*[:：]\s*(.+)$/);
      if (star) { if (lines.length) lines[lines.length - 1].focus = star[1].trim(); continue; }
      const bridge = row.startsWith('»');
      lines.push({ text: row.replace(/^»\s*/, ''), ...(bridge ? { bridge: true } : {}) });
    }
    if (lines.length) segs.push(normalizeSeg({ path: path.startsWith('/') ? path : '/', lines }));
  }
  return segs;
}

$('btn-savescript').onclick = async () => {
  const segs = parseScript($('script-view').value);
  if (!segs.length) return status('대본 형식을 확인해 주세요. 각 구간은 "[번호] /경로" 줄로 시작해야 해요.', { error: true });
  if (state.presenting) stopIntro();
  state.segments = segs;
  state.segIndex = 0;
  await window.api.saveScript(segs);
  updateButtons();
  status(`대본 ${segs.length}구간을 저장했어요.`);
};

// ===== 맞장구 · 예상 질문 (저장·편집) =====
function showFaq() {
  const f = state.faq;
  const items = (f.items || []).map((it, i) =>
    `[${i + 1}] ${it.path || ''}\nQ: ${it.question}\nA: ${it.answer}${it.focus ? `\n★ 강조: ${it.focus}` : ''}`).join('\n\n');
  $('faq-view').value = `# 맞장구\n${(f.fillers || []).join('\n')}\n\n# 두 번째 맞장구\n${(f.fillers2 || []).join('\n')}\n\n# 예상 질문\n${items}`;
}

function parseFaq(text) {
  const faq = { fillers: [], fillers2: [], items: [] };
  let section = null, item = null;
  for (const raw of text.split('\n')) {
    const row = raw.trim();
    if (!row) continue;
    if (/^#\s*두 번째 맞장구/.test(row)) { section = 'fillers2'; continue; }
    if (/^#\s*맞장구/.test(row)) { section = 'fillers'; continue; }
    if (/^#\s*예상 질문/.test(row)) { section = 'items'; continue; }
    if (section === 'fillers' || section === 'fillers2') { faq[section].push(row); continue; }
    if (section !== 'items') continue;
    const head = row.match(/^\[(\d+)\]\s*(\S*)/);
    // 경로를 비워 두면 페이지를 옮기지 않고 그 자리에서 답한다
    if (head) { item = { id: 'q' + head[1], path: head[2].startsWith('/') ? head[2] : '', question: '', answer: '' }; faq.items.push(item); continue; }
    if (!item) continue;
    const m = row.match(/^(Q|A|★\s*강조)\s*[:：]\s*(.*)$/);
    if (m?.[1] === 'Q') item.question = m[2].trim();
    else if (m?.[1] === 'A') item.answer = m[2].trim();
    else if (m) item.focus = m[2].trim();
    else if (item.answer) item.answer += ' ' + row;   // 답변이 여러 줄이면 이어 붙인다
  }
  faq.items = faq.items.filter(i => i.question && i.answer);
  return faq;
}

$('btn-savefaq').onclick = async () => {
  state.faq = parseFaq($('faq-view').value);
  await window.api.saveFaq(state.faq);
  showFaq();
  status(`맞장구 ${state.faq.fillers.length + state.faq.fillers2.length}개, 예상 질문 ${state.faq.items.length}개를 저장했어요.`);
};

// ===== 미리 녹음 =====
// 소개 대본·맞장구·예상 답변의 음성을 미리 만들어 저장한다. 한도에 걸리면 기다렸다가 다시 시도.
let preparing = false;
function voiceTexts() {
  return [
    ...state.segments.map(segText),
    ...(state.faq.fillers || []),
    ...(state.faq.fillers2 || []),
    ...(state.faq.items || []).map(i => i.answer)
  ];
}
async function prepareVoices() {
  if (preparing) return;
  if (state.cfg.ttsProvider === 'gemini' && !hasGeminiKey()) return;
  const texts = voiceTexts();
  if (!texts.length) return status('먼저 소개 대본을 만들어 주세요.', { error: true });
  preparing = true;
  let done = 0, failed = 0;
  try {
    for (const [i, text] of texts.entries()) {
      if (await window.api.ttsCached(text)) { done++; continue; }
      for (let attempt = 0; ; attempt++) {
        status(`음성 만드는 중… ${i + 1}/${texts.length}${attempt ? ` (한도 대기 후 재시도 ${attempt})` : ''}`, { sticky: true });
        try { await window.api.tts(text); done++; break; } catch (e) {
          if (attempt >= 3 || !/429|붐빕|시간 초과/.test(e.message)) { failed++; status(e.message, { error: true }); await sleep(1500); break; }
          await sleep(30000);
        }
      }
    }
  } finally {
    preparing = false;
  }
  state.cloudOff = false;
  bufferCache.clear();
  status(failed
    ? `음성 ${done}/${texts.length}개 준비됨. ${failed}개는 실패했어요. 잠시 후 다시 눌러 주세요.`
    : `음성 ${done}개(소개·맞장구·예상 답변)를 모두 저장했어요. 이제 리허설·발표 때 한도를 쓰지 않아요.`, { error: !!failed, sticky: !!failed });
}
$('btn-voices').onclick = () => { closeSettings(); prepareVoices(); };

// ===== 설정 =====
const FIELDS = ['apiKey', 'portfolioUrl', 'lang', 'introMinutes', 'ttsMode', 'ttsProvider', 'geminiVoice', 'systemVoice',
  'elevenKey', 'elevenVoiceId', 'elevenModel', 'model', 'ttsModel', 'persona'];

function fillVoices() {
  const sel = $('cfg-systemVoice');
  const voices = speechSynthesis.getVoices();
  sel.innerHTML = '<option value="">(언어에 맞게 자동 선택)</option>' +
    voices.map(v => `<option value="${v.name.replace(/"/g, '&quot;')}">${v.name} — ${v.lang}</option>`).join('');
  sel.value = state.cfg?.systemVoice || '';
}
speechSynthesis.onvoiceschanged = fillVoices;

let elevenVoiceList = null;
function fillElevenVoices() {
  const sel = $('cfg-elevenVoiceId');
  const cur = state.cfg.elevenVoiceId;
  const list = elevenVoiceList || [];
  // 라이브러리에서 추가한 목소리(premade가 아닌 것)는 무료 플랜에서 API로 쓸 수 없다 (402)
  const opt = v => `<option value="${v.id}">${v.category !== 'premade' ? '🔒 ' : ''}${v.name}${v.labels.gender ? ` · ${v.labels.gender}` : ''}${v.labels.age ? ` · ${v.labels.age}` : ''}${v.labels.accent ? ` · ${v.labels.accent}` : ''}${v.category !== 'premade' ? ' (무료 플랜 불가)' : ''}</option>`;
  sel.innerHTML = '<option value="">(고르세요)</option>' + list.map(opt).join('') +
    (cur && !list.some(v => v.id === cur) ? `<option value="${cur}">${cur}</option>` : '');
  sel.value = cur || '';
}

async function loadElevenVoices() {
  try {
    elevenVoiceList = await window.api.elevenVoices();
    fillElevenVoices();
    const s = await window.api.elevenSubscription().catch(() => null);
    $('eleven-info').textContent = `목소리 ${elevenVoiceList.length}개` +
      (s ? ` · 플랜 ${s.tier} · 이번 달 ${s.used.toLocaleString()} / ${s.limit.toLocaleString()}자 사용` : '');
  } catch (e) {
    // 권한이 빠진 키 등: 작은 글씨만으로는 눈에 안 띄어서 상태 표시줄에도 크게 띄운다
    const msg = /voices_read/.test(e.message)
      ? 'ElevenLabs 키에 "Voices 읽기" 권한이 없어요. elevenlabs.io › API Keys에서 키 권한에 Voices(Read)와 User(Read)를 켜 주세요.'
      : e.message;
    $('eleven-info').textContent = msg;
    status(msg, { error: true, sticky: true });
  }
}

function openSettings() {
  for (const f of FIELDS) $('cfg-' + f).value = state.cfg[f] ?? '';
  fillVoices();
  fillElevenVoices();
  if (state.cfg.hasElevenKey && !elevenVoiceList) loadElevenVoices();
  updateSiteInfo();
  showScript();
  showFaq();
  $('settings').classList.remove('hidden');
}
function closeSettings() { $('settings').classList.add('hidden'); }

async function saveSettings() {
  const patch = {};
  for (const f of FIELDS) patch[f] = $('cfg-' + f).value.trim();
  patch.introMinutes = Number(patch.introMinutes) || 4;
  const urlChanged = patch.portfolioUrl !== state.cfg.portfolioUrl;
  const scriptChanged = urlChanged || ['lang'].some(f => String(patch[f]) !== String(state.cfg[f]));
  state.cfg = await window.api.saveConfig(patch);
  state.cloudOff = false;
  bufferCache.clear();
  if (scriptChanged) { state.segments = (await window.api.getScript()).map(normalizeSeg); state.segIndex = 0; showScript(); updateButtons(); }
  if (urlChanged) { state.knowledge = null; site.loadURL(state.cfg.portfolioUrl); }
  return state.cfg;
}

$('btn-settings').onclick = openSettings;
$('btn-cancel').onclick = closeSettings;
$('btn-save').onclick = async () => { await saveSettings(); closeSettings(); status('저장했어요.'); };
$('btn-eleven-voices').onclick = async () => { await saveSettings(); loadElevenVoices(); };
$('btn-test').onclick = async () => {
  await saveSettings();
  status('연결 확인 중…', { sticky: true });
  try {
    const r = await window.api.testAi();
    status(`연결 성공! 모델: ${r.model} · 응답: ${r.reply}`);
  } catch (e) { status(e.message, { error: true }); }
};
$('btn-voice-test').onclick = async () => {
  await saveSettings();
  const line = { ko: '안녕하세요, Ling이에요. 오늘 제 포트폴리오를 소개해 드릴게요.', zh: '大家好，我是Ling，今天给大家介绍我的作品集。', en: "Hi, I'm Ling. Let me walk you through my portfolio." }[state.cfg.lang];
  clearStatus();
  speak([line], {}, { noFallback: true });
};
$('btn-recrawl').onclick = async () => {
  await saveSettings();
  closeSettings();
  try {
    await ensureKnowledge(true);
    say(`포트폴리오 ${state.knowledge.pages.length}페이지를 새로 읽었어요!`);
  } catch (e) { status(e.message, { error: true }); }
};
$('btn-newscript').onclick = async () => {
  await saveSettings();
  closeSettings();
  stopIntro();
  state.segments = []; state.segIndex = 0;
  toggleIntro();
};

// ===== 시작 =====
(async () => {
  state.cfg = await window.api.getConfig();
  site.setAttribute('preload', await window.api.webviewPreloadUrl());
  site.src = state.cfg.portfolioUrl;
  state.segments = (await window.api.getScript()).map(normalizeSeg);
  state.faq = await window.api.getFaq();
  updateButtons();
  say('안녕하세요! ▶ 소개 시작을 누르면 발표를 시작할게요.');
  setTimeout(() => { if (!state.presenting) hideBubble(); }, 6000);
  if (!state.cfg.hasKey) setTimeout(() => { status('질의응답을 하려면 ⚙ 설정에서 Gemini API 키를 입력해 주세요.', { sticky: true }); }, 1500);
  // 사이트 내용은 미리 읽어 둔다 (캐시가 있으면 바로 끝남)
  ensureKnowledge().then(() => { if (!state.presenting) hideBubble(); }).catch(e => status(e.message, { error: true }));
})();
