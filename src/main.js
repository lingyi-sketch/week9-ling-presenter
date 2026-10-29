const { app, BrowserWindow, ipcMain, session, systemPreferences, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { crawlSite } = require('./crawler');
const gemini = require('./gemini');
const eleven = require('./elevenlabs');

const DEFAULTS = {
  apiKey: '',
  portfolioUrl: 'https://my-new-portfolio-ling-d2f5.vercel.app/',
  model: 'gemini-3.5-flash',
  ttsModel: 'gemini-3.8-flash-tts',
  ttsMode: 'auto',            // auto(클라우드 음성 → 실패 시 OS 음성) | cloud | system
  ttsProvider: 'gemini',      // gemini | elevenlabs
  geminiVoice: 'Leda',
  elevenKey: '',
  elevenVoiceId: '',
  elevenModel: 'eleven_multilingual_v2',
  systemVoice: '',
  lang: 'ko',                 // ko | zh | en
  introMinutes: 5,
  persona: '밝고 친근하지만 차분한 말투를 쓴다. 영화와 이야기를 좋아하는 창작자답게 따뜻하고 생생한 표현을 쓴다. [나의 배경 — 참고용, 사이트 내용과 다르면 사이트를 따른다] 학부에서 영상을 전공했고 지금은 성균관대학교 영상학과 대학원생이다. 공부하면서 영상 자체보다 이야기 자체에 관심을 갖게 되었다. 같은 이야기도 매체가 달라지면 관객 경험이 달라진다는 점에서 트랜스미디어 스토리텔링을 공부했다. 선택에 따라 이야기가 바뀌는 작품을 경험하며 "누가 이야기를 통제하는가"를 고민하게 되었고, 비주얼 노벨과 인터랙티브 서사, 관객이 작품에 개입하는 인터랙티브 아트에도 관심이 있다. 요즘은 생성형 AI를 활용한 시나리오 창작과 저자성(사람과 AI가 함께 만든 이야기의 저자는 누구인가)을 공부하고 있다. 내 모든 관심을 잇는 질문은 "우리는 이야기를 어떻게 표현할 수 있을까?"이다.'
};

// 앱과 함께 배포하는 대본·음성 (npm run preset 으로 만든다)
const PRESET_DIR = path.join(__dirname, '..', 'preset');
const ttsKey = (model, voice, text) => crypto.createHash('sha1').update(`${model}|${voice}|${text}`).digest('hex');
// 지금 설정된 목소리로 만든 음성 파일 이름 (서비스·모델·목소리·문장이 같으면 같은 파일)
function ttsName(c, text) {
  return c.ttsProvider === 'elevenlabs'
    ? 'el-' + ttsKey(c.elevenModel, c.elevenVoiceId, text) + '.mp3'
    : ttsKey(c.ttsModel, c.geminiVoice, text) + '.wav';
}

const configPath = () => path.join(app.getPath('userData'), 'config.json');
const knowledgePath = () => path.join(app.getPath('userData'), 'knowledge.json');
const scriptPath = () => path.join(app.getPath('userData'), 'script.json');
const faqPath = () => path.join(app.getPath('userData'), 'faq.json');

// .env 파일(GEMINI_API_KEY=..., ELEVENLABS_API_KEY=...)을 개발 폴더 또는 실행 파일 옆에서 찾는다
function readEnvKey(name = 'GEMINI_API_KEY') {
  if (process.env[name]) return process.env[name].trim();
  const dirs = [
    path.join(__dirname, '..'),
    process.env.PORTABLE_EXECUTABLE_DIR,
    path.dirname(process.execPath),
    process.cwd()
  ].filter(Boolean);
  for (const dir of dirs) {
    const file = path.join(dir, '.env');
    if (!fs.existsSync(file)) continue;
    const m = fs.readFileSync(file, 'utf8').match(new RegExp(`^\\s*${name}\\s*=\\s*["']?([^"'\\r\\n]+)`, 'm'));
    if (m) return m[1].trim();
  }
  return '';
}

function loadConfig() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(configPath(), 'utf8').replace(/^﻿/, '')); } catch {}
  // 앱에 함께 들어 있는 음성(preset)과 같은 목소리를 기본값으로 쓴다
  let presetVoice = {};
  try { presetVoice = JSON.parse(fs.readFileSync(path.join(PRESET_DIR, 'voice.json'), 'utf8')); } catch {}
  const cfg = { ...DEFAULTS, ...presetVoice, ...saved };
  if (!cfg.apiKey) cfg.apiKey = readEnvKey();
  if (!cfg.elevenKey) cfg.elevenKey = readEnvKey('ELEVENLABS_API_KEY');
  return cfg;
}

function saveConfig(patch) {
  const cfg = { ...loadConfig(), ...patch };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
  return cfg;
}

function loadKnowledge(url) {
  try {
    const k = JSON.parse(fs.readFileSync(knowledgePath(), 'utf8'));
    if (k.url === url && k.pages?.length) return k;
  } catch {}
  return null;
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Ling AI Presenter',
    backgroundColor: '#111111',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 포트폴리오 안의 외부 링크(새 창)는 기본 브라우저로 연다
  mainWindow.webContents.on('did-attach-webview', (_e, wc) => {
    wc.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
  });
}

