# Ling AI Presenter

포트폴리오 웹사이트를 AI 아바타가 **각색해서 1인칭으로 발표**하고, 현장 청중의 **질문에 음성으로 답하는** 데스크톱 앱입니다.
(AI기반콘텐츠창업워크숍 중간 프로젝트)

- 대상 사이트: https://my-new-portfolio-ling-d2f5.vercel.app/
- 사람용 사용 설명서: [사용가이드.md](사용가이드.md)
- 실행 파일(Windows exe · Mac zip): https://github.com/lingyi-sketch/week9-ling-presenter/releases/latest
- 기획 문서
  - 처음 기획: [.scratch/ai-presenter/destination-and-requirements.md](.scratch/ai-presenter/destination-and-requirements.md)
  - 자연스러움 개선 (`/wayfinder`로 결정한 지도와 티켓): [.scratch/naturalness/map.md](.scratch/naturalness/map.md)

## 주요 기능

| 기능 | 설명 |
|---|---|
| 각색 발표 | 사이트를 바탕으로 1인칭 구어체 대본(12구간, 약 10분)을 만들어 발표 (원문 낭독 X). 대본은 저장·직접 수정 가능 |
| 화면 연동 | 대본의 `★ 강조` 문장마다 해당 요소를 **말보다 0.3초 먼저** 스크롤·금색 강조하고 아바타가 그 옆으로 이동. 문장 시작 시각은 음성의 무음 구간에서 계산. 구간 끝 다리 문장(`»`)이 시작되면 다음 페이지로 이동해 무음 없이 이어짐 |
| 실시간 질의응답 | 마이크(누르고 말하기) 또는 텍스트 질문 → 사이트 내용 근거로 1~3문장 답변 + 음성 |
| 맞장구 | 질문을 보내자마자 미리 녹음한 맞장구("아, 네." 등)를 재생, 답이 늦으면 두 번째 맞장구 한 번 |
| 예상 질문 | 미리 답변·음성을 만들어 둔 예상 질문 7개. 같은 질문(한국어)이면 저장된 답변을 바로 재생하고 맞장구 중에 페이지를 옮김 |
| 👆 가리켜서 설명 | 설명 모드에서 페이지의 카드·문단을 클릭하면 그 부분을 설명 |
| 아바타 | 오리지널 SVG 캐릭터. 마우스 따라다니기, 눈 깜빡임, 음량에 맞춘 입 모양, 말풍선 |
| 음성 | ElevenLabs(기본 목소리 Bella) 또는 Gemini TTS(Leda) → 실패 시 OS 기본 음성. 한 번 만든 음성은 파일로 저장해 재사용, 배포본에 포함 |

## 실행 환경

| 항목 | 요구 사항 |
|---|---|
| OS | Windows 10/11 (x64), macOS 12 이상 |
| Node.js | 18 이상 (개발·테스트: Node 24.21.0, npm 11.19.0) |
| 인터넷 | 필요 (사이트 표시·읽기, Gemini·ElevenLabs API) |
| 마이크 | 음성 질문을 받을 때만 필요 (없으면 텍스트 질문 사용) |
| API | Google Gemini API 키 (질의응답, 무료 등급 가능) · ElevenLabs API 키 (새 음성 생성, 무료 플랜 가능 — 기본 목소리만) |

> 배포본(exe, `preset/` 포함)은 **키 없이도 소개 발표(대본·음성)를 그대로 재생**합니다. 질의응답에는 Gemini 키가 필요합니다.

## 의존성

런타임 의존성은 없습니다. (Gemini API는 Node 내장 `fetch`로 REST 호출)

| 패키지 | 버전 | 용도 |
|---|---|---|
| electron | ^45.0.0 | 데스크톱 앱 (Windows·Mac 공통) |
| electron-builder | ^26.18.0 | 실행 파일 패키징 |

## 설치 및 실행

```bash
git clone <이 저장소 주소>
cd portfolio-presenter
npm install
```

