import { jaJP } from '@clerk/localizations'
import { ClerkProvider } from '@clerk/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* publishable key は VITE_CLERK_PUBLISHABLE_KEY から読まれる */}
    <ClerkProvider localization={jaJP}>
      <App />
    </ClerkProvider>
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js')
}
