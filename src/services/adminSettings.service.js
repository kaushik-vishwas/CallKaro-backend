const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {config} = require('../config');
const Admin = require('../models/Admin');
const Order = require('../models/Order');
const Withdrawal = require('../models/Withdrawal');
const adminService = require('./admin.service');

const BANK_CHALLENGE_TTL_SEC = 15 * 60;

function formatDateLabel(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatInr(value) {
  const n = Number(value) || 0;
  return `₹ ${n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function maskPhone(phone) {
  const raw = String(phone || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 4) return raw || 'Not set';
  const tail = digits.slice(-3);
  const prefix = digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : '+91 ';
  return `${prefix}*******${tail}`;
}

function maskIban(iban) {
  const value = String(iban || '').replace(/\s/g, '');
  if (!value) return '';
  if (value.length <= 8) return value;
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(0, value.length - 6))}${value.slice(-4)}`;
}

function publicBank(bank = {}) {
  const iban = String(bank.iban || '');
  return {
    accountHolder: bank.accountHolder || '',
    bankName: bank.bankName || '',
    iban,
    ibanMasked: maskIban(iban) || '—',
    swift: bank.swift || '',
    branchName: bank.branchName || '',
    country: bank.country || 'India',
    accountType: bank.accountType === 'current' ? 'current' : 'savings',
    verified: Boolean(bank.verified && iban),
    updatedAt: bank.updatedAt || null,
    updatedAtLabel: bank.updatedAt ? formatDateLabel(bank.updatedAt) : '',
    reference: bank.reference || '',
  };
}

function publicAdminSettings(admin) {
  const base = adminService.publicAdmin(admin);
  return {
    ...base,
    role: 'Super Admin',
    status: admin.isActive ? 'Active' : 'Inactive',
    phoneMasked: maskPhone(admin.phone),
    twoFactorEnabled: admin.twoFactorEnabled !== false,
    passwordChangedAt: admin.passwordChangedAt || admin.updatedAt || null,
    passwordChangedAtLabel: formatDateLabel(
      admin.passwordChangedAt || admin.updatedAt,
    ),
    lastLoginAt: admin.lastLoginAt || null,
    lastLoginAtLabel: formatDateLabel(admin.lastLoginAt),
    activeSessions: 1,
    activeSessionsLabel: '1 device (this browser)',
    createdAt: admin.createdAt || null,
    bank: publicBank(admin.bank || {}),
  };
}

function signBankChallenge(adminId) {
  return jwt.sign(
    {sub: adminId, purpose: 'admin-bank-update'},
    config.jwtSecret,
    {expiresIn: BANK_CHALLENGE_TTL_SEC},
  );
}

function verifyBankChallenge(token, adminId) {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.purpose !== 'admin-bank-update') return false;
    if (String(payload.sub) !== String(adminId)) return false;
    return true;
  } catch {
    return false;
  }
}

async function getSettingsProfile(adminId) {
  const admin = await Admin.findOne({id: adminId});
  if (!admin) return {ok: false, message: 'Admin not found.'};
  return {ok: true, admin: publicAdminSettings(admin)};
}

async function updateProfile(adminId, payload = {}) {
  const admin = await Admin.findOne({id: adminId});
  if (!admin) return {ok: false, message: 'Admin not found.'};

  if (payload.name !== undefined) {
    const name = String(payload.name || '').trim();
    if (!name) return {ok: false, message: 'Name is required.'};
    admin.name = name;
  }
  if (payload.phone !== undefined) {
    admin.phone = String(payload.phone || '').trim();
  }
  if (payload.avatarUrl !== undefined) {
    admin.avatarUrl = String(payload.avatarUrl || '').trim();
  }
  if (payload.twoFactorEnabled !== undefined) {
    admin.twoFactorEnabled = Boolean(payload.twoFactorEnabled);
  }

  await admin.save();
  return {ok: true, admin: publicAdminSettings(admin)};
}

async function changePassword(adminId, currentPassword, newPassword) {
  const admin = await Admin.findOne({id: adminId});
  if (!admin) return {ok: false, message: 'Admin not found.'};

  const match = await bcrypt.compare(String(currentPassword || ''), admin.passwordHash);
  if (!match) return {ok: false, message: 'Current password is incorrect.'};

  if (String(newPassword || '').length < 8) {
    return {ok: false, message: 'New password must be at least 8 characters.'};
  }

  admin.passwordHash = await bcrypt.hash(String(newPassword), 10);
  admin.passwordChangedAt = new Date();
  await admin.save();
  return {ok: true, admin: publicAdminSettings(admin)};
}