API 키 설정 (아래 중 하나):

```bash
# 1) .env 파일
cp .env.example .env        # Windows: copy .env.example .env
# .env 안의 GEMINI_API_KEY= 뒤에 키를 붙여 넣기
```

```bash
# 2) 환경변수
export GEMINI_API_KEY=AIza...      # Windows PowerShell: $env:GEMINI_API_KEY="AIza..."
```

3) 또는 앱 실행 후 ⚙ 설정 화면의 「Gemini API 키」 칸에 입력

실행:

```bash
npm start
```

## 환경변수

| 이름 | 필수 | 설명 |
|---|---|---|
| `GEMINI_API_KEY` | 질의응답에 필요 (설정 화면에서 입력해도 됨) | Google Gemini API 키 |
| `ELEVENLABS_API_KEY` | 새 음성을 만들 때만 (설정 화면에서 입력해도 됨) | ElevenLabs API 키. 권한: Text to Speech, Voices(Read), User(Read) |

키를 읽는 우선순위: **설정 화면에 저장한 키 → 환경변수 → `.env` 파일**.
`.env`는 프로젝트 폴더, 실행 파일(.exe)과 같은 폴더, 현재 작업 폴더 순으로 찾습니다. `.env`는 `.gitignore`에 포함되어 저장소에 올라가지 않습니다.

## 실행 파일 만들기

```bash
npm run dist:win     # Windows: dist/ 에 단일 실행 파일(.exe, portable)
npm run dist:mac     # macOS에서 실행: dist/ 에 .app 압축(zip)
```

배포본에 발표 대본·맞장구·예상 질문과 미리 만든 음성을 함께 넣으려면, 앱에서 「발표 음성 미리 만들기」를 끝낸 뒤 빌드 전에:

```bash
npm run preset       # 내 PC의 대본·예상 질문·음성·목소리 설정 → preset/ 폴더로 복사 (앱에 포함됨)
```

`preset/`에 음성이 있으면, 다른 PC에서도 **API 키 없이** 같은 목소리로 소개 발표가 재생됩니다. (질의응답·가리켜서 설명은 Gemini 키 필요)

## 사용 모델과 무료 한도

| 용도 | 기본 모델 | 비고 |
|---|---|---|
| 대본 생성·질의응답 | `gemini-3.5-flash` | 붐빔(503)·한도(429)·없음(404) 시 다른 flash 모델로 자동 대체. 질의응답은 thinking을 꺼서 약 2~6초 |
| 음성(기본) | ElevenLabs `eleven_multilingual_v2`, 목소리 Bella | 무료 플랜은 기본(premade) 목소리만 API로 사용 가능. 라이브러리 목소리는 402 |
| 음성(대안) | Gemini `gemini-3.8-flash-tts`, 목소리 Leda | 무료 등급은 **모델당 하루 10회** |

- 소개·맞장구·예상 답변 음성(25개, 약 4,800자)은 한 번 만들어 저장해 두므로, 발표 당일에는 새 질문에만 음성 API를 씁니다.

## 대본·예상 질문 편집 형식 (⚙ 설정)

```
[2] /script                        ← 구간 번호와 보여 줄 페이지
대본은 모두 여덟 편을 올려 두었는데, …   ← 한 줄에 한 문장
진회영이라는 작품입니다.
★ 강조: 친화이영                     ← 바로 위 문장을 말하기 0.3초 전에 이 글자가 있는 요소를 강조
                                      (글자 없는 끼워 넣은 화면은 "게임 화면", "게임 화면 2", 사진은 대체 글자)
» 이 이야기들이 영상으로는 …          ← 다리 문장: 말하기 시작할 때 다음 페이지로 이동

[12] /
아까 소개하지 못한 대본 중에 …
↪ 이동: /script                       ← 이 문장을 말할 때 구간 도중에 다른 페이지로 이동
★ 강조: 우리만의 시간
```