app.whenReady().then(async () => {
  // 질문 녹음을 위해 마이크 권한 허용
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'audioCapture', 'microphone'].includes(permission));
  });
  if (process.platform === 'darwin') {
    try { await systemPreferences.askForMediaAccess('microphone'); } catch {}
  }

  ipcMain.handle('config:get', () => {
    const cfg = loadConfig();
    return { ...cfg, hasKey: !!cfg.apiKey, hasElevenKey: !!cfg.elevenKey };
  });
  ipcMain.handle('config:save', (_e, patch) => {
    const cfg = saveConfig(patch);
    return { ...cfg, hasKey: !!cfg.apiKey, hasElevenKey: !!cfg.elevenKey };
  });
  ipcMain.handle('paths:webviewPreload', () =>
    pathToFileURL(path.join(__dirname, 'webview-preload.js')).toString());

  ipcMain.handle('site:knowledge', async (e, { refresh }) => {
    const { portfolioUrl } = loadConfig();
    if (!refresh) {
      const cached = loadKnowledge(portfolioUrl);
      if (cached) return cached;
    }
    const pages = await crawlSite(portfolioUrl, p => e.sender.send('site:progress', p));
    const k = { url: portfolioUrl, crawledAt: new Date().toISOString(), pages };
    fs.mkdirSync(path.dirname(knowledgePath()), { recursive: true });
    fs.writeFileSync(knowledgePath(), JSON.stringify(k, null, 2));
    return k;
  });

  // 소개 대본은 저장해 두고, '새로 만들기'를 누르기 전까지 같은 대본을 쓴다
  // 내가 저장한 대본이 없으면 앱에 함께 들어 있는 대본(preset/script.json)을 쓴다
  ipcMain.handle('script:get', () => {
    const { portfolioUrl, lang } = loadConfig();
    for (const file of [scriptPath(), path.join(PRESET_DIR, 'script.json')]) {
      try {
        const s = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (s.url === portfolioUrl && s.lang === lang && s.segments?.length) return s.segments;
      } catch {}
    }
    return [];
  });
  ipcMain.handle('script:save', (_e, segments) => {
    const { portfolioUrl, lang } = loadConfig();
    fs.mkdirSync(path.dirname(scriptPath()), { recursive: true });
    fs.writeFileSync(scriptPath(), JSON.stringify({ url: portfolioUrl, lang, savedAt: new Date().toISOString(), segments }, null, 2));
    return true;
  });

  // 예상 질문·맞장구 (내 PC에 저장한 것 → 없으면 앱에 들어 있는 preset/faq.json)
  ipcMain.handle('faq:get', () => {
    for (const file of [faqPath(), path.join(PRESET_DIR, 'faq.json')]) {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    }
    return { fillers: [], fillers2: [], items: [] };
  });
  ipcMain.handle('faq:save', (_e, faq) => {
    fs.mkdirSync(path.dirname(faqPath()), { recursive: true });
    fs.writeFileSync(faqPath(), JSON.stringify(faq, null, 2));
    return true;
  });

  ipcMain.handle('eleven:voices', () => eleven.listVoices(loadConfig().elevenKey));
  ipcMain.handle('eleven:subscription', () => eleven.subscription(loadConfig().elevenKey));

  ipcMain.handle('ai:test', () => {
    const { apiKey, model } = loadConfig();
    return gemini.testConnection({ apiKey, model });
  });

  ipcMain.handle('ai:intro', (_e, { pages }) => {
    const c = loadConfig();
    return gemini.generateIntro({
      apiKey: c.apiKey, model: c.model, pages, lang: c.lang,
      minutes: Number(c.introMinutes) || 4, persona: c.persona
    });
  });

  ipcMain.handle('ai:answer', (_e, { pages, history, audioBase64, questionText, faqItems }) => {
    const c = loadConfig();
    return gemini.answerQuestion({
      apiKey: c.apiKey, model: c.model, pages, lang: c.lang, persona: c.persona,
      history: history || [], audioBase64, questionText, faqItems: faqItems || []
    });
  });

  // 한 번 만든 음성은 파일로 저장해 두고 다시 쓴다 (리허설·발표 때 무료 한도를 쓰지 않음)
  // 앱에 함께 들어 있는 음성(preset/tts)도 찾아본다 → 다른 사람이 받아도 같은 목소리로 발표
  const ttsFile = text => {
    const c = loadConfig();
    const name = ttsName(c, text);
    const mine = path.join(app.getPath('userData'), 'tts', name);
    const bundled = path.join(PRESET_DIR, 'tts', name);
    return { mine, found: [mine, bundled].find(f => fs.existsSync(f)) };
  };
  ipcMain.handle('ai:ttsCached', (_e, { text }) => {
    const { found } = ttsFile(text);
    return found ? fs.readFileSync(found).toString('base64') : null;
  });
  ipcMain.handle('ai:tts', async (_e, { text }) => {
    const { mine: f, found } = ttsFile(text);
    if (found) return fs.readFileSync(found).toString('base64');
    const c = loadConfig();
    const audio = c.ttsProvider === 'elevenlabs'
      ? await eleven.synthesize({ apiKey: c.elevenKey, voiceId: c.elevenVoiceId, model: c.elevenModel, text })
      : await gemini.synthesize({ apiKey: c.apiKey, ttsModel: c.ttsModel, voice: c.geminiVoice, text, lang: c.lang });
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.from(audio, 'base64'));
    return audio;
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
