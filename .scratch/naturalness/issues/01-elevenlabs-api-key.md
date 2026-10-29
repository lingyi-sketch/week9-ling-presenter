# ElevenLabs 가입하고 API 키 받기

Type: task
Status: resolved
Blocked by:
Map: [map.md](../map.md)

## Question

목소리 비교(Leda vs ElevenLabs 기존 목소리)를 하려면 ElevenLabs API를 실제로 호출할 수 있어야 한다.
ElevenLabs에 가입하고, 무료 플랜에서 API 키를 만들어 앱이 읽을 수 있는 곳(.env 또는 설정 화면)에 넣는다.
결과로 남길 것: 키를 넣은 위치(키 값 자체는 적지 않음), 무료 플랜의 월 크레딧(글자 수), API로 쓸 수 있는 목소리 범위, 한국어 지원 모델 이름.

이 작업은 Ling이 직접 해야 한다(계정 생성·키 발급). 에이전트는 체크리스트를 주고, 키가 들어간 뒤 호출이 되는지만 확인한다.

## Answer

(2026-10-29) Ling이 가입하고 키를 발급해 앱 설정 화면(⚙ › ElevenLabs API 키)에 넣었다. 키 값은 PC의 설정 파일에만 있다.
- 처음 키에는 Voices(Read) 권한이 없어 목소리 목록을 못 불러왔다 → 권한을 추가해 해결.
- 무료 플랜에서 API로 쓸 수 있는 것은 기본(premade) 목소리 21개뿐. 라이브러리에서 추가한 목소리(Yuna, Ruach)는 402 "Free users cannot use library voices via the API" — Creator 플랜 또는 크레딧 $5 추가가 필요.
- 한국어 모델: eleven_multilingual_v2.
- 월 크레딧은 키에 User(Read) 권한이 없어 앱에서 아직 확인하지 못함(elevenlabs.io 사용량 화면에서 확인).
