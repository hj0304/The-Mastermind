# The Mastermind — 두뇌게임 아레나

클래식 두뇌게임을 AI 대전으로 재해석한 웹 게임 모음집.
모든 게임에는 단 하나의 난이도 — 당신을 학습하는 **EXTREME AI** — 만 존재합니다.

**▶ 플레이: https://hj0304.github.io/The-Mastermind/** (브라우저에서 바로 실행, 모바일/PC 지원)

> NHN NAN 2026 Game × AI 해커톤 사전 과제 출품작 · 1인 개발

## 게임 목록

| 게임 | 원류 | AI 기법 |
|---|---|---|
| ✅ 모노크롬 | 블라인드 수싸움 | 베이지안 손패 추적 + 종반 완전 탐색 + 플레이어 성향 학습 |
| ✅ 블라인드 포커 | 인디언 포커 | 카드 카운팅 + 베팅 행동 기반 자기 카드 역추론 + 블러핑 성향 학습 |
| ✅ 밀림장기 | 동물장기 | 반복 심화 알파베타 탐색 + 치환표 (깊이 10+) |
| ✅ 수(數)의 진 | 스트라테고 | 은폐 기물 확률 추론 + 이동 이력 지뢰 추리 + 위협 분석 |
| 🚧 콰트로 외 10종 | — | Coming Soon |

모든 AI는 **사람과 동일한 공개 정보만으로** 추론합니다 (상대 패를 훔쳐보지 않음).
플레이어별 성향 학습은 브라우저 localStorage에 누적됩니다 — 판을 거듭할수록 AI가 당신을 읽습니다.

## 실행 방법

```bash
npm install
npm run dev      # 개발 서버 (http://localhost:5173)
npm run build    # 프로덕션 빌드 (dist/)
```

배포는 main 브랜치 푸시 시 GitHub Actions가 자동으로 GitHub Pages에 반영합니다.

## 기술 스택

- TypeScript + React 19 + Vite
- 게임 엔진/AI: 외부 라이브러리 없이 순수 TypeScript (`src/games/*/engine.ts`, `ai.ts`)
- 게임 룰 명세: [docs/GAME_RULES.md](docs/GAME_RULES.md)

## 개발 규칙

- **브랜칭**: GitHub Flow — `main`은 항상 배포 가능 상태, 작업은 `feat/*`, `fix/*`, `docs/*`, `ci/*` 브랜치에서 PR로 병합
- **커밋 컨벤션**: Conventional Commits (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`) + 본문은 한국어
