const crypto = require('crypto');
const Receiver = require('../models/Receiver');
const Withdrawal = require('../models/Withdrawal');
const EarningLedger = require('../models/EarningLedger');
const {config} = require('../config');

const FEE_RATE = Number(process.env.WITHDRAW_FEE_RATE || 0.03);
const MIN_BALANCE_INR = Number(process.env.WITHDRAW_MIN_BALANCE_INR || 1000);
const MIN_WITHDRAW_INR = Number(process.env.WITHDRAW_MIN_AMOUNT_INR || 100);
const OTP_TTL_MS = 5 * 60 * 1000;

function maskAccount(accountNumber) {
  const digits = String(accountNumber || '').replace(/\D/g, '');
  if (digits.length < 4) {
    return '----';
  }
  return `----${digits.slice(-4)}`;
}

function bankNameFromIfsc(ifsc) {
  const code = String(ifsc || '')
    .trim()
    .toUpperCase()
    .slice(0, 4);
  const map = {
    HDFC: 'HDFC Bank',
    SBIN: 'State Bank of India',
    ICIC: 'ICICI Bank',
    UTIB: 'Axis Bank',
    PUNB: 'Punjab National Bank',
    YESB: 'Yes Bank',
    KKBK: 'Kotak Mahindra Bank',
  };
  return map[code] || (code ? `${code} Bank` : 'Bank');
}

function publicBank(receiver) {
  const bank = receiver?.bank || {};
  const accountNumber = String(bank.accountNumber || '');
  const ifsc = String(bank.ifsc || '').toUpperCase();
  return {
    holderName: String(bank.holderName || receiver?.name || ''),
    bankName: String(bank.bankName || bankNameFromIfsc(ifsc)),
    accountType: String(bank.accountType || 'Savings'),
    accountNumber,
    accountMasked: maskAccount(accountNumber),
    ifsc,
    branch: String(bank.branch || ''),
    upiId: String(bank.upiId || ''),
    verified: Boolean(accountNumber && ifsc && bank.holderName),
  };
}

function calcFee(amountInr) {
  const amount = Math.max(0, Math.round(Number(amountInr) || 0));
  const feeInr = Math.round(amount * FEE_RATE);
  return {
    amountInr: amount,
    feeRate: FEE_RATE,
    feeInr,
    netInr: Math.max(0, amount - feeInr),
  };
}

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

