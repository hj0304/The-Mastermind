/**
 * 게임 카탈로그. 이름·수록 여부는 여기에서만 관리한다.
 * 각 게임의 정확한 룰은 docs/GAME_RULES.md 참조.
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
    tagline: '3×4 초소형 장기판, 잡은 말은 내 말이 된다',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'wip',
    origin: '동물장기(どうぶつしょうぎ) 계열 미니 장기',
  },
  {
    id: 'quattro',
    name: '콰트로',
    tagline: '색도 숫자도 겹치지 않는 4장을, 상대보다 높게 완성하라',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'planned',
    origin: '바둑이 포커 변형 카드게임',
  },
  {
    id: 'blind-poker',
    name: '블라인드 포커',
    tagline: '내 카드만 못 보는 포커 — 상대의 베팅을 읽어라',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'playable',
    origin: '클래식 카드게임 인디언 포커(Blind man\'s bluff)',
  },
  {
    id: 'yut-tactics',
    name: '윷 대전',
    tagline: '윷을 던지지 말고 선택하라 — 심리전이 된 윷놀이',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 4,
    status: 'planned',
    origin: '한국 전통 윷놀이 + 동시 선택 심리전',
  },
  {
    id: 'yut-bluff',
    name: '윷과 거짓말',
    tagline: '결과는 나만 안다 — 속이고, 의심하고, 잡아내라',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 4,
    status: 'planned',
    origin: '챠오챠오(Ciao Ciao) + 한국 전통 윷놀이',
  },
  {
    id: 'reflect',
    name: '리플렉트',
    tagline: '거울을 조종해 광선으로 왕을 노리는 반사 장기',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'planned',
    origin: '레이저 반사 체스(Khet) 계열',
  },
  {
    id: 'monochrome',
    name: '모노크롬',
    tagline: '0~8 아홉 장, 보이는 건 흑백뿐 — 아홉 번의 수읽기',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'playable',
    origin: '다빈치 코드 모티브의 블라인드 수싸움',
  },
  {
    id: 'monochrome-2',
    name: '모노크롬 II',
    tagline: '99포인트를 쪼개 거는 아홉 번의 눈치 경매',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'planned',
    origin: '블로토 대령 게임(자원 배분 게임이론)',
  },
  {
    id: 'janus-poker',
    name: '야누스 포커',
    tagline: '앞면은 모두에게, 뒷면은 나에게만 — 양면베팅의 승부',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'planned',
    origin: '양면 카드 베팅 게임',
  },
  {
    id: 'dark-maze',
    name: '암전 미궁',
    tagline: '보이지 않는 벽, 부딪히면 처음부터 — 기억만이 지도다',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'planned',
    origin: '마법의 미로(The Magic Labyrinth)',
  },
  {
    id: 'loop-line',
    name: '순환선',
    tagline: '철로를 이어 순환선을 완성하는 마지막 타일의 주인공이 돼라',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'planned',
    origin: '베니스 커넥션(Venice Connection)',
  },
  {
    id: 'monochrome-raise',
    name: '모노크롬 레이즈',
    tagline: '순서와 칩을 먼저 설계하라 — 콜과 폴드의 숫자 전쟁',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'planned',
    origin: '블라인드 비딩 + 포커식 콜/폴드',
  },
  {
    id: 'number-janggi',
    name: '수(數)의 진',
    tagline: '합이 10을 넘으면 큰 수가, 못 넘으면 작은 수가 이긴다',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'planned',
    origin: '스트라테고(Stratego) 계열 은폐 기물전',
  },
  {
    id: 'hidden-formula',
    name: '히든 포뮬러',
    tagline: '숨겨진 연산 규칙을 먼저 간파하는 자가 이긴다',
    solo: true, multi: true, minPlayers: 2, maxPlayers: 2,
    status: 'planned',
    origin: '파라오코드 계열 귀납 추리 게임',
  },
];
