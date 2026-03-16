/**
 * Scraper Content Script – injected on allegro.pl pages
 * Captures product/listing data via API interception and DOM scraping
 */

import { setupScraperInterceptor, fetchOfferDetails, fetchSellerOffers, searchOffers } from '../content/scraper-interceptor.js';

// ── Init ──────────────────────────────────────────────────────────────────

(function init() {
  setupScraperInterceptor();
  listenForMessages();
  console.log('[Allegro Scraper] Content script loaded on', window.location.href);
})();

// ── Message Listener ──────────────────────────────────────────────────────

function listenForMessages() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  });
}

async function handleMessage(message) {
  switch (message.type) {
    case 'SCRAPER_FETCH_OFFER':
      return fetchOfferDetails(message.offerId);

    case 'SCRAPER_FETCH_SELLER_OFFERS':
      return fetchSellerOffers(message.sellerId, message.limit);

    case 'SCRAPER_SEARCH_OFFERS':
      return searchOffers(message.query, message.params);

    case 'SCRAPER_PING':
      return { success: true, url: window.location.href };

    default:
      return { success: false, error: `Unknown scraper message: ${message.type}` };
  }
}
