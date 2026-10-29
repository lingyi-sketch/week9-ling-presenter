// Google Gemini REST API 호출 모음 (텍스트 생성, 음성 질문 답변, TTS)
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function callApi(apiKey, path, body, method = 'POST', timeoutMs = 60000) {
  if (!apiKey) throw new GeminiError('Gemini API 키가 없습니다. 설정(⚙)에서 키를 입력해 주세요.', 401);
  let res;
  try {
    res = await fetch(`${API_BASE}/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
    throw new GeminiError(timedOut ? 'Gemini 응답이 너무 늦습니다(시간 초과).' : '인터넷 연결을 확인해 주세요. ' + e.message, 0);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || text.slice(0, 300);
    throw new GeminiError(friendlyError(res.status, msg), res.status);
  }
  return data;
}

function friendlyError(status, msg) {
  if (status === 400 && /API key/i.test(msg)) return 'API 키가 올바르지 않습니다. 설정에서 키를 다시 확인해 주세요.';
  if (status === 403) return 'API 키 권한이 없습니다(403). 키를 다시 발급해 보세요. ' + msg;
  if (status === 429) return '무료 사용량 한도에 걸렸습니다(429). 잠시 후 다시 시도해 주세요.';
  if (status === 503) return 'Gemini 서버가 지금 붐빕니다(503). 잠시 후 다시 시도해 주세요.';
  return `Gemini 오류(${status}): ${msg}`;
}

// 모델이 없어졌거나(404) 붐비거나(503) 한도(429)·시간 초과면 다른 모델로 넘어간다
const RETRYABLE = new Set([0, 404, 429, 500, 503, 504]);
const workingModel = new Map();   // kind별로 마지막에 성공한 모델을 기억
let modelListCache = null;

async function fallbackModels(apiKey, kind) {
  if (!modelListCache) {
    const list = await callApi(apiKey, 'models?pageSize=200', null, 'GET', 20000);
    modelListCache = (list.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''));
  }
  const version = n => Number((n.match(/(\d+(?:\.\d+)?)/) || [])[1]) || 0;
  const pool = modelListCache
    .filter(n => kind === 'tts' ? n.includes('tts') : /^gemini-[\d.]+-flash(-lite)?$/.test(n))
    .sort((a, b) => version(b) - version(a));
  // lite 모델은 맨 뒤로
  return [...pool.filter(n => !n.includes('lite')), ...pool.filter(n => n.includes('lite'))];
}

async function generate(apiKey, model, body, kind = 'text', timeoutMs = 60000) {
  const started = Date.now();
  const budget = timeoutMs * 2.5;   // 전체 재시도에 쓰는 최대 시간
  const first = workingModel.get(`${kind}:${model}`) || model;
  let order = [first];
  let lastError;
  // 붐빔(503)은 보통 잠깐이므로, 모델을 바꿔 가며 최대 3바퀴 시도한다
  for (let round = 0; round < 3; round++) {
    if (round > 0) await new Promise(r => setTimeout(r, 2500 * round));
    for (const m of order) {
      const left = budget - (Date.now() - started);
      if (left < 5000) throw lastError;
      try {
        const data = await callApi(apiKey, `models/${m}:generateContent`, body, 'POST', Math.min(timeoutMs, left));
        workingModel.set(`${kind}:${model}`, m);
        return { data, model: m };
      } catch (e) {
        lastError = e;
        // 일부 모델은 thinkingConfig를 지원하지 않아 400을 준다 → 설정을 빼고 같은 모델로 다시
        if (e.status === 400 && body.generationConfig?.thinkingConfig) {
          delete body.generationConfig.thinkingConfig;
          try {
            const data = await callApi(apiKey, `models/${m}:generateContent`, body, 'POST', Math.min(timeoutMs, left));
            workingModel.set(`${kind}:${model}`, m);
            return { data, model: m };
          } catch (e2) {
            lastError = e2;
            if (!RETRYABLE.has(e2.status)) throw e2;
            continue;
          }
        }
        if (!RETRYABLE.has(e.status)) throw e;
      }
    }
    if (round === 0) {
      try {
        const extra = (await fallbackModels(apiKey, kind)).filter(n => n !== first);
        order = [first, ...extra].slice(0, 6);
      } catch {}
    }
  }
  throw lastError;
}

function textOf(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || '').join('');
  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || '알 수 없음';
    throw new GeminiError(`Gemini가 빈 응답을 보냈습니다 (${reason}).`, 500);
  }
  return text;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new GeminiError('Gemini 응답을 해석하지 못했습니다.', 500);
  }
}

const LANG_NAME = { ko: '한국어', zh: '중국어(简体中文)', en: '영어' };

// 페이지 종류를 붙여서, 내 작품(/script 등)과 수업 과제 결과물(/assignments)을 LLM이 섞지 않게 한다
function pageKind(path) {
  if (path === '/') return '프로필 (나에 대한 소개)';
  if (path === '/script') return '나의 창작 대본 작품 목록 (내가 직접 쓴 작품)';
  if (path === '/video') return '나의 영상 작품 목록 (내가 직접 만든 작품)';
  if (path === '/game') return '나의 게임 작품 (내가 직접 만드는 작품)';
  if (path === '/assignments') return '수업 주차별 과제 목록';
  if (path.startsWith('/assignments/')) return '수업 과제 상세 (과제로 수행한 실습 기록·결과물. 나의 창작 작품과 별개)';
  return '기타 페이지';
}

function knowledgeBlock(pages) {
  return pages.map(p => `### 페이지: ${p.path}\n종류: ${pageKind(p.path)}\n${p.text}`).join('\n\n');
}

// (결정: .scratch/naturalness/issues/03-script-style.md — AI 아바타라고 밝히지 않고 처음부터 Ling 본인으로 말한다)
const IDENTITY = `너는 포트폴리오 주인 Ling 본인이다. 교실에서 청중에게 직접 말하듯 1인칭("저", "제가 쓴 대본", "제 과제")으로 말한다.
"AI 아바타", "대신 발표" 같은 말은 하지 않고, Ling을 3인칭으로 부르지 않는다.`;

// 글이 아니라 말로 들리게 하는 규칙 (예시를 함께 주지 않으면 다시 보고서 말투로 돌아간다)
// (결정: .scratch/naturalness/issues/03-script-style.md — 리허설 후 "짧은 문장만 이어지면 딱딱하다"는 판단으로 수정됨)
const SPEECH_RULES = `- 해요체와 습니다체를 섞는다. 사실·작품 소개는 습니다("…를 만들었습니다"), 느낌·개인 경험은 요("…가 제일 어려웠어요"). 비율은 대략 반반이고, 같은 어미가 세 번 넘게 이어지지 않게 한다.
  "~노력했습니다", "~경험하곤 합니다" 같은 보고서 어미는 쓰지 않는다.
- 대부분의 문장은 40~80자로, "-고, -는데, -서, -다 보니"로 생각 두 개를 한 문장에 잇는다. 긴 문장 두세 개마다 20자 안팎의 짧은 문장을 하나 넣어 리듬을 만든다.
- 작품을 한 문장에 셋 이상 나열하지 않는다. 대표작 하나를 골라 깊게 말하고, 나머지는 이름만 짧게 언급한다.
- "생생한 숨결", "깊은 몰입" 같은 추상적인 꾸밈말 대신, 무엇을 했고 무엇이 어려웠는지 구체적으로 말한다.
- "사실", "근데" 같은 연결어는 구간마다 많아야 한 번. "음", "어"는 쓰지 않는다.
- 예) 나쁨: "다양한 장르의 시나리오를 통해 인간의 내면을 깊이 탐구했습니다."
      좋음: "대본은 모두 여덟 편을 올려 두었는데, 오늘은 그중에서 한 편만 골라서 이야기해 볼게요. 진회영이라는 작품입니다."`;

const SOURCE_RULES = `- 나의 창작 작품(/script, /video, /game 페이지)과 수업 과제(/assignments 페이지)를 절대 섞지 않는다.
  과제 상세 페이지에 나오는 시나리오·대본은 "과제에서 스킬/프롬프트로 생성해 본 결과물"이지 나의 대본 작품 목록이 아니다.
  대본 작품을 소개할 때는 /script 페이지에 있는 작품만, 과제를 소개할 때는 해당 과제 페이지의 내용만 쓴다.
- 중국어 등 외국어 제목은 소리 나는 대로 음역하지 말고, 한국어 뜻으로 옮겨 따옴표로 말한다.`;

// 1) 포트폴리오 소개 대본: 페이지별 구간으로 나눠 자연스러운 대화체로 각색
async function generateIntro({ apiKey, model, pages, lang, minutes, persona }) {
  const chars = Math.round(minutes * (lang === 'en' ? 750 : 330));
  // 과제 상세 페이지를 주차 순으로 정렬해 소개 순서를 명시한다 (LLM에게 맡기면 순서가 뒤섞임)
  const weekOf = p => Number((p.text.match(/(\d+)\s*주차/) || [])[1]) || 99;
  const assignmentOrder = pages
    .filter(p => p.path.startsWith('/assignments/') && weekOf(p) < 99)
    .sort((a, b) => weekOf(a) - weekOf(b))
    .map(p => `   - ${weekOf(p)}주차: ${p.path} (${p.text.replace(/^←\s*전체 과제\s*/, '').split('\n').filter(Boolean).slice(0, 2).join(' / ').slice(0, 60)})`)
    .join('\n');

  const prompt = `${IDENTITY}
${persona}

아래는 내 포트폴리오 웹사이트에서 수집한 내용이다. 이것을 바탕으로 발표 대본을 써라.

순서 (반드시 이 순서대로):
1) 첫 구간: path "/" 에서 인사와 자기소개만 한다 (작품 이야기는 다음 구간부터).
2) 나의 창작 작품: 대본(/script) → 영상(/video) → 게임(/game), 각각 한 구간씩.
3) 수업 주차별 과제: 아래 목록 순서(낮은 주차 → 높은 주차)대로, 과제마다 한 구간씩 해당 상세 페이지 path로 소개한다.
   같은 주차의 과제가 여러 개면 한 구간으로 묶어도 된다.
${assignmentOrder}
4) 마지막 구간: path "/" 에서 마무리와 질문 안내.

규칙:
- 사이트 문장을 그대로 읽지 말고, 핵심을 재구성해 사람이 청중 앞에서 말하듯 말한다.
${SPEECH_RULES}
- 청중에게 던지는 질문은 구간마다 많아야 한 번.
- 주차별 과제는 무엇을 했는지, 어떤 프롬프트/방법을 썼는지, 결과가 어땠는지를 짧게 짚는다.
- 사이트에 없는 사실은 지어내지 않는다.
${SOURCE_RULES}
- 각 구간은 문장 배열(sentences)로 쓴다. 마지막 구간을 뺀 모든 구간의 끝에는 다음 페이지로 넘어가는 짧은 다리 문장(bridge, 20자 안팎, 구간마다 다르게)을 따로 쓴다. 예) "그럼 영상 쪽으로 가 볼게요."
- 특정 작품이나 화면의 한 부분을 가리키는 문장에는 focus에 그 부분의 화면 글자(작품 제목 등, 사이트 내용에 실제로 있는 짧은 글자)를 적는다. 구간마다 1~3개, 나머지 문장은 빈 문자열.
- 전체 분량은 약 ${chars}자(약 ${minutes}분). 언어: ${LANG_NAME[lang] || '한국어'}.
- 음성으로 읽히므로 이모지, 마크다운, 괄호 설명, URL은 쓰지 않는다.
- 위 순서에 맞춰 구간을 나누고, 각 구간의 path는 그 구간에서 말하는 내용이 실제로 실려 있는 페이지로 정한다 (대본 이야기는 /script, 영상은 /video, 게임은 /game, 과제는 해당 과제 상세 페이지). 경로는 아래 목록에 있는 것만 쓴다.
- 마지막 구간은 "궁금한 점을 질문해 달라"는 안내로 끝낸다.

사용 가능한 경로: ${pages.map(p => p.path).join(', ')}

=== 사이트 내용 ===
${knowledgeBlock(pages)}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          segments: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                path: { type: 'STRING' },
                sentences: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: { text: { type: 'STRING' }, focus: { type: 'STRING' } },
                    required: ['text', 'focus']
                  }
                },
                bridge: { type: 'STRING' }
              },
              required: ['path', 'sentences', 'bridge']
            }
          }
        },
        required: ['segments']
      }
    }
  };
  const { data } = await generate(apiKey, model, body, 'text', 120000);
  const out = parseJson(textOf(data));
  const segs = (out.segments || []).filter(s => s.sentences?.some(x => x.text?.trim()));
  const valid = new Set(pages.map(p => p.path));
  return segs.map((s, i) => {
    const lines = s.sentences
      .filter(x => x.text?.trim())
      .map(x => ({ text: x.text.trim(), ...(x.focus?.trim() ? { focus: x.focus.trim() } : {}) }));
    if (s.bridge?.trim() && i < segs.length - 1) lines.push({ text: s.bridge.trim(), bridge: true });
    const text = lines.map(l => l.text).join(' ');
    // 첫 인사·마지막 마무리가 아닌데 '/'(또는 없는 경로)를 고른 구간만 내용으로 페이지를 다시 찾는다
    const specific = valid.has(s.path) && s.path !== '/';
    const edge = i === 0 || i === segs.length - 1;
    return { path: specific || edge ? (valid.has(s.path) ? s.path : '/') : bestPath(text, pages), lines, text };
  });
}

// LLM이 고른 경로가 틀릴 때가 있어서(예: 대본 이야기인데 '/'), 구간 내용과 가장 많이 겹치는
// 페이지를 직접 찾는다. 여러 페이지에 흔한 글자쌍은 가중치를 낮추고(IDF), 긴 페이지가
// 유리하지 않도록 페이지 크기로 나눈다.
function grams(s) {
  const t = s.replace(/[\s.,!?'"()[\]·…~:;\-]/g, '').toLowerCase();
  const g = new Set();
  for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
  return g;
}

function bestPath(text, pages) {
  const pageGrams = pages.map(p => grams(p.text));
  const df = new Map();
  for (const g of pageGrams) for (const x of g) df.set(x, (df.get(x) || 0) + 1);
  const want = grams(text);
  let best = '/', bestScore = 0;
  pages.forEach((p, i) => {
    if (p.path === '/') return;
    let s = 0;
    for (const x of want) if (pageGrams[i].has(x)) s += Math.log(pages.length / df.get(x));
    s /= Math.sqrt(pageGrams[i].size || 1);
    if (s > bestScore) { bestScore = s; best = p.path; }
  });
  return best;
}

// 2) 질의응답: 음성(wav base64) 또는 텍스트 질문 → 사이트 근거 답변
async function answerQuestion({ apiKey, model, pages, lang, persona, history, audioBase64, questionText, faqItems = [] }) {
  // 미리 답변을 만들어 둔 예상 질문: 질문이 정확히 같은 내용일 때만 고르게 한다 (애매하면 새로 답변)
  const faqBlock = faqItems.length
    ? `\n미리 준비한 답변이 있는 질문 목록 (id: 질문):\n${faqItems.map(f => `- ${f.id}: ${f.question}`).join('\n')}
- 청중 질문이 한국어이고, 위 목록의 한 질문과 같은 것을 묻고, 준비한 답변이 그대로 답이 될 때만 faqId에 그 id를 적는다. 질문이 중국어·영어 등 다른 언어이거나 조금이라도 애매하면 faqId는 빈 문자열로 하고 answer를 새로 쓴다.\n`
    : '';
  const system = `${IDENTITY}
지금은 발표가 끝난 뒤 현장 청중의 질문에 답하는 시간이다. 인사나 자기소개 없이 바로 본론을 말한다.
${persona}
규칙:
- 아래 포트폴리오 사이트 내용을 근거로 답한다. 사이트에 없는 내용은 추측하지 말고 "포트폴리오에는 그 내용이 없다"고 솔직히 말한 뒤, 관련된 내용이 있으면 대신 소개한다.
${SOURCE_RULES}
${SPEECH_RULES}
- 1~3문장으로 답한다: 핵심 한 문장 + 근거나 예 한두 문장. 음성으로 읽히므로 이모지, 마크다운, URL은 쓰지 않는다.
- "네", "아", "음", "좋은 질문이에요" 같은 말로 시작하지 말고 내용으로 바로 시작한다 (맞장구는 앱이 따로 재생한다).${faqBlock}
- 질문과 같은 언어로 답한다. 언어를 알 수 없으면 ${LANG_NAME[lang] || '한국어'}로 답한다.
- 답과 가장 관련 있는 페이지 경로를 path로 고른다. 경로는 목록에 있는 것만: ${pages.map(p => p.path).join(', ')}
- 음성이 비어 있거나 알아들을 수 없으면 question을 빈 문자열로 하고, answer에 다시 말해 달라고 정중히 요청한다.

=== 사이트 내용 ===
${knowledgeBlock(pages)}`;

  const contents = [];
  for (const h of history.slice(-6)) {
    contents.push({ role: 'user', parts: [{ text: h.question }] });
    contents.push({ role: 'model', parts: [{ text: h.answer }] });
  }
  const parts = [];
  if (audioBase64) {
    parts.push({ inline_data: { mime_type: 'audio/wav', data: audioBase64 } });
    parts.push({ text: '위 음성은 현장 청중의 질문이다. 질문을 받아쓰고(question), 답하라(answer).' });
  } else {
    parts.push({ text: `청중 질문: ${questionText}` });
  }
  contents.push({ role: 'user', parts });

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature: 0.6,
      // 현장 질의응답은 속도가 중요하므로 '생각하기'를 끈다 (응답 약 7초 → 1~3초)
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          question: { type: 'STRING' },
          answer: { type: 'STRING' },
          path: { type: 'STRING' },
          faqId: { type: 'STRING' }
        },
        required: ['question', 'answer', 'path', 'faqId']
      }
    }
  };
  const { data } = await generate(apiKey, model, body);
  const out = parseJson(textOf(data));
  if (!audioBase64) out.question = questionText;
  return out;
}

// 3) Gemini TTS: 24kHz 16bit mono PCM을 WAV로 감싸서 base64로 반환
// (말투 지시문을 앞에 붙이면 최신 TTS 모델이 그 지시문까지 소리 내어 읽으므로 본문만 보낸다)
async function synthesize({ apiKey, ttsModel, voice, text }) {
  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
    }
  };
  const { data } = await generate(apiKey, ttsModel, body, 'tts', 45000);
  const part = (data?.candidates?.[0]?.content?.parts || []).find(p => p.inlineData || p.inline_data);
  const inline = part?.inlineData || part?.inline_data;
  if (!inline?.data) throw new GeminiError('TTS 응답에 오디오가 없습니다.', 500);
  const mime = (inline.mimeType || inline.mime_type || '').toLowerCase();
  // 최신 TTS 모델은 이미 WAV로 주고, 예전 모델은 헤더 없는 PCM(L16)을 준다
  if (mime.includes('wav')) return inline.data;
  const rate = Number((mime.match(/rate=(\d+)/) || [])[1]) || 24000;
  const pcm = Buffer.from(inline.data, 'base64');
  return pcmToWav(pcm, rate).toString('base64');
}

function pcmToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function testConnection({ apiKey, model }) {
  const { data, model: used } = await generate(apiKey, model, {
    contents: [{ parts: [{ text: '"연결 성공"이라고만 답해.' }] }]
  });
  return { reply: textOf(data).trim(), model: used };
}

module.exports = { generateIntro, answerQuestion, synthesize, testConnection };
