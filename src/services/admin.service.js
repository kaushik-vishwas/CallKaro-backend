const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {config} = require('../config');
const Admin = require('../models/Admin');
const Otp = require('../models/Otp');
const {sendOtpEmail, isEmailConfigured} = require('./email.service');
const {
  signToken,
  signChallengeToken,
  verifyChallengeToken,
} = require('../middleware/auth');
const {ensureDemoAdmin} = require('../bootstrap/ensureDemoAdmin');

const ADMIN_OTP_LENGTH = 6;
const DEMO_ADMIN_EMAIL = 'admin@callkaro.com';
const DEMO_ADMIN_PASSWORD = 'password123';

function publicAdmin(admin) {
  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    phone: admin.phone || '',
    avatarUrl: admin.avatarUrl || '',
  };
}

function generateAdminOtp() {
  const max = 10 ** ADMIN_OTP_LENGTH;
  const num = crypto.randomInt(0, max);
  return String(num).padStart(ADMIN_OTP_LENGTH, '0');
}

async function findAdminByEmail(email) {
  return Admin.findOne({email: String(email).toLowerCase().trim()});
}

async function findAdminById(id) {
  return Admin.findOne({id});
}

async function saveAdminOtp(email, purpose) {
  const hasEmailConfig = isEmailConfigured();
  // Prefer real 6-digit OTP when email works; otherwise use padded DEV_OTP.
  const otp = hasEmailConfig
    ? generateAdminOtp()
    : String(config.devOtp || '123456').padStart(ADMIN_OTP_LENGTH, '0').slice(-ADMIN_OTP_LENGTH);
  const expiresAt = new Date(Date.now() + config.otpTtlMinutes * 60 * 1000);
  const normalizedEmail = email.toLowerCase();

  await Otp.findOneAndUpdate(
    {email: normalizedEmail, purpose},
    {email: normalizedEmail, purpose, otp, expiresAt},
    {upsert: true, new: true, setDefaultsOnInsert: true},
  );

  const emailResult = await sendOtpEmail({
    to: normalizedEmail,
    otp,
    purpose,
  });

  console.log(
    `[OTP] ${purpose} for ${email}: ${otp} (expires in ${config.otpTtlMinutes}m, emailed=${emailResult.sent})`,
  );

  // Expose OTP when email wasn't delivered, or when sending to a non-inbox
  // address (e.g. demo admin@callkaro.com) so local login still works.
  const configuredInbox = String(config.emailUser || '').toLowerCase();
  const canReceive =
    Boolean(configuredInbox) && normalizedEmail === configuredInbox;
  const exposeOtp = !emailResult.sent || !canReceive;

  return {
    otp: exposeOtp ? otp : undefined,
    otpExpiresInMinutes: config.otpTtlMinutes,
    emailSent: emailResult.sent,
  };
}

async function verifyAdminOtp(email, otp, purpose) {
  const record = await Otp.findOne({
    email: String(email).toLowerCase(),
    purpose,
  });

  if (!record) {
    return {ok: false, message: 'OTP not found. Please request a new one.'};
  }
  if (Date.now() > new Date(record.expiresAt).getTime()) {
    return {ok: false, message: 'OTP expired. Please request a new one.'};
  }
  if (String(record.otp) !== String(otp)) {
    return {ok: false, message: 'Invalid OTP.'};
  }

  await Otp.deleteOne({_id: record._id});
  return {ok: true};
}

/**
 * Step 1: email + password → challenge + 2FA OTP email.
 */
async function login(email, password) {
  let admin = await findAdminByEmail(email);

  // First-run convenience: create demo admin if credentials match and none exists.
  if (
    !admin &&
    String(email).toLowerCase().trim() === DEMO_ADMIN_EMAIL &&
    String(password) === DEMO_ADMIN_PASSWORD
  ) {
    await ensureDemoAdmin();
    admin = await findAdminByEmail(email);
  }

  if (!admin || !admin.isActive) {
    return {ok: false, message: 'Invalid email or password.'};
  }

  const match = await bcrypt.compare(String(password), admin.passwordHash);
  if (!match) {
    return {ok: false, message: 'Invalid email or password.'};
  }

  const otpInfo = await saveAdminOtp(admin.email, 'admin-login');
  const challengeToken = signChallengeToken(admin);

  return {
    ok: true,
    requires2fa: true,
    challengeToken,
    email: admin.email,
    otpExpiresInMinutes: otpInfo.otpExpiresInMinutes,
    debugOtp: otpInfo.otp,
  };
}

/**
 * Step 2: challenge + OTP → session JWT.
 */
async function verifyLoginOtp(challengeToken, otp) {
  let payload;
  try {
    payload = verifyChallengeToken(challengeToken);
  } catch {
    return {ok: false, message: 'Login session expired. Please sign in again.'};
  }

  const admin = await findAdminById(payload.sub);
  if (!admin || !admin.isActive) {
    return {ok: false, message: 'Admin account not found.'};
  }

  const otpResult = await verifyAdminOtp(admin.email, otp, 'admin-login');
  if (!otpResult.ok) return otpResult;

  const token = signToken(admin, {role: 'admin'});
  return {ok: true, token, admin};
}

async function resendLoginOtp(challengeToken) {
  let payload;
  try {
    payload = verifyChallengeToken(challengeToken);
  } catch {
    return {ok: false, message: 'Login session expired. Please sign in again.'};
  }

  const admin = await findAdminById(payload.sub);
  if (!admin || !admin.isActive) {
    return {ok: false, message: 'Admin account not found.'};
  }

  const otpInfo = await saveAdminOtp(admin.email, 'admin-login');
  return {
    ok: true,
    otpExpiresInMinutes: otpInfo.otpExpiresInMinutes,
    debugOtp: otpInfo.otp,
  };
}

async function requestPasswordReset(email) {
  const admin = await findAdminByEmail(email);
  // Always succeed to avoid email enumeration
  if (!admin || !admin.isActive) {
    return {
      ok: true,
      message: 'If an account exists, a reset code has been sent.',
    };
  }

  const otpInfo = await saveAdminOtp(admin.email, 'admin-reset');
  return {
    ok: true,
    message: 'If an account exists, a reset code has been sent.',
    email: admin.email,
    otpExpiresInMinutes: otpInfo.otpExpiresInMinutes,
    debugOtp: otpInfo.otp,
  };
}

async function resetPassword({email, otp, newPassword}) {
  const admin = await findAdminByEmail(email);
  if (!admin || !admin.isActive) {
    return {ok: false, message: 'Invalid reset request.'};
  }

  const otpResult = await verifyAdminOtp(admin.email, otp, 'admin-reset');
  if (!otpResult.ok) return otpResult;

  if (String(newPassword).length < 8) {
    return {ok: false, message: 'Password must be at least 8 characters.'};
  }

  admin.passwordHash = await bcrypt.hash(String(newPassword), 10);
  await admin.save();
  return {ok: true};
}

module.exports = {
  publicAdmin,
  findAdminByEmail,
  findAdminById,
  login,
  verifyLoginOtp,
  resendLoginOtp,
  requestPasswordReset,
  resetPassword,
};
