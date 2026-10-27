import type { Api } from './types';

/**
 * Counts one visit per browser session for the public page only (never /admin).
 * Uses a random, anonymous id kept in this browser; no IP or personal data is collected.
 * The server additionally ignores the same id within 30 minutes and caps the hourly total.
 */
export function trackVisit(api: Pick<Api, 'recordVisit'>, storage = { local: localStorage, session: sessionStorage }) {
  try {
    if (navigator.webdriver) return; // automated browsers
    if (storage.session.getItem('nft-visit')) return;
    storage.session.setItem('nft-visit', '1');
    let id = storage.local.getItem('nft-visitor');
    if (!id) {
      id = crypto.randomUUID();
      storage.local.setItem('nft-visitor', id);
    }
    api.recordVisit(id).catch(() => {});
  } catch {
    /* storage blocked: skip analytics */
  }
}
