const Receiver = require('../models/Receiver');
const EarningLedger = require('../models/EarningLedger');
const {config} = require('../config');

/**
 * Convert internal coin units → INR using purchase rate.
 * Default: 2500 coins = ₹100 → 1 coin = ₹0.04
 */
function coinsToInr(coins) {
  const rate = Math.max(1, Number(config.coinsPer100Inr) || 2500);
  const value = (Number(coins) || 0) * (100 / rate);
  return Math.round(value * 100) / 100;
}

function inrToCoins(amountInr) {
  const rate = Math.max(1, Number(config.coinsPer100Inr) || 2500);
  return Math.round((Number(amountInr) || 0) * (rate / 100));
}

/**
 * Credit receiver wallet in INR from internal coin units.
 * Stores ledger row so deducted caller coins are attributable per receiver.
 */
async function creditReceiverFromCoins({
  receiverId,
  callerId = null,
  coins,
  source,
  referenceId = null,
  meta = {},
}) {
  const coinUnits = Math.max(0, Number(coins) || 0);
  if (!receiverId || coinUnits <= 0) {
    return {ok: false, amountInr: 0, coins: 0};
  }

  const amountInr = coinsToInr(coinUnits);
  if (amountInr <= 0) {
    return {ok: false, amountInr: 0, coins: coinUnits};
  }

  await Receiver.updateOne(
    {id: receiverId},
    {
      $inc: {
        walletBalance: amountInr,
        earnings: amountInr,
      },
    },
  );

  const entry = await EarningLedger.create({
    receiverId,
    callerId,
    source,
    coins: coinUnits,
    amountInr,
    referenceId,
    meta,
  });

  return {
    ok: true,
    amountInr,
    coins: coinUnits,
    ledgerId: entry.id,
  };
}

module.exports = {
  coinsToInr,
  inrToCoins,
  creditReceiverFromCoins,
};
