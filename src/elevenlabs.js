// ElevenLabs REST API (목소리 목록, 음성 합성, 남은 크레딧)
const API_BASE = 'https://api.elevenlabs.io/v1';

async function call(apiKey, path, { method = 'GET', body, raw = false, timeoutMs = 60000 } = {}) {
  if (!apiKey) throw new Error('ElevenLabs API 키가 없습니다. 설정(⚙)에서 키를 입력해 주세요.');
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { 'xi-api-key': apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    const err = new Error(e.name === 'TimeoutError' ? 'ElevenLabs 응답이 너무 늦습니다(시간 초과).' : '인터넷 연결을 확인해 주세요. ' + e.message);
    err.status = 0;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    let msg = text.slice(0, 300);
    try { const d = JSON.parse(text); msg = d.detail?.message || d.detail?.status || JSON.stringify(d.detail || d).slice(0, 300); } catch {}
    const err = new Error(
      res.status === 401 ? 'ElevenLabs API 키가 올바르지 않거나 권한이 없습니다. ' + msg
        : res.status === 402 ? '이 목소리는 ElevenLabs 무료 플랜에서는 API로 쓸 수 없어요(목소리 라이브러리에서 추가한 목소리). 기본 목소리를 고르거나, Creator 플랜 또는 크레딧 $5 추가가 필요해요.'
        : res.status === 429 ? 'ElevenLabs 요청 한도에 걸렸습니다(429). 잠시 후 다시 시도해 주세요.'
          : `ElevenLabs 오류(${res.status}): ${msg}`);
    err.status = res.status;
    throw err;
  }
  return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
}

async function listVoices(apiKey) {
  const d = await call(apiKey, '/voices');
  return (d.voices || []).map(v => ({
    id: v.voice_id,
    name: v.name,
    category: v.category,
    labels: v.labels || {},
    preview: v.preview_url
  }));
}

async function subscription(apiKey) {
  const d = await call(apiKey, '/user/subscription');
  return { tier: d.tier, used: d.character_count, limit: d.character_limit, resetAt: d.next_character_count_reset_unix };
}

// mp3(44.1kHz)로 받아 base64로 돌려준다
async function synthesize({ apiKey, voiceId, model, text }) {
  if (!voiceId) throw new Error('ElevenLabs 목소리를 먼저 골라 주세요(설정 ⚙).');
  const buf = await call(apiKey, `/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    raw: true,
    body: {
      text,
      model_id: model || 'eleven_multilingual_v2',
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true }
    }
  });
  return buf.toString('base64');
}

module.exports = { listVoices, subscription, synthesize };
