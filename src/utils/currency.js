const RATE_URL = process.env.USD_INR_RATE_URL || 'https://open.er-api.com/v6/latest/USD';
const RATE_CACHE_MS = 60 * 60 * 1000;

let cachedRate = null;
let cachedAt = 0;

async function getUsdInrRate() {
  if (cachedRate && Date.now() - cachedAt < RATE_CACHE_MS) {
    return cachedRate;
  }

  const response = await fetch(RATE_URL, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Exchange-rate provider is unavailable');

  const data = await response.json();
  const rate = Number(data?.rates?.INR);
  if (data?.result !== 'success' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error('Exchange-rate provider returned an invalid USD/INR rate');
  }

  cachedRate = {
    rate,
    rateUpdatedAt: data.time_last_update_utc || null,
  };
  cachedAt = Date.now();
  return cachedRate;
}

async function convertUsdToInr(amountUsd) {
  const amount = Number(amountUsd);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
    throw new RangeError('amount must be greater than 0 and no more than 1000000 USD');
  }

  const quote = await getUsdInrRate();
  return {
    amountUsd: amount,
    amountInr: Math.round(amount * quote.rate * 100) / 100,
    rate: quote.rate,
    rateUpdatedAt: quote.rateUpdatedAt,
    quotedAt: new Date().toISOString(),
  };
}

module.exports = { convertUsdToInr };