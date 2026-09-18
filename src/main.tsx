import React from 'react'
import ReactDOM from 'react-dom/client'
import { scan } from 'react-scan'

import App from '@/App'
import '@/index.css'
import 'katex/dist/katex.min.css'

// Initialize i18n
import { i18n } from '@/modules/i18n'
import { updateEmbeddedHostContext } from '@/shared/embeddedHostContext'
import { IS_LLM4AD_EMBEDDED } from '@/shared/utils'

const EMBEDDED_THEME_TOKENS = new Set([
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--destructive-foreground',
  '--border',
  '--input',
  '--ring',
  '--radius',
]);

function embeddedLanguage(language: unknown): string {
  if (typeof language !== 'string') return 'en';
  const normalized = language.toLowerCase();
  if (normalized === 'zh-tw' || normalized === 'zh-hk') return 'zh-TW';
  if (normalized.startsWith('zh')) return 'zh-CN';
  return ['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'ru', 'tr'].includes(normalized)
    ? normalized
    : 'en';
}

if (IS_LLM4AD_EMBEDDED) {
  document.documentElement.dataset.llm4adEmbedded = 'true';
  window.addEventListener('message', (event) => {
    if (
      event.source !== window.parent ||
      event.origin !== window.location.origin ||
      event.data?.type !== 'llm4ad:appearance'
    ) {
      return;
    }
    const tokens = event.data.tokens;
    if (tokens && typeof tokens === 'object') {
      for (const [name, value] of Object.entries(tokens)) {
        if (EMBEDDED_THEME_TOKENS.has(name) && typeof value === 'string' && value.length <= 128) {
          document.documentElement.style.setProperty(name, value);
        }
      }
    }
    if (typeof event.data.fontFamily === 'string' && event.data.fontFamily.length <= 256) {
      document.body.style.fontFamily = event.data.fontFamily;
    }
    updateEmbeddedHostContext(event.data);
    void i18n.changeLanguage(embeddedLanguage(event.data.language));
    document.documentElement.lang = embeddedLanguage(event.data.language);
  });
}

// React Scan is a render-diagnostics overlay, and an expensive one: measured on
// this app it roughly halves the dev frame rate, adds ~14 MB of heap and injects
// a few thousand DOM nodes of its own. It is worth all of that while hunting a
// render bug and worth none of it the rest of the time, so it is opt-in —
// `localStorage.setItem('react-scan', 'on')` and reload.
scan({ enabled: import.meta.env.DEV && localStorage.getItem('react-scan') === 'on' })

// Register service worker for PWA + Web Push support
if ('serviceWorker' in navigator && !IS_LLM4AD_EMBEDDED) {
  navigator.serviceWorker.register('/sw.js').catch(err => {
    console.warn('Service worker registration failed:', err);
  });
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Unable to mount the app: #root is missing from the document')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
