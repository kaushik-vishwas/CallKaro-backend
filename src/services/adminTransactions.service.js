const Order = require('../models/Order');
const Caller = require('../models/Caller');

function formatDateTimeLabel(date) {
  if (!date) return '—';
  const d = new Date(date);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  return `${hh}:${mm} ${day}/${month}/${year}`;
}

function formatInrLabel(value) {
  const n = Number(value) || 0;
  return `₹ ${n.toLocaleString('en-IN', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function callerCode(caller) {
  if (!caller) return '—';
  const raw = String(caller.id || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-4)
    .toUpperCase();
  return `#CK${raw || '0000'}`;
}

function mapStatus(status) {
  if (status === 'paid') return 'successful';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function mapType(purpose) {
  return purpose === 'vip' ? 'VIP' : 'Recharge';
}

function mapCategory(purpose) {
  return purpose === 'vip' ? 'VIP Purchase' : 'Wallet Recharge';
}

function mapPaymentMethod(order) {
  if (order.purpose === 'vip') {
    const plan = order.planId ? String(order.planId) : 'plan';
    return `Razorpay · VIP ${plan}`;
  }
  return 'Razorpay';
}

function toTransactionItem(order, caller) {
  const when = order.paidAt || order.updatedAt || order.createdAt;
  return {
    id: order.id,
    code: order.id,
    userId: callerCode(caller) || order.userId || '—',
    userName: (caller && caller.name) || 'Unknown',
    userEmail: (caller && caller.email) || '',
    callerId: order.userId || '',
    type: mapType(order.purpose),
    purpose: order.purpose || 'recharge',
    planId: order.planId || null,
    amount: Number(order.amount) || 0,
    coins: Number(order.coins) || 0,
    dateTime: when ? new Date(when).toISOString() : new Date().toISOString(),
    dateTimeLabel: formatDateTimeLabel(when),
    status: mapStatus(order.status),
    orderStatus: order.status || 'created',
    ipAddress: '—',
    paymentMethod: mapPaymentMethod(order),
    gatewayId: order.razorpayPaymentId || order.id,
    category: mapCategory(order.purpose),
    currency: order.currency || 'INR',
  };
}

function purposeFromTypeFilter(type) {
  const t = String(type || 'all').toLowerCase();
  if (t === 'all' || !t) return null;
  if (t === 'vip') return 'vip';
  if (
    t === 'recharge' ||
    t === 'upi' ||
    t === 'card' ||
    t === 'wallet' ||
    t === 'netbanking'
  ) {
    return 'recharge';
  }
  return null;
}

function statusFromFilter(status) {
  const s = String(status || 'all').toLowerCase();
  if (s === 'successful' || s === 'paid') return 'paid';
  if (s === 'failed') return 'failed';
  if (s === 'pending' || s === 'created') return 'created';
  return null;
}

async function getTransactionStats() {
  const [totals] = await Order.aggregate([
    {
      $facet: {
        all: [{$count: 'count'}],
        paidVip: [
          {$match: {status: 'paid', purpose: 'vip'}},
          {$count: 'count'},
        ],
        revenue: [
          {$match: {status: 'paid'}},
          {$group: {_id: null, total: {$sum: {$ifNull: ['$amount', 0]}}}},
        ],
      },
    },
  ]);

  const totalTransactions = totals?.all?.[0]?.count || 0;
  const vipPurchases = totals?.paidVip?.[0]?.count || 0;
  const totalRevenue = totals?.revenue?.[0]?.total || 0;

  return {
    totalTransactions,
    vipPurchases,
    totalRevenue,
    totalRevenueLabel: formatInrLabel(totalRevenue),
  };
}

async function listTransactions({
  q,
  type,
  status,
  page = 1,
  limit = 10,
  dateFrom,
  dateTo,
} = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 10));
  const filter = {};

  const purpose = purposeFromTypeFilter(type);
  if (purpose) filter.purpose = purpose;

  const orderStatus = statusFromFilter(status);
  if (orderStatus) filter.status = orderStatus;

  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) {
      const from = new Date(dateFrom);
      if (!Number.isNaN(from.getTime())) filter.createdAt.$gte = from;
    }
    if (dateTo) {
      const to = new Date(dateTo);
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = to;
      }
    }
    if (!Object.keys(filter.createdAt).length) delete filter.createdAt;
  }

  const queryText = String(q || '').trim();
  let userIds = null;
  if (queryText) {
    const callers = await Caller.find({
      $or: [
        {name: {$regex: queryText, $options: 'i'}},
        {email: {$regex: queryText, $options: 'i'}},
        {id: {$regex: queryText, $options: 'i'}},
        {phone: {$regex: queryText, $options: 'i'}},
      ],
    })
      .select('id')
      .lean();
    userIds = callers.map(c => c.id);
    filter.$or = [
      {id: {$regex: queryText, $options: 'i'}},
      {razorpayPaymentId: {$regex: queryText, $options: 'i'}},
      ...(userIds.length ? [{userId: {$in: userIds}}] : []),
    ];
  }

  const [total, orders] = await Promise.all([
    Order.countDocuments(filter),
    Order.find(filter)
      .sort({createdAt: -1})
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
  ]);

  const callerIds = [...new Set(orders.map(o => o.userId).filter(Boolean))];
  const callers = callerIds.length
    ? await Caller.find({id: {$in: callerIds}})
        .select('id name email phone')
        .lean()
    : [];
  const callerMap = new Map(callers.map(c => [c.id, c]));

  const transactions = orders.map(order =>
    toTransactionItem(order, callerMap.get(order.userId)),
  );

  return {
    transactions,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
    },
  };
}

async function getTransactionDetail(id) {
  const rawId = String(id || '').replace(/^#/, '').trim();
  if (!rawId) {
    return {ok: false, message: 'Transaction not found.'};
  }

  const order = await Order.findOne({
    $or: [{id: rawId}, {razorpayPaymentId: rawId}],
  }).lean();

  if (!order) {
    return {ok: false, message: 'Transaction not found.'};
  }

  const caller = await Caller.findOne({id: order.userId})
    .select('id name email phone')
    .lean();

  return {
    ok: true,
    transaction: toTransactionItem(order, caller),
  };
}

module.exports = {
  getTransactionStats,
  listTransactions,
  getTransactionDetail,
};
