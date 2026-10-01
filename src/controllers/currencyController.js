const { convertUsdToInr } = require('../utils/currency');

async function quoteUsdToInr(req, res) {
  try {
    const quote = await convertUsdToInr(req.query.amount);
    return res.json({ fromCurrency: 'USD', toCurrency: 'INR', ...quote });
  } catch (err) {
    const status = err instanceof RangeError ? 400 : 503;
    return res.status(status).json({ error: err.message });
  }
}

module.exports = { quoteUsdToInr };