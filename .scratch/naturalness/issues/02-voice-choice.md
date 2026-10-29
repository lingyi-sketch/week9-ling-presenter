# 어떤 목소리로 발표하고 답할지

Type: prototype
Status: resolved
Blocked by: 01
Map: [map.md](../map.md)

## Question

발표와 질의응답 전체에 쓸 목소리를 하나 정한다: Gemini `Leda`와 ElevenLabs 기존 목소리 후보 2~3개를, 같은 대본 한 구간으로 들어 보고 고른다.
함께 정할 것:
- 말투 연출(차분함·따뜻함·속도·쉼)을 어떻게 줄지 — Gemini는 지시문을 소리 내 읽은 적이 있으므로 읽히지 않는 방식인지 확인
- 미리 만드는 발표 음성은 언제, 어떤 모델/서비스로 만들지(오늘 한도·크레딧 안에서)
- 실시간 답변이 같은 목소리로 나오지 못할 때(한도 초과 등)의 대체 방법

## Answer

(2026-10-29) **ElevenLabs 기본 목소리 Bella**(eleven_multilingual_v2)로 발표·맞장구·미리 만든 답변·실시간 답변을 모두 한다. Ling이 앱의 「목소리 듣기」로 기본 목소리들을 들어 보고 골랐다.
- Gemini Leda와의 비교는 하지 못했다(오늘 Gemini TTS 한도 소진). 라이브러리 목소리 Yuna는 무료 플랜에서 쓸 수 없어 후보에서 빠짐.
- 연출 지시: ElevenLabs는 지시문 없이 voice_settings(stability 0.45, similarity 0.8, style 0.2)로 톤을 고정. 같은 설정을 모든 음성에 쓴다.
- 미리 만드는 음성: 오늘 ElevenLabs로 25개(대본 12구간 + 맞장구 6 + 예상 답변 7, 약 4,800자)를 만들어 저장하고 preset에 넣는다.
- 실시간 답변도 Bella로 만든다. 실패하면(크레딧 소진·네트워크) 자동 모드에서 OS 기본 음성으로 바뀐다.
