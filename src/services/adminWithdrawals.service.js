const Withdrawal = require('../models/Withdrawal');
const Receiver = require('../models/Receiver');
const Order = require('../models/Order');

function formatInrCompact(value) {
  const n = Number(value) || 0;
  if (n >= 10000000) return `₹ ${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹ ${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹ ${(n / 1000).toFixed(1)}K`;
  return `₹ ${n.toLocaleString('en-IN')}`;
}

function formatRequestLabel(date) {
  if (!date) return '—';
  const d = new Date(date);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${hh}:${mm} ${dd}/${mo}/${yy}`;
}

function formatShortDate(date) {
  if (!date) return '—';
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mo}/${yy}`;
}

function mapAdminStatus(status) {
  if (status === 'paid') return 'successful';
  if (status === 'failed' || status === 'cancelled') return 'rejected';
  if (status === 'approved') return 'approved';
  if (status === 'pending_review' || status === 'otp_pending') return 'pending';
  return 'pending';
}

function mapUiStatusFilter(uiStatus) {
  const key = String(uiStatus || '').toLowerCase();
  if (key === 'successful' || key === 'paid') return {status: 'paid'};
  if (key === 'rejected') return {status: {$in: ['failed', 'cancelled']}};
  if (key === 'approved') return {status: 'approved'};
  if (key === 'pending') {
    return {status: {$in: ['pending_review', 'otp_pending']}};
  }
  return null;
}

function mapAccountStatus(receiver) {
  if (!receiver) return 'active';
  if (receiver.status === 'rejected') return 'blocked';
  if (receiver.status === 'inactive') return 'suspended';
  return 'active';
}

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'RV';
  return parts
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() || '')
    .join('');
}

function publicWithdrawal(row, receiver, recent = [], extras = {}) {
  const bank = receiver?.bank || {};
  const snapshot = row.bankSnapshot || {};
  const successCount = Number(extras.successCount);
  return {
    id: row.id,
    code: row.id,
    userId: row.receiverId,
    receiverName: receiver?.name || 'Receiver',
    initials: initials(receiver?.name),
    amount: Number(row.amountInr) || 0,
    feeInr: Number(row.feeInr) || 0,
    netInr: Number(row.netInr) || 0,
    requestDate: row.createdAt
      ? new Date(row.createdAt).toISOString()
      : new Date().toISOString(),
    requestDateLabel: formatRequestLabel(row.createdAt),
    status: mapAdminStatus(row.status),
    rawStatus: row.status,
    mobile: '',
    level: `Level ${receiver?.level || 1}`,
    accountStatus: mapAccountStatus(receiver),
    walletBalance: Number(receiver?.walletBalance) || 0,
    totalEarnings: Number(receiver?.earnings) || 0,
    pendingAmount:
      Number(receiver?.pendingEarnings) ||
      (['pending_review', 'approved', 'otp_pending'].includes(row.status)
        ? Number(row.amountInr) || 0
        : 0),
    prevWithdrawalsLabel: Number.isFinite(successCount)
      ? `${successCount} Success`
      : `${recent.filter(r => r.status === 'successful').length} Success`,
    bankName: snapshot.bankName || bank.bankName || '—',
    accountHolder:
      snapshot.holderName || bank.holderName || receiver?.name || '—',
    ifsc: snapshot.ifsc || bank.ifsc || '—',
    accountNumber:
      snapshot.accountNumber ||
      snapshot.accountMasked ||
      bank.accountNumber ||
      '—',
    utr: row.utr || '',
    paidAt: row.paidAt || null,
    paidAtLabel: row.paidAt ? formatRequestLabel(row.paidAt) : '',
    failureReason: row.failureReason || '',
    recentWithdrawals: recent,
  };
}

