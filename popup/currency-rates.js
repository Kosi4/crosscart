window.Crosscart = window.Crosscart || {};

(function () {
  const RATES_URL = 'https://open.er-api.com/v6/latest/USD';

  const FALLBACK_RATES = {
    USD: 1,
    EUR: 0.92,
    GBP: 0.79,
    ZAR: 18.5,
    JPY: 149,
    CAD: 1.36,
    AUD: 1.52,
    INR: 83.2,
  };

  async function fetchExchangeRates() {
    const { storage, STORAGE_KEYS } = window.Crosscart;
    try {
      const response = await fetch(RATES_URL);
      if (!response.ok) throw new Error('rate fetch failed');
      const data = await response.json();
      const record = { rates: data.rates, fetchedAt: Date.now(), base: 'USD' };
      await storage.setStorage({ [STORAGE_KEYS.EXCHANGE_RATES]: record });
      return record;
    } catch (e) {
      const record = { rates: FALLBACK_RATES, fetchedAt: Date.now(), base: 'USD' };
      await storage.setStorage({ [STORAGE_KEYS.EXCHANGE_RATES]: record });
      return record;
    }
  }

  function convertAmount(amount, from, to, rates) {
    const num = Number(amount);
    if (Number.isNaN(num) || !rates) return num;
    const fromRate = rates[from] || 1;
    const toRate = rates[to] || 1;
    return (num / fromRate) * toRate;
  }

  async function loadPreferences() {
    const { storage, STORAGE_KEYS } = window.Crosscart;
    const result = await storage.getStorage([STORAGE_KEYS.PREFERRED_CURRENCY]);
    return result[STORAGE_KEYS.PREFERRED_CURRENCY] || 'USD';
  }

  async function savePreferredCurrency(currency) {
    const { storage, STORAGE_KEYS } = window.Crosscart;
    await storage.setStorage({ [STORAGE_KEYS.PREFERRED_CURRENCY]: currency });
  }

  window.Crosscart.currencyRates = {
    RATES_URL,
    FALLBACK_RATES,
    fetchExchangeRates,
    convertAmount,
    loadPreferences,
    savePreferredCurrency,
  };
})();