```
# 맞장구 / # 두 번째 맞장구           ← 한 줄에 하나
# 예상 질문
[3] /script                        ← 경로를 비우면 페이지 이동 없음
Q: 가장 애착이 가는 작품은 뭐예요?
A: 진회영이에요. …
★ 강조: 秦淮影
```

## 데이터 저장 위치

| OS | 경로 |
|---|---|
| Windows | `%APPDATA%\Ling AI Presenter\` |
| macOS | `~/Library/Application Support/Ling AI Presenter/` |

| 파일 | 내용 |
|---|---|
| `config.json` | 설정(API 키 포함 — 공유 금지) |
| `knowledge.json` | 사이트에서 읽어 온 페이지별 텍스트 |
| `script.json` | 저장된 소개 대본 |
| `faq.json` | 맞장구·예상 질문 |
| `tts/*.mp3`, `tts/*.wav` | 미리 만든 음성 (ElevenLabs는 mp3, Gemini는 wav) |

## 단축키

| 키 | 동작 |
|---|---|
| F1 | 소개 시작 / 멈춤 / 이어서 |
| F2 | 질문 녹음 시작 / 보내기 |
| F3 | 마우스 따라다니기 켜기·끄기 |
| F4 | 👆 가리켜서 설명 모드 켜기·끄기 |
| Esc | 말하기 중지, 설정 닫기 |

## 폴더 구조

```
portfolio-presenter/
├─ src/
│  ├─ main.js             # Electron 메인: 창, 설정, IPC, 음성 파일 캐시
│  ├─ preload.js          # 화면 ↔ 메인 연결 (contextBridge)
│  ├─ webview-preload.js  # 포트폴리오 페이지 안: 마우스 위치·클릭 전달
│  ├─ crawler.js          # 숨은 창으로 사이트 전 페이지 텍스트 수집
│  ├─ gemini.js           # Gemini REST: 대본 생성, 질의응답, TTS, 모델 대체
│  ├─ elevenlabs.js       # ElevenLabs REST: 목소리 목록, 음성 합성, 사용량
│  └─ renderer/           # 화면 (index.html, style.css, app.js)
├─ scripts/export-preset.js  # 대본·음성을 preset/ 으로 내보내기
├─ preset/                # 배포용 대본·음성 (npm run preset)
├─ .scratch/ai-presenter/ # 기획 문서
├─ .env.example
└─ package.json
```

## 문제 해결

| 증상 | 해결 |
|---|---|
| `Gemini 오류(429)` | 무료 한도 초과. 잠시 후 재시도(일일 한도는 태평양 시간 자정에 초기화) |
| `서버가 붐빕니다(503)` | 앱이 자동으로 다른 모델로 재시도. 계속되면 잠시 후 다시 |
| 목소리가 기계음으로 바뀜 | 음성 API 실패(한도·크레딧·네트워크)로 OS 음성으로 전환된 상태. 「발표 음성 미리 만들기」로 저장해 두면 소개·맞장구·예상 답변에는 발생하지 않음 |
| ElevenLabs 「목록 불러오기」 실패 | 키 권한에 Voices(Read)가 없음. elevenlabs.io › API Keys에서 권한 추가 |
| ElevenLabs 목소리가 소리가 안 남(🔒) | 라이브러리 목소리는 무료 플랜에서 API로 쓸 수 없음(402). 기본 목소리를 고르거나 유료 플랜 |
| "마이크에서 소리가 전혀 들어오지 않아요" | 키보드 마이크 끄기 키, Windows 설정 › 시스템 › 소리 › 입력 음량 확인 |
| macOS에서 "열 수 없음"·"손상됨" | 서명되지 않은(ad-hoc) 앱이라 Gatekeeper가 막음. `xattr -cr "/Applications/Ling AI Presenter.app"` 실행, 또는 시스템 설정 › 개인정보 보호 및 보안 › 그래도 열기 (macOS 15+는 우클릭 › 열기 불가). Intel Mac은 x64 파일 사용 |
