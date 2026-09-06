import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// BFF 포트는 환경변수로 받는다.
// 하드코딩하면 run-demo.sh(높은 포트)와 수동 실행(기본 포트)이 어긋나 프록시가 엉뚱한 곳을
// 보게 된다 — 화면에는 "서버 응답 없음" 으로만 나타나 원인을 찾기 어렵다 (실제로 겪었다).
const BFF_PORT = process.env.BFF_PORT ?? '8080'
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173)

export default defineConfig({
  plugins: [react()],
  server: {
    port: WEB_PORT,
    // 브라우저는 BFF 만 본다. IX-Auth jar 주소는 프론트에 등장하지 않는다
    proxy: {
      '/api': {
        target: `http://localhost:${BFF_PORT}`,
        changeOrigin: true,
      },
      // 소셜 콜백. provider 는 <b>이 주소(화면 포트)</b>로 사용자를 돌려보내므로
      // 여기서 BFF 로 넘겨야 한다. 빠뜨리면 동의까지 마친 사용자가 Vite 의 404 를 본다
      '/oauth': {
        target: `http://localhost:${BFF_PORT}`,
        changeOrigin: true,
      },
    },
  },
})
