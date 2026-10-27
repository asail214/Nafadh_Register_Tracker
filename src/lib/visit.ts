import type { Api } from './types';

/**
 * Counts one visit per browser session for the public page only (never /admin).
 * Uses a random, anonymous id kept in this browser; no IP or personal data is collected.
 * The server additionally ignores the same id within 30 minutes and caps the hourly total.
 */
type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function trackVisit(api: Pick<Api, 'recordVisit'>, stores?: { local: Store; session: Store }) {
  try {
    if (navigator.webdriver) return; // automated browsers
    // read inside the try: merely touching localStorage throws when the browser blocks site data
    const storage = stores ?? { local: localStorage, session: sessionStorage };
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
