/**
 * Live FX Rate Service
 * Fetches USD→INR and other currency→INR rates from ExchangeRate API
 * Caches rates for 6 hours to avoid repeated API calls
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let ratesCache = null;
let cacheTimestamp = null;

async function fetchFreshRates() {
  const apiKey = process.env.FX_API_KEY;
  const baseUrl = process.env.FX_API_URL || 'https://v6.exchangerate-api.com/v6';
  
  // Fetch rates with INR as base
  const url = `${baseUrl}/${apiKey}/latest/INR`;
  
  const { default: fetch } = await import('node-fetch');
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  
  if (!resp.ok) {
    throw new Error(`FX API error: ${resp.status}`);
  }
  
  const data = await resp.json();
  
  if (data.result !== 'success') {
    throw new Error(`FX API error: ${data['error-type']}`);
  }
  
  // Rates are: 1 INR = X foreign currency
  // We want: 1 foreign currency = Y INR
  const inrPerForeign = {};
  for (const [currency, rate] of Object.entries(data.conversion_rates)) {
    if (rate && rate > 0) {
      inrPerForeign[currency] = 1 / rate; // INR per 1 unit of foreign currency
    }
  }
  inrPerForeign['INR'] = 1; // 1 INR = 1 INR
  
  return inrPerForeign;
}

async function getRates() {
  const now = Date.now();
  
  if (ratesCache && cacheTimestamp && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return ratesCache;
  }
  
  try {
    ratesCache = await fetchFreshRates();
    cacheTimestamp = now;
    console.log('[FX] Rates refreshed successfully');
    return ratesCache;
  } catch (err) {
    console.error('[FX] Failed to fetch rates:', err.message);
    // Return cached rates if available (stale), otherwise fallback
    if (ratesCache) {
      console.warn('[FX] Using stale cached rates');
      return ratesCache;
    }
    // Hardcoded fallback rates (approximate, last updated manually)
    return {
      USD: 83.5,
      EUR: 90.2,
      GBP: 105.8,
      JPY: 0.55,
      AED: 22.7,
      SGD: 62.1,
      AUD: 54.3,
      CAD: 61.5,
      CHF: 93.8,
      THB: 2.35,
      MYR: 17.8,
      HKD: 10.7,
      INR: 1,
    };
  }
}

/**
 * Convert an amount from a foreign currency to INR
 * @param {number} amount - Amount in foreign currency
 * @param {string} fromCurrency - ISO 4217 currency code (e.g., 'USD', 'EUR')
 * @returns {{ amountInr: number, fxRate: number }}
 */
export async function convertToINR(amount, fromCurrency) {
  if (fromCurrency === 'INR') {
    return { amountInr: amount, fxRate: 1 };
  }
  
  const rates = await getRates();
  const fxRate = rates[fromCurrency.toUpperCase()];
  
  if (!fxRate) {
    console.warn(`[FX] Unknown currency: ${fromCurrency}, defaulting 1:1`);
    return { amountInr: amount, fxRate: 1 };
  }
  
  return {
    amountInr: Math.round(amount * fxRate * 100) / 100,
    fxRate,
  };
}

/**
 * Get current INR per unit of a currency
 */
export async function getRate(currency) {
  const rates = await getRates();
  return rates[currency.toUpperCase()] || 1;
}