async function getWithdrawalStats() {
  const [wdCount, pendingCount, paidAgg, vipCount, revenueAgg] =
    await Promise.all([
      Withdrawal.countDocuments({}),
      Withdrawal.countDocuments({
        status: {$in: ['pending_review', 'approved', 'otp_pending']},
      }),
      Withdrawal.aggregate([
        {$match: {status: 'paid'}},
        {$group: {_id: null, total: {$sum: {$ifNull: ['$amountInr', 0]}}}},
      ]),
      Order.countDocuments({
        status: 'paid',
        purpose: 'vip',
      }),
      Order.aggregate([
        {$match: {status: 'paid'}},
        {$group: {_id: null, total: {$sum: {$ifNull: ['$amount', 0]}}}},
      ]),
    ]);

  const paidTotal = Number(paidAgg?.[0]?.total) || 0;
  const totalRevenue = Number(revenueAgg?.[0]?.total) || 0;

  return {
    totalTransactions: wdCount,
    pendingWithdrawals: pendingCount,
    paidWithdrawalsTotal: paidTotal,
    paidWithdrawalsLabel: formatInrCompact(paidTotal),
    vipPurchases: vipCount,
    totalRevenue,
    totalRevenueLabel: formatInrCompact(totalRevenue),
  };
}

async function buildFilter({
  q = '',
  dateFrom,
  dateTo,
  receiverId,
  agentId,
  status,
} = {}) {
  const filter = {};
  if (receiverId) {
    filter.receiverId = String(receiverId);
  } else if (agentId) {
    const team = await Receiver.find({agentId: String(agentId)})
      .select('id')
      .lean();
    const ids = team.map(r => r.id);
    filter.receiverId = {$in: ids.length ? ids : ['__none__']};
  }

  const statusFilter = mapUiStatusFilter(status);
  if (statusFilter) Object.assign(filter, statusFilter);

  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }

  const query = String(q || '').trim();
  if (query) {
    const rx = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const matchedReceivers = await Receiver.find({
      $or: [{name: rx}, {id: rx}, {loginEmail: rx}],
    })
      .select('id')
      .lean();
    const ids = matchedReceivers.map(r => r.id);
    filter.$or = [
      {id: rx},
      {receiverId: rx},
      ...(ids.length ? [{receiverId: {$in: ids}}] : []),
    ];
  }
  return filter;
}

