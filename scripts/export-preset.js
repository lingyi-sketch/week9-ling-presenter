// 지금 PC에 저장된 소개 대본·맞장구·예상 질문과 미리 만든 음성을 preset/ 폴더로 복사한다.
// preset/ 은 앱에 함께 포함되므로, 다른 사람이 앱을 받아도 같은 대본·같은 목소리로 발표한다.
// 사용법: npm run preset
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const appData = process.env.APPDATA
  || (process.platform === 'darwin'
    ? path.join(process.env.HOME, 'Library', 'Application Support')
    : path.join(process.env.HOME, '.config'));
const userData = path.join(appData, 'Ling AI Presenter');
const out = path.join(__dirname, '..', 'preset');
const read = file => JSON.parse(fs.readFileSync(path.join(userData, file), 'utf8').replace(/^﻿/, ''));

const config = { ttsProvider: 'gemini', elevenModel: 'eleven_multilingual_v2', ...read('config.json') };
const script = read('script.json');
let faq = null;
try { faq = read('faq.json'); } catch {}

// src/main.js 의 ttsName 과 같은 규칙
const key = (a, b, text) => crypto.createHash('sha1').update(`${a}|${b}|${text}`).digest('hex');
const ttsName = text => config.ttsProvider === 'elevenlabs'
  ? 'el-' + key(config.elevenModel, config.elevenVoiceId, text) + '.mp3'
  : key(config.ttsModel, config.geminiVoice, text) + '.wav';
const segText = seg => seg.lines?.length ? seg.lines.map(l => l.text).join(' ') : seg.text;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'tts'), { recursive: true });
fs.writeFileSync(path.join(out, 'script.json'), JSON.stringify(script, null, 2));
if (faq) fs.writeFileSync(path.join(out, 'faq.json'), JSON.stringify(faq, null, 2));
// 음성 파일 이름은 목소리 설정으로 정해지므로, 받은 사람의 기본 설정도 같은 목소리가 되도록 함께 넣는다 (키는 넣지 않음)
const voice = {};
for (const k of ['ttsProvider', 'elevenVoiceId', 'elevenModel', 'ttsModel', 'geminiVoice']) voice[k] = config[k];
fs.writeFileSync(path.join(out, 'voice.json'), JSON.stringify(voice, null, 2));

const texts = [
  ...script.segments.map(s => ['대본', segText(s)]),
  ...(faq?.fillers || []).map(t => ['맞장구', t]),
  ...(faq?.fillers2 || []).map(t => ['두 번째 맞장구', t]),
  ...(faq?.items || []).map(i => ['예상 답변', i.answer])
];
let copied = 0;
const missing = [];
for (const [kind, text] of texts) {
  const name = ttsName(text);
  const src = path.join(userData, 'tts', name);
  if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(out, 'tts', name)); copied++; }
  else missing.push(`${kind}: ${text.slice(0, 20)}…`);
}

console.log(`대본 ${script.segments.length}구간, 예상 질문 ${faq?.items?.length || 0}개, 음성 ${copied}/${texts.length}개를 preset/ 에 저장했습니다.`);
if (missing.length) console.log(`음성이 아직 없는 것:\n  ${missing.join('\n  ')}\n→ 앱 설정에서 「발표 음성 미리 만들기」를 먼저 눌러 주세요.`);
