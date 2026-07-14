import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' — GitHub Pages 하위 경로(/저장소명/) 배포에서도 에셋 경로가 깨지지 않도록 상대 경로 사용
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    // dist 비우기는 scripts/clean-dist.mjs가 담당 (이 PC의 Node fs.rm 크래시 우회)
    emptyOutDir: false,
  },
});
