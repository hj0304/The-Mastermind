// 이 PC의 Node 24.12.0에서 fs.rm/fs.rmSync 호출이 STATUS_STACK_BUFFER_OVERRUN으로
// 프로세스를 죽이는 문제가 있어, vite의 emptyOutDir 대신 unlink/rmdir로 dist를 비운다.
// (fs.unlinkSync / fs.rmdirSync는 정상 동작 확인됨)
import { readdirSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function rmrf(path) {
  if (!existsSync(path)) return;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const p = join(path, entry.name);
    if (entry.isDirectory()) rmrf(p);
    else unlinkSync(p);
  }
  rmdirSync(path);
}

rmrf(new URL('../dist', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
console.log('dist cleaned');
