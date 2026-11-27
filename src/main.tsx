import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {CandidateUploadPage} from './components/CandidateUploadPage.tsx';
import {OfferResponsePage} from './components/OfferResponsePage.tsx';
import {ScreeningLinkPage} from './components/ScreeningLinkPage.tsx';
import {SkillTestPage} from './components/SkillTestPage.tsx';
import '@fontsource-variable/inter';
import {CareersPublicPage} from './components/CareersPublicPage.tsx';
import './index.css';

// Public candidate upload page (opened from the onboarding email). Bypasses the HR login.
const isCandidateUpload = window.location.pathname.startsWith('/onboarding/upload');
// Public offer page (opened from the offer email): /?offer=<token>.
const isOfferPage = new URLSearchParams(window.location.search).has('offer');
// Public screening page (opened from the screening email): /?screen=<token>.
const isScreenPage = new URLSearchParams(window.location.search).has('screen');
// Public skills test page (opened from the test email): /?test=<token>.
const isTestPage = new URLSearchParams(window.location.search).has('test');

// Public careers page of a company: /?careers=<address>.
const isCareersPage = new URLSearchParams(window.location.search).has('careers');

// A landing page arrives pre-rendered for search engines and stays hidden; React takes over from here.
document.getElementById('root')!.removeAttribute('data-ssr');

// Installable app: the service worker keeps the app opening when there is no signal. Production only, so development is never stuck on old files.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isCandidateUpload ? <CandidateUploadPage /> : isOfferPage ? <OfferResponsePage /> : isScreenPage ? <ScreeningLinkPage /> : isTestPage ? <SkillTestPage /> : isCareersPage ? <CareersPublicPage /> : <App />}
  </StrictMode>,
);
