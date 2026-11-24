import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
// Self-hosted variable fonts (no font CDN, works offline with the PWA cache).
// Allo is the interface face — an Inter fork (same metrics), so Inter stays as
// the fallback. Typeface credit: https://allo.joshpuckett.me (OFL; see footer)
import 'allo-font';
import '@fontsource-variable/inter';
import './styles.css';

// PWA (INFRASTRUCTURE §11.1): offline shell + cached map payloads
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline features degrade quietly */ });
  });
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
