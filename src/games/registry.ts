/**
 * 게임 카탈로그. 이름·수록 여부는 여기에서만 관리한다.
 * status: 'playable'(완성) | 'wip'(개발 중) | 'planned'(Coming Soon)
 */

export type GameStatus = 'playable' | 'wip' | 'planned';

export interface GameMeta {
  id: string;
  /** 서비스 표기명 */
  name: string;
  /** 한 줄 소개 */
  tagline: string;
  solo: boolean;
  multi: boolean;
  minPlayers: number;
  maxPlayers: number;
  status: GameStatus;
  /** 규칙의 원류(클래식 게임) — 문서·크레딧 표기용 */
  origin?: string;
}

export const GAMES: GameMeta[] = [
  {
    id: 'jungle-janggi',
    name: '밀림장기',
    tagline: '3×4 초소형 장기판 위의 완전정보 두뇌전',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'wip',
    origin: '동물장기(どうぶつしょうぎ) 계열 미니 장기',
  },
  {
    id: 'quattro',
    name: '사통(四通)',
    tagline: '내가 고른 말을 상대가 놓는다 — 공통 속성 4연결 대전',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'planned',
    origin: '속성 매칭 4목 계열 추상전략 게임',
  },
  {
    id: 'blind-poker',
    name: '블라인드 포커',
    tagline: '내 카드만 못 보는 포커 — 상대의 표정을 읽어라',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'planned',
    origin: '클래식 카드게임 인디언 포커',
  },
  {
    id: 'yut-tactics',
    name: '윷 대전',
    tagline: '운을 전략으로 바꾸는 신개념 윷놀이',
    solo: false, multi: true, minPlayers: 2, maxPlayers: 4,
    status: 'planned',
    origin: '한국 전통 윷놀이',
  },
  {
    id: 'yut-bluff',
    name: '윷과 거짓말',
    tagline: '윷 결과를 속여라 — 의심과 심리의 윷놀이',
    solo: false, multi: true, minPlayers: 2, maxPlayers: 4,
    status: 'planned',
    origin: '한국 전통 윷놀이 + 블러핑 변형',
  },
  {
    id: 'reflect',
    name: '리플렉트',
    tagline: '거울을 배치해 광선으로 왕을 노리는 반사 장기',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'planned',
    origin: '레이저 반사 체스 계열 추상전략 게임',
  },
  {
    id: 'monochrome',
    name: '모노크롬',
    tagline: '0~8 숫자 타일 9장, 아홉 번의 심리전',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'wip',
    origin: 'GOPS 계열 블라인드 비딩 게임',
  },
  {
    id: 'monochrome-2',
    name: '모노크롬 II',
    tagline: '타일이 순환하는 모노크롬 확장전',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'planned',
    origin: 'GOPS 계열 블라인드 비딩 게임 변형',
  },
  {
    id: 'janus-poker',
    name: '야누스 포커',
    tagline: '앞면과 뒷면, 두 얼굴의 패로 벌이는 이중 심리전',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'planned',
  },
  {
    id: 'dark-maze',
    name: '암전 미궁',
    tagline: '한 번 본 미로를 기억만으로 탈출하라',
    solo: false, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'planned',
  },
  {
    id: 'loop-line',
    name: '순환선',
    tagline: '선로 타일을 이어 나만의 노선을 완성하는 건설 경쟁',
    solo: false, multi: true, minPlayers: 2, maxPlayers: 4,
    status: 'planned',
    origin: '노선 건설 타일 배치 계열 보드게임',
  },
  {
    id: 'monochrome-raise',
    name: '모노크롬 레이즈',
    tagline: '베팅이 더해진 모노크롬 — 칩을 걸고 숫자를 걸어라',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'planned',
    origin: 'GOPS 계열 블라인드 비딩 게임 + 베팅 변형',
  },
  {
    id: 'number-janggi',
    name: '수(數)의 진',
    tagline: '큰 수가 작은 수를 잡는다 — 숫자 기물 장기',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'planned',
  },
  {
    id: 'signal',
    name: '시그널',
    tagline: '금지된 신호를 주고받는 팀 교신 게임',
    solo: false, multi: true, minPlayers: 4, maxPlayers: 6,
    status: 'planned',
  },
];