async function getWalletSnapshot() {
  const [revenueAgg, pendingAgg, paidAgg, lastPaid] = await Promise.all([
    Order.aggregate([
      {$match: {status: 'paid'}},
      {$group: {_id: null, total: {$sum: {$ifNull: ['$amount', 0]}}}},
    ]),
    Withdrawal.aggregate([
      {
        $match: {
          status: {$in: ['pending_review', 'approved', 'otp_pending']},
        },
      },
      {$group: {_id: null, total: {$sum: {$ifNull: ['$amountInr', 0]}}}},
    ]),
    Withdrawal.aggregate([
      {$match: {status: 'paid'}},
      {$group: {_id: null, total: {$sum: {$ifNull: ['$amountInr', 0]}}}},
    ]),
    Withdrawal.findOne({status: 'paid'}).sort({paidAt: -1, createdAt: -1}).lean(),
  ]);

  const revenue = Number(revenueAgg?.[0]?.total) || 0;
  const pending = Number(pendingAgg?.[0]?.total) || 0;
  const paidOut = Number(paidAgg?.[0]?.total) || 0;
  const available = Math.max(0, revenue - paidOut);

  return {
    availableBalance: available,
    availableBalanceLabel: formatInr(available),
    pendingSettlements: pending,
    pendingSettlementsLabel: formatInr(pending),
    lastPayoutAmount: lastPaid ? Number(lastPaid.amountInr) || 0 : 0,
    lastPayoutAt: lastPaid?.paidAt || lastPaid?.createdAt || null,
    lastPayoutLabel: lastPaid
      ? `${formatInr(lastPaid.amountInr)} · ${formatDateLabel(lastPaid.paidAt || lastPaid.createdAt)}`
      : 'No payouts yet',
    totalRevenue: revenue,
    totalPaidOut: paidOut,
  };
}

function getHelpSupport() {
  return {
    email: process.env.SUPPORT_EMAIL || 'support@callkaro.com',
    phone: process.env.SUPPORT_PHONE || '+91 1800 000 2244',
    hours: process.env.SUPPORT_HOURS || 'Mon–Sat, 9:00 AM – 7:00 PM IST',
  };
}

async function sendBankOtp(adminId) {
  const admin = await Admin.findOne({id: adminId});
  if (!admin) return {ok: false, message: 'Admin not found.'};

  const otpInfo = await adminService.saveAdminOtp(admin.email, 'admin-bank');
  return {
    ok: true,
    email: admin.email,
    phoneMasked: maskPhone(admin.phone),
    destination: admin.phone
      ? maskPhone(admin.phone)
      : admin.email,
    channel: admin.phone ? 'phone' : 'email',
    otpExpiresInMinutes: otpInfo.otpExpiresInMinutes,
    debugOtp: otpInfo.otp,
  };
}

async function verifyBankOtp(adminId, otp) {
  const admin = await Admin.findOne({id: adminId});
  if (!admin) return {ok: false, message: 'Admin not found.'};

  const otpResult = await adminService.verifyAdminOtp(
    admin.email,
    otp,
    'admin-bank',
  );
  if (!otpResult.ok) return otpResult;

  const bankChallengeToken = signBankChallenge(admin.id);
  return {
    ok: true,
    bankChallengeToken,
    expiresInMinutes: Math.round(BANK_CHALLENGE_TTL_SEC / 60),
  };
}

async function confirmBankUpdate(adminId, bankChallengeToken, payload = {}) {
  const admin = await Admin.findOne({id: adminId});
  if (!admin) return {ok: false, message: 'Admin not found.'};

  if (!verifyBankChallenge(bankChallengeToken, admin.id)) {
    return {
      ok: false,
      message: 'Bank verification expired. Please verify OTP again.',
    };
  }

  const accountHolder = String(payload.accountHolder || '').trim();
  const bankName = String(payload.bankName || '').trim();
  const iban = String(payload.iban || '').replace(/\s/g, '').toUpperCase();
  const swift = String(payload.swift || '').trim().toUpperCase();
  const branchName = String(payload.branchName || '').trim();
  const country = String(payload.country || 'India').trim();
  const accountType =
    payload.accountType === 'current' ? 'current' : 'savings';

  if (!accountHolder || !bankName || !iban || !swift || !branchName) {
    return {ok: false, message: 'All bank fields are required.'};
  }

  const reference = `BNK-${new Date().getFullYear()}-${crypto
    .randomBytes(3)
    .toString('hex')
    .toUpperCase()}`;

  admin.bank = {
    accountHolder,
    bankName,
    iban,
    swift,
    branchName,
    country,
    accountType,
    verified: true,
    updatedAt: new Date(),
    reference,
  };
  admin.markModified('bank');
  await admin.save();

  return {
    ok: true,
    admin: publicAdminSettings(admin),
    bank: publicBank(admin.bank),
    reference,
    updatedOnLabel: new Date().toLocaleString('en-IN', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }),
  };
}

module.exports = {
  publicAdminSettings,
  getSettingsProfile,
  updateProfile,
  changePassword,
  getWalletSnapshot,
  getHelpSupport,
  sendBankOtp,
  verifyBankOtp,
  confirmBankUpdate,
  publicBank,
};

// Re-export helpers used by admin.service updates if needed
module.exports._maskPhone = maskPhone;
