window.Crosscart = window.Crosscart || {};

// Checkout pricing: every fee number lives here, so the web app, the tests and
// (later) the server quote the same thing.
//
// Replaces the flat 2.5% fee, which cost less than card processing and lost
// money on every order. Structure:
//   service fee   SERVICE_RATE of the item subtotal, at least MIN_SERVICE_USD
//                 (the card's fixed 30c would otherwise sink small orders)
//   store fee     PER_STORE_USD for each store ordered from (waived for Plus)
//   conversion    FX_RATE of what's paid to stores priced in a currency other
//                 than CARD_CURRENCY (items and their shipping), since paying
//                 them with our card costs a conversion
// The service fee is on items only; shipping is passed through at cost. Fees depend on the stores, never on the card the
// shopper pays with: a fee keyed to card type is a surcharge, which card
// networks and some US states restrict.
(function () {
  const PRICING = {
    CARD_CURRENCY: 'USD', // CrossCart's virtual cards are issued by a US company
    SERVICE_RATE: 0.05,
    MIN_SERVICE_USD: 1.0,
    PER_STORE_USD: 1.5, // decided 2026-10-01 (vault: Pricing); 1.19 is the floor that clears tests/pricing.check.js
    FX_RATE: 0.02,
    PLUS_MONTHLY_USD: 4.99, // placeholder: test real willingness to pay before launch
  };

  // What one order costs CrossCart. Used only to check PRICING still covers it.
  // "verified" = checked against the provider's page on 2026-09-25.
  const COSTS = {
    CARD_RATE: 0.029, // verified: Stripe US, domestic card
    CARD_FIXED_USD: 0.3, // verified
    INTL_CARD_RATE: 0.015, // verified: Stripe US surcharge on international cards
    VIRTUAL_CARD_USD: 0.1, // third-party report of Stripe Issuing pricing; confirm with Stripe
    AGENT_PER_STORE_USD: 0.15, // estimate: one checkout-agent run on one store
    ISSUING_FX_RATE: 0.015, // estimate: USD card paying a non-USD store; confirm with Stripe
    RISK_RATE: 0.003, // estimate: fraud and dispute reserve
  };

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function isForeign(currency) {
    return String(currency || PRICING.CARD_CURRENCY).toUpperCase() !== PRICING.CARD_CURRENCY;
  }

  // stores: [{ goodsUsd, shipUsd, currency }], one entry per store in the order.
  // plan: 'free' | 'plus'. All amounts in USD.
  function quote(stores, plan) {
    const plus = plan === 'plus';
    const goods = stores.reduce((sum, s) => sum + (s.goodsUsd || 0), 0);
    const foreign = stores.filter((s) => isForeign(s.currency));
    const shipping = stores.reduce((sum, s) => sum + (s.shipUsd || 0), 0);
    const foreignSpend = foreign.reduce((sum, s) => sum + (s.goodsUsd || 0) + (s.shipUsd || 0), 0);
    const storeFees = round2(stores.length * PRICING.PER_STORE_USD);
    const service = goods > 0 ? round2(Math.max(goods * PRICING.SERVICE_RATE, PRICING.MIN_SERVICE_USD)) : 0;
    const perStore = plus ? 0 : storeFees;
    const conversion = round2(foreignSpend * PRICING.FX_RATE);
    return {
      plan: plus ? 'plus' : 'free',
      storeCount: stores.length,
      foreignStores: foreign.length,
      goods,
      shipping,
      foreignSpend,
      service,
      perStore,
      waived: plus ? storeFees : 0,
      conversion,
      fee: round2(service + perStore + conversion),
    };
  }

  // What CrossCart keeps on one order after its own costs.
  // opts: { intlCard }
  function margin(q, opts) {
    const o = opts || {};
    const charge = q.goods + q.shipping + q.fee;
    const cost =
      charge * (COSTS.CARD_RATE + (o.intlCard ? COSTS.INTL_CARD_RATE : 0)) +
      COSTS.CARD_FIXED_USD +
      q.storeCount * (COSTS.VIRTUAL_CARD_USD + COSTS.AGENT_PER_STORE_USD) +
      q.foreignSpend * COSTS.ISSUING_FX_RATE +
      charge * COSTS.RISK_RATE;
    return round2(q.fee - cost);
  }

  window.Crosscart.pricing = { PRICING, COSTS, isForeign, quote, margin };
})();
