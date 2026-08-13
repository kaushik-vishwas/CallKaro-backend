const Order = require('../models/Order');
const Call = require('../models/Call');
const Message = require('../models/Message');

function toIso(value) {
  if (!value) return new Date().toISOString();
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function planLabel(planId) {
  if (planId === 'weekly') return 'Weekly';
  if (planId === 'monthly') return 'Monthly';
  return planId ? String(planId) : 'Plan';
}

async function safeFind(label, fn) {
  try {
    return await fn();
  } catch (error) {
    console.error(`[walletTx] ${label} failed:`, error.message || error);
    return null;
  }
}

/**
 * Wallet / payment activity for the authenticated caller:
 * paid recharges & VIP, video call spend, gifts, and chat charges.
 * Daily check-in rewardCoins are excluded — they are not wallet recharges.
 */
async function listWalletTransactions(userId, {limit = 50} = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const perSource = Math.max(take, 40);
  const uid = String(userId || '');

  const [orders, calls, messages] = await Promise.all([
    safeFind('orders', () =>
      Order.find({userId: uid, status: 'paid'})
        .sort({paidAt: -1, updatedAt: -1})
        .limit(perSource)
        .lean(),
    ),
    safeFind('calls', () =>
      Call.find({
        callerId: uid,
        $or: [
          {coinsCharged: {$gt: 0}},
          {giftsCoinsCharged: {$gt: 0}},
          {'gifts.0': {$exists: true}},
        ],
      })
        .sort({endedAt: -1, updatedAt: -1})
        .limit(perSource)
        .lean(),
    ),
    safeFind('messages', () =>
      Message.find({
        senderId: uid,
        senderRole: 'caller',
        coinsCharged: {$gt: 0},
      })
        .sort({createdAt: -1})
        .limit(perSource)
        .lean(),
    ),
  ]);

  const items = [];

  for (const order of orders || []) {
    const when = order.paidAt || order.updatedAt || order.createdAt;
    if (order.purpose === 'vip') {
      const coins = Number(order.coins) || 0;
      items.push({
        id: `order:${order.id}`,
        type: 'vip',
        title: `VIP ${planLabel(order.planId)}`,
        subtitle:
          coins > 0
            ? `Membership · +${coins.toLocaleString('en-IN')} bonus coins`
            : 'Membership activated',
        coinsDelta: null,
        amountInr: Number(order.amount) || 0,
        direction: 'debit',
        createdAt: toIso(when),
      });
      continue;
    }

    const coins = Number(order.coins) || 0;
    const amount = Number(order.amount) || 0;
    items.push({
      id: `order:${order.id}`,
      type: 'recharge',
      title: `Recharge - Pack Rs${amount}`,
      subtitle: `${coins.toLocaleString('en-IN')} coins`,
      coinsDelta: coins,
      amountInr: amount,
      direction: 'credit',
      createdAt: toIso(when),
    });
  }

  for (const call of calls || []) {
    const name = (call.receiverSnapshot && call.receiverSnapshot.name) || 'Receiver';
    const mins =
      Number(call.billedMinutes) ||
      Math.ceil(Number(call.durationSeconds || 0) / 60) ||
      0;
    const when = call.endedAt || call.updatedAt || call.createdAt;
    const charged = Number(call.coinsCharged) || 0;

    if (charged > 0) {
      items.push({
        id: `call:${call.id}`,
        type: 'call',
        title: `Call with ${name}`,
        subtitle: mins > 0 ? `${mins} min` : 'Video call',
        coinsDelta: -charged,
        amountInr: null,
        direction: 'debit',
        createdAt: toIso(when),
      });
    }

    for (const gift of call.gifts || []) {
      const giftCoins = Number(gift.coins) || 0;
      if (giftCoins <= 0) continue;
      const giftId = gift.id || gift.giftId || `${giftCoins}`;
      items.push({
        id: `gift:${call.id}:${giftId}`,
        type: 'gift',
        title: `Gift to ${name}`,
        subtitle: gift.name || 'Gift',
        coinsDelta: -giftCoins,
        amountInr: null,
        direction: 'debit',
        createdAt: toIso(gift.sentAt || when),
      });
    }
  }

  for (const msg of messages || []) {
    const charged = Number(msg.coinsCharged) || 0;
    if (charged <= 0) continue;
    items.push({
      id: `msg:${msg.id}`,
      type: 'chat',
      title: 'Chat message',
      subtitle: `${charged} coins`,
      coinsDelta: -charged,
      amountInr: null,
      direction: 'debit',
      createdAt: toIso(msg.createdAt),
    });
  }

  items.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return {
    transactions: items.slice(0, take),
    total: items.length,
  };
}

module.exports = {
  listWalletTransactions,
};
