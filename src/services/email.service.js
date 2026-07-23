const nodemailer = require('nodemailer');
const {config} = require('../config');

let transporter = null;

function looksLikePlaceholder(value) {
  const v = String(value || '').toLowerCase();
  if (!v) {
    return true;
  }
  return (
    v.includes('your-email') ||
    v.includes('your-16-char') ||
    v.includes('example.com') ||
    v.includes('changeme') ||
    v.includes('placeholder')
  );
}

function isEmailConfigured() {
  return Boolean(
    config.emailUser &&
      config.emailAppPassword &&
      !looksLikePlaceholder(config.emailUser) &&
      !looksLikePlaceholder(config.emailAppPassword),
  );
}

function getTransporter() {
  if (!isEmailConfigured()) {
    return null;
  }

  if (transporter) {
    return transporter;
  }

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: config.emailUser,
      pass: config.emailAppPassword,
    },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 10_000,
  });

  return transporter;
}

async function sendOtpEmail({to, otp, purpose}) {
  const mailer = getTransporter();
  const subjectByPurpose = {
    'forgot-password': 'Callkaro password reset OTP',
    'admin-reset': 'Callkaro admin password reset OTP',
    'admin-login': 'Callkaro admin login verification OTP',
  };
  const subject = subjectByPurpose[purpose] || 'Callkaro verification OTP';

  const text = `Your Callkaro OTP is ${otp}. It expires in ${config.otpTtlMinutes} minutes. Do not share this code.`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2>Callkaro</h2>
      <p>Your OTP is:</p>
      <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${otp}</p>
      <p>This code expires in <strong>${config.otpTtlMinutes} minutes</strong>.</p>
      <p>If you did not request this, you can ignore this email.</p>
    </div>
  `;

  if (!mailer) {
    console.warn(
      `[EMAIL] Email not configured (or still using placeholders). OTP for ${to}: ${otp}`,
    );
    return {sent: false, reason: 'email_not_configured'};
  }

  try {
    await mailer.sendMail({
      from: `"Callkaro" <${config.emailUser}>`,
      to,
      subject,
      text,
      html,
    });
    console.log(`[EMAIL] OTP sent to ${to} (${purpose})`);
    return {sent: true};
  } catch (error) {
    console.error(
      `[EMAIL] Failed to send OTP to ${to}:`,
      error.message || error,
    );
    console.warn(`[EMAIL] Falling back — OTP for ${to}: ${otp}`);
    return {sent: false, reason: 'email_send_failed'};
  }
}

module.exports = {sendOtpEmail, isEmailConfigured};