async function listWithdrawals({
  q = '',
  sort = 'newest',
  page = 1,
  limit = 10,
  dateFrom,
  dateTo,
  receiverId,
  agentId,
  status,
} = {}) {
  const filter = await buildFilter({
    q,
    dateFrom,
    dateTo,
    receiverId,
    agentId,
    status,
  });

  let sortSpec = {createdAt: -1};
  if (sort === 'oldest') sortSpec = {createdAt: 1};
  if (sort === 'amount_high') sortSpec = {amountInr: -1};
  if (sort === 'amount_low') sortSpec = {amountInr: 1};

  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(limit) || 10));
  const skip = (pageNum - 1) * pageSize;

  const [total, rows] = await Promise.all([
    Withdrawal.countDocuments(filter),
    Withdrawal.find(filter)
      .sort(sortSpec)
      .skip(skip)
      .limit(pageSize)
      .lean(),
  ]);

  const receiverIds = [...new Set(rows.map(r => r.receiverId).filter(Boolean))];
  const receivers = await Receiver.find({id: {$in: receiverIds}}).lean();
  const receiverMap = new Map(receivers.map(r => [r.id, r]));

  const successCounts = await Withdrawal.aggregate([
    {
      $match: {
        receiverId: {$in: receiverIds},
        status: 'paid',
      },
    },
    {$group: {_id: '$receiverId', count: {$sum: 1}}},
  ]);
  const successMap = new Map(successCounts.map(r => [r._id, r.count]));

  const withdrawals = rows.map(row =>
    publicWithdrawal(row, receiverMap.get(row.receiverId), [], {
      successCount: successMap.get(row.receiverId) || 0,
    }),
  );

  return {
    withdrawals,
    pagination: {
      page: pageNum,
      limit: pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

async function getWithdrawalDetail(id) {
  const row = await Withdrawal.findOne({id}).lean();
  if (!row) return {ok: false, message: 'Withdrawal not found.'};

  const receiver = await Receiver.findOne({id: row.receiverId}).lean();
  const [recentRows, successCount] = await Promise.all([
    Withdrawal.find({
      receiverId: row.receiverId,
      id: {$ne: row.id},
    })
      .sort({createdAt: -1})
      .limit(8)
      .lean(),
    Withdrawal.countDocuments({
      receiverId: row.receiverId,
      status: 'paid',
    }),
  ]);

  const recent = recentRows.map(item => ({
    id: item.id,
    date: formatShortDate(item.createdAt),
    type: 'Money Withdrawal',
    amount: Number(item.amountInr) || 0,
    status: mapAdminStatus(item.status),
  }));

  return {
    ok: true,
    withdrawal: publicWithdrawal(row, receiver, recent, {successCount}),
  };
}

async function updateWithdrawalStatus(id, action, payload = {}) {
  const withdrawal = await Withdrawal.findOne({id});
  if (!withdrawal) return {ok: false, message: 'Withdrawal not found.'};

  const key = String(action || '').toLowerCase();
  const reason = String(payload.reason || '').trim();
  const utr = String(payload.utr || '').trim();

  if (key === 'approve') {
    if (!['pending_review', 'otp_pending'].includes(withdrawal.status)) {
      return {
        ok: false,
        message: `Cannot approve a withdrawal in ${withdrawal.status} state.`,
      };
    }
    withdrawal.status = 'approved';
    withdrawal.failureReason = '';
  } else if (key === 'reject') {
    if (
      !['pending_review', 'approved', 'otp_pending'].includes(withdrawal.status)
    ) {
      return {
        ok: false,
        message: `Cannot reject a withdrawal in ${withdrawal.status} state.`,
      };
    }
    const wasHoldingFunds = ['pending_review', 'approved'].includes(
      withdrawal.status,
    );
    withdrawal.status = 'failed';
    withdrawal.failureReason = reason || 'Rejected by admin';

    if (wasHoldingFunds) {
      const receiver = await Receiver.findOne({id: withdrawal.receiverId});
      if (receiver) {
        receiver.walletBalance =
          Math.max(0, Number(receiver.walletBalance) || 0) +
          (Number(withdrawal.amountInr) || 0);
        await receiver.save();
        withdrawal.walletBalanceAfter = receiver.walletBalance;
      }
    }
  } else if (key === 'pay' || key === 'mark_paid' || key === 'successful') {
    if (!['approved', 'pending_review'].includes(withdrawal.status)) {
      return {
        ok: false,
        message: `Cannot mark paid from ${withdrawal.status} state. Approve first.`,
      };
    }
    withdrawal.status = 'paid';
    withdrawal.utr =
      utr ||
      `CK${Date.now().toString().slice(-10)}${Math.floor(Math.random() * 90 + 10)}`;
    withdrawal.paidAt = new Date();
    withdrawal.failureReason = '';

    try {
      const notificationService = require('./notification.service');
      await notificationService.createForReceiver({
        receiverId: withdrawal.receiverId,
        type: 'withdraw_success',
        title: 'Withdrawal successful',
        body: `₹${Number(withdrawal.netInr || 0).toLocaleString('en-IN')} was transferred to ${withdrawal.bankSnapshot?.bankName || 'your bank'} ${withdrawal.bankSnapshot?.accountMasked || ''}.`,
        data: {
          amountInr: withdrawal.netInr,
          requestedInr: withdrawal.amountInr,
          withdrawalId: withdrawal.id,
          utr: withdrawal.utr,
        },
      });
    } catch {
      /* optional */
    }
  } else {
    return {ok: false, message: 'Invalid action.'};
  }

  await withdrawal.save();
  return getWithdrawalDetail(withdrawal.id);
}

module.exports = {
  getWithdrawalStats,
  listWithdrawals,
  getWithdrawalDetail,
  updateWithdrawalStatus,
};
