/**
 * 동시 선택을 공정하게 만드는 커밋-리빌(commit–reveal) 유틸.
 *
 * 왜 필요한가:
 * 호스트 권위 방식에서는 게스트의 선택이 메시지로 호스트에게 먼저 도착한다. 화면에
 * 표시하지 않아도 호스트가 개발자 도구로 값을 엿본 뒤 자기 선택을 정할 수 있어,
 * '동시에 고른다'는 전제가 깨진다.
 *
 * 그래서 두 단계로 나눈다:
 *   1) 커밋 — 각자 선택값과 난수 salt를 합쳐 해시만 보낸다(값은 알 수 없다)
 *   2) 리빌 — 양쪽 커밋이 모인 뒤에야 실제 값과 salt를 공개하고 해시를 검증한다
 * 상대 커밋을 받은 시점에는 이미 내 선택이 해시로 고정돼 있으므로 바꿀 수 없다.
 */

const enc = new TextEncoder();

export interface Commitment {
  /** 상대에게 보내는 해시 */
  hash: string;
  /** 리빌 때 함께 보내는 난수 (커밋 전까지 비공개) */
  salt: string;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function digest(value: number, salt: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(`${value}:${salt}`));
  return toHex(new Uint8Array(buf));
}

/** 선택값을 감춘 커밋 생성 */
export async function makeCommitment(value: number): Promise<Commitment> {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return { hash: await digest(value, salt), salt };
}

/** 공개된 값이 앞서 받은 커밋과 일치하는지 검증 */
export async function verifyCommitment(
  hash: string,
  value: number,
  salt: string,
): Promise<boolean> {
  try {
    return (await digest(value, salt)) === hash;
  } catch {
    return false;
  }
}
