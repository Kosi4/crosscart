window.Crosscart = window.Crosscart || {};

(function () {
  const SUPPORTED = window.Crosscart.SUPPORTED_CURRENCIES;

  const CURRENCY_SYMBOLS = {
    '$': 'USD',
    'us$': 'USD',
    '€': 'EUR',
    '£': 'GBP',
    'r': 'ZAR',
    'zar': 'ZAR',
    '¥': 'JPY',
    'jpy': 'JPY',
    'cad$': 'CAD',
    'c$': 'CAD',
    'aud$': 'AUD',
    'a$': 'AUD',
    '₹': 'INR',
    'rs': 'INR',
    'inr': 'INR',
  };

  const TLD_CURRENCY_MAP = {
    'co.za': 'ZAR',
    'za': 'ZAR',
    'co.uk': 'GBP',
    'uk': 'GBP',
    'de': 'EUR',
    'fr': 'EUR',
    'es': 'EUR',
    'it': 'EUR',
    'nl': 'EUR',
    'eu': 'EUR',
    'jp': 'JPY',
    'ca': 'CAD',
    'com.au': 'AUD',
    'au': 'AUD',
    'in': 'INR',
    'co.in': 'INR',
  };

  function normalizeCurrency(raw) {
    if (!raw) return null;
    const value = String(raw).trim().toLowerCase();
    if (SUPPORTED.includes(value.toUpperCase())) return value.toUpperCase();
    if (CURRENCY_SYMBOLS[value]) return CURRENCY_SYMBOLS[value];
    for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
      if (value.includes(symbol)) return code;
    }
    return null;
  }

  function inferCurrencyFromHost(hostname) {
    if (!hostname) return 'USD';
    const parts = hostname.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const suffix = parts.slice(i).join('.');
      if (TLD_CURRENCY_MAP[suffix]) return TLD_CURRENCY_MAP[suffix];
    }
    return 'USD';
  }

  function formatMoney(amount, currency) {
    const num = Number(amount);
    if (Number.isNaN(num)) return '';
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(num);
    } catch (e) {
      return `${currency || 'USD'} ${num.toFixed(2)}`;
    }
  }

  window.Crosscart.normalizeCurrency = normalizeCurrency;
  window.Crosscart.CURRENCY_SYMBOLS = CURRENCY_SYMBOLS;
  window.Crosscart.inferCurrencyFromHost = inferCurrencyFromHost;
  window.Crosscart.formatMoney = formatMoney;
})();
