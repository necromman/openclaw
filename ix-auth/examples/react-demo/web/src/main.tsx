import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { IxAuthProvider } from '@ix-auth/client-react'
import App from './App'
import { tokenPageFor } from './TokenPages'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* basePath 는 앱 BFF 의 API 경로다. IX-Auth jar 주소가 아니다 */}
    <IxAuthProvider basePath="/api">
      {/* 메일 링크가 도착하는 화면들. 라우터를 쓰지 않은 것은
          "어떤 라우터든 상관없다" 를 보이기 위해서다 */}
      {tokenPageFor(window.location.pathname) ?? <App />}
    </IxAuthProvider>
  </StrictMode>,
)
