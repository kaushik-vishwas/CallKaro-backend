const Receiver = require('../models/Receiver');
const Agent = require('../models/Agent');
const EarningLedger = require('../models/EarningLedger');
const PlatformStats = require('../models/PlatformStats');
const {config} = require('../config');

/** INR split of gross call/gift earnings — coins system unchanged. */
const RECEIVER_INR_SHARE = 0.4;
const AGENT_INR_SHARE = 0.2;
const ADMIN_INR_SHARE = 0.4;

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

function splitGrossInr(grossInr) {
  const gross = Math.max(0, Number(grossInr) || 0);
  const receiverInr = Math.round(gross * RECEIVER_INR_SHARE * 100) / 100;
  const agentInr = Math.round(gross * AGENT_INR_SHARE * 100) / 100;
  // Absorb rounding remainder into admin so parts sum to gross.
  const adminInr = Math.round((gross - receiverInr - agentInr) * 100) / 100;
  return {grossInr: gross, receiverInr, agentInr, adminInr};
}

/**
 * Credit receiver wallet in INR from internal coin units.
 * Coins stay full for ledger/attribution; INR is split:
 * receiver 40% · agent 20% · admin 40%.
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

  const grossInr = coinsToInr(coinUnits);
  if (grossInr <= 0) {
    return {ok: false, amountInr: 0, coins: coinUnits};
  }

  const split = splitGrossInr(grossInr);
  const amountInr = split.receiverInr;
  if (amountInr <= 0) {
    return {ok: false, amountInr: 0, coins: coinUnits, ...split};
  }

  const receiver = await Receiver.findOne({id: receiverId})
    .select('id agentId')
    .lean();
  if (!receiver) {
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

  if (receiver.agentId && split.agentInr > 0) {
    await Agent.updateOne(
      {id: receiver.agentId},
      {$inc: {earnings: split.agentInr}},
    ).catch(() => undefined);
  }

  if (split.adminInr > 0) {
    await PlatformStats.updateOne(
      {id: 'global'},
      {$inc: {adminEarningsInr: split.adminInr}, $setOnInsert: {id: 'global'}},
      {upsert: true},
    ).catch(() => undefined);
  }

  const entry = await EarningLedger.create({
    receiverId,
    callerId,
    source,
    coins: coinUnits,
    amountInr,
    referenceId,
    meta: {
      ...meta,
      grossInr: split.grossInr,
      receiverInr: split.receiverInr,
      agentInr: split.agentInr,
      adminInr: split.adminInr,
      agentId: receiver.agentId || null,
      split: {
        receiver: RECEIVER_INR_SHARE,
        agent: AGENT_INR_SHARE,
        admin: ADMIN_INR_SHARE,
      },
    },
  });

  return {
    ok: true,
    amountInr,
    coins: coinUnits,
    ledgerId: entry.id,
    ...split,
  };
}

/**
 * One-shot: older ledger rows credited 100% INR to the receiver.
 * Rewrite to receiver 40% / agent 20% / admin 40% and rebuild wallets.
 * Coin units on ledger stay unchanged.
 */
async function migrateLegacyReceiverInrSplit() {
  const stats = await PlatformStats.findOneAndUpdate(
    {id: 'global'},
    {$setOnInsert: {id: 'global', adminEarningsInr: 0}},
    {upsert: true, new: true},
  );
  if (stats?.earningsSplitMigratedV1) {
    return {ok: true, skipped: true};
  }

  const Withdrawal = require('../models/Withdrawal');

  const legacy = await EarningLedger.find({
    source: {$in: ['video_call', 'gift', 'chat']},
    $or: [
      {'meta.grossInr': {$exists: false}},
      {'meta.split': {$exists: false}},
    ],
  }).lean();

  const agentDelta = new Map();
  let adminDelta = 0;
  const touchedReceivers = new Set();

  for (const row of legacy) {
    const grossInr = Math.max(0, Number(row.amountInr) || 0);
    if (grossInr <= 0) {
      continue;
    }
    const split = splitGrossInr(grossInr);
    const meta = {
      ...(row.meta && typeof row.meta === 'object' ? row.meta : {}),
      grossInr: split.grossInr,
      receiverInr: split.receiverInr,
      agentInr: split.agentInr,
      adminInr: split.adminInr,
      split: {
        receiver: RECEIVER_INR_SHARE,
        agent: AGENT_INR_SHARE,
        admin: ADMIN_INR_SHARE,
      },
      migratedFromFullCredit: true,
    };

    await EarningLedger.updateOne(
      {_id: row._id},
      {$set: {amountInr: split.receiverInr, meta}},
    );

    touchedReceivers.add(row.receiverId);
    adminDelta += split.adminInr;

    if (row.receiverId) {
      const receiver = await Receiver.findOne({id: row.receiverId})
        .select('agentId')
        .lean();
      const agentId = receiver?.agentId || row.meta?.agentId || null;
      if (agentId && split.agentInr > 0) {
        agentDelta.set(
          agentId,
          (agentDelta.get(agentId) || 0) + split.agentInr,
        );
      }
    }
  }

  // Rebuild wallet + lifetime earnings from corrected ledger − locked withdrawals.
  const receivers = await Receiver.find({}).select('id').lean();
  for (const r of receivers) {
    const [incomeAgg, withdrawAgg] = await Promise.all([
      EarningLedger.aggregate([
        {
          $match: {
            receiverId: r.id,
            source: {$in: ['video_call', 'gift', 'chat', 'adjustment']},
          },
        },
        {$group: {_id: null, total: {$sum: {$ifNull: ['$amountInr', 0]}}}},
      ]),
      Withdrawal.aggregate([
        {
          $match: {
            receiverId: r.id,
            status: {$in: ['paid', 'pending_review']},
          },
        },
        {$group: {_id: null, total: {$sum: {$ifNull: ['$amountInr', 0]}}}},
      ]),
    ]);
    const earned = Math.max(0, Number(incomeAgg[0]?.total) || 0);
    const withdrawn = Math.max(0, Number(withdrawAgg[0]?.total) || 0);
    const walletBalance = Math.max(0, Math.round((earned - withdrawn) * 100) / 100);
    await Receiver.updateOne(
      {id: r.id},
      {$set: {earnings: earned, walletBalance}},
    );
  }

  for (const [agentId, amount] of agentDelta.entries()) {
    if (amount > 0) {
      await Agent.updateOne({id: agentId}, {$inc: {earnings: amount}});
    }
  }

  if (adminDelta > 0) {
    await PlatformStats.updateOne(
      {id: 'global'},
      {$inc: {adminEarningsInr: Math.round(adminDelta * 100) / 100}},
    );
  }

  await PlatformStats.updateOne(
    {id: 'global'},
    {$set: {earningsSplitMigratedV1: true}},
  );

  console.log(
    `[earnings] migrated legacy INR split: ${legacy.length} ledger rows, ${touchedReceivers.size} receivers`,
  );
  return {ok: true, migrated: legacy.length, receivers: touchedReceivers.size};
}

module.exports = {
  coinsToInr,
  inrToCoins,
  splitGrossInr,
  creditReceiverFromCoins,
  migrateLegacyReceiverInrSplit,
  RECEIVER_INR_SHARE,
  AGENT_INR_SHARE,
  ADMIN_INR_SHARE,
};