function formatWhen(date) {
  if (!date) {
    return '';
  }
  const d = new Date(date);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `Today · ${d.toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) {
    return 'Yesterday';
  }
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
}

function publicWithdrawal(doc) {
  const row = doc.toObject ? doc.toObject() : doc;
  return {
    id: row.id,
    amountInr: Number(row.amountInr) || 0,
    feeInr: Number(row.feeInr) || 0,
    feeRate: Number(row.feeRate) || FEE_RATE,
    netInr: Number(row.netInr) || 0,
    status: row.status,
    bank: row.bankSnapshot || {},
    utr: row.utr || '',
    paidAt: row.paidAt || null,
    paidAtLabel: row.paidAt
      ? new Date(row.paidAt).toLocaleString('en-IN', {
          day: 'numeric',
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })
      : '',
    failureReason: row.failureReason || '',
    walletBalanceAfter:
      row.walletBalanceAfter != null ? Number(row.walletBalanceAfter) : null,
    createdAt: row.createdAt,
  };
}

async function getWalletSummary(receiverId) {
  const receiver = await Receiver.findOne({id: receiverId});
  if (!receiver) {
    return {ok: false, message: 'Receiver not found.', status: 404};
  }

  const balanceInr = Math.max(0, Number(receiver.walletBalance) || 0);
  const pendingEarnings = Math.max(0, Number(receiver.pendingEarnings) || 0);

  const [ledgerRows, withdrawalRows] = await Promise.all([
    EarningLedger.find({receiverId})
      .sort({createdAt: -1})
      .limit(30)
      .lean(),
    Withdrawal.find({
      receiverId,
      status: {$in: ['paid', 'pending_review', 'failed']},
    })
      .sort({createdAt: -1})
      .limit(20)
      .lean(),
  ]);

  const bySource = {video_call: 0, gift: 0, chat: 0};
  for (const row of ledgerRows) {
    if (row.source === 'video_call') {
      bySource.video_call += Number(row.amountInr) || 0;
    } else if (row.source === 'gift') {
      bySource.gift += Number(row.amountInr) || 0;
    } else if (row.source === 'chat') {
      bySource.chat += Number(row.amountInr) || 0;
    }
  }
  const totalBreakdown =
    bySource.video_call + bySource.gift + bySource.chat || 1;

  const breakdown = [
    {
      id: 'video',
      label: 'Video calls',
      amountInr: Math.round(bySource.video_call),
      color: '#FF4D8D',
      ratio: bySource.video_call / totalBreakdown,
    },
    {
      id: 'gifts',
      label: 'Gifts received',
      amountInr: Math.round(bySource.gift),
      color: '#F5C518',
      ratio: bySource.gift / totalBreakdown,
    },
    {
      id: 'chats',
      label: 'Chats',
      amountInr: Math.round(bySource.chat),
      color: '#7C3AED',
      ratio: bySource.chat / totalBreakdown,
    },
  ];

  const incomeTx = ledgerRows
    .filter(row => row.source !== 'withdrawal')
    .map(row => ({
      id: row.id,
      type: 'income',
      title:
        row.source === 'gift'
          ? `Gift${row.meta?.giftName ? ` - ${row.meta.giftName}` : ''}`
          : row.source === 'chat'
            ? 'Chat earnings'
            : 'Call earnings',
      when: formatWhen(row.createdAt),
      amountInr: Math.round(Number(row.amountInr) || 0),
      status: 'CLEARED',
      createdAt: row.createdAt,
    }));

  const withdrawTx = withdrawalRows.map(row => ({
    id: row.id,
    type: 'withdrawal',
    title: `Withdrawal to ${row.bankSnapshot?.accountMasked || 'bank'}`,
    when: formatWhen(row.paidAt || row.createdAt),
    amountInr: Math.round(Number(row.amountInr) || 0),
    status:
      row.status === 'paid'
        ? 'TRANSFERRED'
        : row.status === 'failed'
          ? 'FAILED'
          : 'PENDING',
    createdAt: row.paidAt || row.createdAt,
  }));

  const transactions = [...incomeTx, ...withdrawTx]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 40)
    .map(({createdAt, ...rest}) => rest);

  const maxWithdrawable = Math.max(0, balanceInr - MIN_BALANCE_INR);

  return {
    ok: true,
    wallet: {
      balanceInr: Math.round(balanceInr),
      pendingEarnings: Math.round(pendingEarnings),
      minBalanceInr: MIN_BALANCE_INR,
      minWithdrawInr: MIN_WITHDRAW_INR,
      maxWithdrawable: Math.round(maxWithdrawable),
      feeRate: FEE_RATE,
      nextWithdrawDays: 0,
      bank: publicBank(receiver),
      breakdown,
      transactions,
      quickAmounts: [2000, 5000, 10000].filter(v => v <= maxWithdrawable),
    },
  };
}

async function getBank(receiverId) {
  const receiver = await Receiver.findOne({id: receiverId});
  if (!receiver) {
    return {ok: false, message: 'Receiver not found.', status: 404};
  }
  return {ok: true, bank: publicBank(receiver)};
}

async function updateBank(receiverId, body = {}) {
  const receiver = await Receiver.findOne({id: receiverId});
  if (!receiver) {
    return {ok: false, message: 'Receiver not found.', status: 404};
  }

  const holderName = String(body.holderName || '').trim();
  const accountNumber = String(body.accountNumber || '')
    .replace(/\s+/g, '')
    .trim();
  const ifsc = String(body.ifsc || '')
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase();
  const bankName = String(body.bankName || '').trim();
  const branch = String(body.branch || '').trim();
  const accountType = String(body.accountType || 'Savings').trim();
  const upiId = String(body.upiId || '').trim();

  if (!holderName || accountNumber.length < 6 || ifsc.length < 8) {
    return {
      ok: false,
      message: 'Holder name, valid account number, and IFSC are required.',
      status: 400,
    };
  }

  receiver.bank = {
    holderName,
    accountNumber,
    ifsc,
    upiId: upiId || receiver.bank?.upiId || '',
    bankName: bankName || bankNameFromIfsc(ifsc),
    branch,
    accountType: accountType || 'Savings',
  };
  receiver.markModified('bank');
  await receiver.save();
  return {ok: true, bank: publicBank(receiver)};
}

async function createWithdrawal(receiverId, amountInr) {
  const receiver = await Receiver.findOne({id: receiverId});
  if (!receiver) {
    return {ok: false, message: 'Receiver not found.', status: 404};
  }
  if (receiver.status !== 'active') {
    return {
      ok: false,
      message: 'Only active receivers can withdraw.',
      status: 403,
    };
  }

  const bank = publicBank(receiver);
  if (!bank.verified) {
    return {
      ok: false,
      message: 'Add verified bank details before withdrawing.',
      status: 400,
    };
  }

  const balanceInr = Math.max(0, Number(receiver.walletBalance) || 0);
  const fees = calcFee(amountInr);
  if (fees.amountInr < MIN_WITHDRAW_INR) {
    return {
      ok: false,
      message: `Minimum withdrawal is ₹${MIN_WITHDRAW_INR}.`,
      status: 400,
    };
  }
  const maxWithdrawable = Math.max(0, balanceInr - MIN_BALANCE_INR);
  if (fees.amountInr > maxWithdrawable) {
    return {
      ok: false,
      message: `You can withdraw up to ₹${Math.round(maxWithdrawable).toLocaleString('en-IN')} (₹${MIN_BALANCE_INR} must remain).`,
      status: 400,
    };
  }

  const pending = await Withdrawal.findOne({
    receiverId,
    status: {$in: ['otp_pending', 'pending_review']},
  }).lean();
  if (pending) {
    return {
      ok: false,
      message: 'You already have a withdrawal in progress.',
      status: 409,
      withdrawal: publicWithdrawal(pending),
    };
  }

  const otp = String(config.devOtp || '1234').padStart(4, '0').slice(0, 6);
  const withdrawal = await Withdrawal.create({
    receiverId,
    amountInr: fees.amountInr,
    feeInr: fees.feeInr,
    feeRate: fees.feeRate,
    netInr: fees.netInr,
    status: 'otp_pending',
    bankSnapshot: {
      holderName: bank.holderName,
      bankName: bank.bankName,
      accountType: bank.accountType,
      accountMasked: bank.accountMasked,
      accountNumber: bank.accountNumber,
      ifsc: bank.ifsc,
      branch: bank.branch,
    },
    otpHash: hashOtp(otp),
    otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  console.log(
    `[withdraw] OTP for ${receiverId} / ${withdrawal.id}: ${otp} (expires in 5m)`,
  );

  try {
    const notificationService = require('./notification.service');
    await notificationService.createForReceiver({
      receiverId,
      type: 'withdraw_submitted',
      title: 'Withdrawal submitted',
      body: `Your withdrawal of ₹${fees.amountInr.toLocaleString('en-IN')} was submitted. Verify OTP to continue.`,
      data: {amountInr: fees.amountInr, withdrawalId: withdrawal.id},
      dedupeMinutes: 2,
    });
  } catch {
    /* optional */
  }

  return {
    ok: true,
    withdrawal: publicWithdrawal(withdrawal),
    // Local/dev only — never expose OTP in production builds.
    otpHint:
      process.env.NODE_ENV === 'production' ? undefined : otp,
  };
}

async function verifyWithdrawalOtp(receiverId, withdrawalId, otp) {
  const withdrawal = await Withdrawal.findOne({
    id: withdrawalId,
    receiverId,
  });
  if (!withdrawal) {
    return {ok: false, message: 'Withdrawal not found.', status: 404};
  }
  if (withdrawal.status !== 'otp_pending') {
    return {
      ok: false,
      message: `Withdrawal is already ${withdrawal.status}.`,
      status: 409,
      withdrawal: publicWithdrawal(withdrawal),
    };
  }
  if (
    withdrawal.otpExpiresAt &&
    new Date(withdrawal.otpExpiresAt).getTime() < Date.now()
  ) {
    withdrawal.status = 'failed';
    withdrawal.failureReason = 'OTP expired';
    await withdrawal.save();
    return {ok: false, message: 'OTP expired. Start a new withdrawal.', status: 400};
  }

  const incoming = String(otp || '').replace(/\D/g, '');
  if (!incoming || hashOtp(incoming) !== withdrawal.otpHash) {
    return {ok: false, message: 'Invalid OTP.', status: 400};
  }

  const receiver = await Receiver.findOne({id: receiverId});
  if (!receiver) {
    return {ok: false, message: 'Receiver not found.', status: 404};
  }

  const balanceInr = Math.max(0, Number(receiver.walletBalance) || 0);
  if (balanceInr < withdrawal.amountInr) {
    withdrawal.status = 'failed';
    withdrawal.failureReason = 'Insufficient wallet balance';
    await withdrawal.save();
    return {ok: false, message: 'Insufficient wallet balance.', status: 400};
  }

  receiver.walletBalance = balanceInr - withdrawal.amountInr;
  await receiver.save();

  await EarningLedger.create({
    receiverId,
    callerId: null,
    source: 'withdrawal',
    coins: 0,
    amountInr: withdrawal.amountInr,
    referenceId: withdrawal.id,
    meta: {
      feeInr: withdrawal.feeInr,
      netInr: withdrawal.netInr,
      direction: 'debit',
    },
  }).catch(() => undefined);

  const utr = `CK${Date.now().toString().slice(-10)}${Math.floor(
    Math.random() * 90 + 10,
  )}`;
  withdrawal.status = 'paid';
  withdrawal.utr = utr;
  withdrawal.paidAt = new Date();
  withdrawal.walletBalanceAfter = receiver.walletBalance;
  withdrawal.otpHash = '';
  await withdrawal.save();

  try {
    const notificationService = require('./notification.service');
    await notificationService.createForReceiver({
      receiverId,
      type: 'withdraw_under_review',
      title: 'Withdrawal under review',
      body: `Your withdrawal of ₹${withdrawal.amountInr.toLocaleString('en-IN')} is being processed.`,
      data: {amountInr: withdrawal.amountInr, withdrawalId: withdrawal.id},
      dedupeMinutes: 2,
    });
    await notificationService.createForReceiver({
      receiverId,
      type: 'withdraw_success',
      title: 'Withdrawal successful',
      body: `₹${withdrawal.netInr.toLocaleString('en-IN')} was transferred to ${withdrawal.bankSnapshot?.bankName || 'your bank'} ${withdrawal.bankSnapshot?.accountMasked || ''}.`,
      data: {
        amountInr: withdrawal.netInr,
        requestedInr: withdrawal.amountInr,
        withdrawalId: withdrawal.id,
        utr,
      },
    });
  } catch {
    /* optional */
  }

  return {
    ok: true,
    withdrawal: publicWithdrawal(withdrawal),
    walletBalance: Math.round(Number(receiver.walletBalance) || 0),
  };
}

async function getWithdrawal(receiverId, withdrawalId) {
  const row = await Withdrawal.findOne({id: withdrawalId, receiverId}).lean();
  if (!row) {
    return {ok: false, message: 'Withdrawal not found.', status: 404};
  }
  return {ok: true, withdrawal: publicWithdrawal(row)};
}

async function resendOtp(receiverId, withdrawalId) {
  const withdrawal = await Withdrawal.findOne({
    id: withdrawalId,
    receiverId,
    status: 'otp_pending',
  });
  if (!withdrawal) {
    return {ok: false, message: 'Withdrawal not found.', status: 404};
  }
  const otp = String(config.devOtp || '1234').padStart(4, '0').slice(0, 6);
  withdrawal.otpHash = hashOtp(otp);
  withdrawal.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
  await withdrawal.save();
  console.log(
    `[withdraw] Resent OTP for ${receiverId} / ${withdrawal.id}: ${otp}`,
  );
  return {
    ok: true,
    withdrawal: publicWithdrawal(withdrawal),
    otpHint: process.env.NODE_ENV === 'production' ? undefined : otp,
  };
}

module.exports = {
  getWalletSummary,
  getBank,
  updateBank,
  createWithdrawal,
  verifyWithdrawalOtp,
  getWithdrawal,
  resendOtp,
  calcFee,
  FEE_RATE,
  MIN_BALANCE_INR,
};
