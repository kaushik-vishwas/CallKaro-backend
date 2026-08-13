const {ok, fail} = require('../utils/response');
const adminService = require('../services/admin.service');

async function login(req, res) {
  try {
    const {email, password} = req.body || {};
    if (!email || !password) {
      return fail(res, 'Email and password are required.');
    }

    const result = await adminService.login(email, password);
    if (!result.ok) return fail(res, result.message, 401);

    return ok(
      res,
      {
        requires2fa: true,
        challengeToken: result.challengeToken,
        email: result.email,
        otpExpiresInMinutes: result.otpExpiresInMinutes,
        ...(result.debugOtp ? {debugOtp: result.debugOtp} : {}),
      },
      '2FA code sent',
    );
  } catch (error) {
    console.error('[admin.login]', error);
    return fail(res, 'Login failed.', 500);
  }
}

async function verify2fa(req, res) {
  try {
    const {challengeToken, otp} = req.body || {};
    if (!challengeToken || !otp) {
      return fail(res, 'challengeToken and otp are required.');
    }

    const result = await adminService.verifyLoginOtp(challengeToken, otp);
    if (!result.ok) return fail(res, result.message, 400);

    return ok(
      res,
      {
        token: result.token,
        admin: adminService.publicAdmin(result.admin),
      },
      'Login successful',
    );
  } catch (error) {
    console.error('[admin.verify2fa]', error);
    return fail(res, 'Verification failed.', 500);
  }
}

async function resend2fa(req, res) {
  try {
    const {challengeToken} = req.body || {};
    if (!challengeToken) {
      return fail(res, 'challengeToken is required.');
    }

    const result = await adminService.resendLoginOtp(challengeToken);
    if (!result.ok) return fail(res, result.message, 400);

    return ok(
      res,
      {
        otpExpiresInMinutes: result.otpExpiresInMinutes,
        ...(result.debugOtp ? {debugOtp: result.debugOtp} : {}),
      },
      'Verification code resent',
    );
  } catch (error) {
    console.error('[admin.resend2fa]', error);
    return fail(res, 'Could not resend code.', 500);
  }
}

async function forgotPassword(req, res) {
  try {
    const {email} = req.body || {};
    if (!email) return fail(res, 'Email is required.');

    const result = await adminService.requestPasswordReset(email);
    return ok(
      res,
      {
        email: result.email,
        otpExpiresInMinutes: result.otpExpiresInMinutes,
        ...(result.debugOtp ? {debugOtp: result.debugOtp} : {}),
      },
      result.message || 'Reset code sent',
    );
  } catch (error) {
    console.error('[admin.forgotPassword]', error);
    return fail(res, 'Could not start password reset.', 500);
  }
}

async function resetPassword(req, res) {
  try {
    const {email, otp, newPassword} = req.body || {};
    if (!email || !otp || !newPassword) {
      return fail(res, 'email, otp and newPassword are required.');
    }

    const result = await adminService.resetPassword({email, otp, newPassword});
    if (!result.ok) return fail(res, result.message, 400);

    return ok(res, {}, 'Password updated successfully');
  } catch (error) {
    console.error('[admin.resetPassword]', error);
    return fail(res, 'Could not reset password.', 500);
  }
}

async function me(req, res) {
  try {
    const admin = await adminService.findAdminById(req.auth.adminId);
    if (!admin) return fail(res, 'Admin not found.', 404);
    const adminSettingsService = require('../services/adminSettings.service');
    return ok(
      res,
      {admin: adminSettingsService.publicAdminSettings(admin)},
      'Admin fetched',
    );
  } catch (error) {
    console.error('[admin.me]', error);
    return fail(res, 'Failed to fetch admin.', 500);
  }
}

async function updateProfile(req, res) {
  try {
    const adminSettingsService = require('../services/adminSettings.service');
    const result = await adminSettingsService.updateProfile(
      req.auth.adminId,
      req.body || {},
    );
    if (!result.ok) return fail(res, result.message, 400);
    return ok(res, {admin: result.admin}, 'Profile updated');
  } catch (error) {
    console.error('[admin.updateProfile]', error);
    return fail(res, 'Failed to update profile.', 500);
  }
}

async function changePassword(req, res) {
  try {
    const {currentPassword, newPassword} = req.body || {};
    const adminSettingsService = require('../services/adminSettings.service');
    const result = await adminSettingsService.changePassword(
      req.auth.adminId,
      currentPassword,
      newPassword,
    );
    if (!result.ok) return fail(res, result.message, 400);
    return ok(res, {admin: result.admin}, 'Password updated');
  } catch (error) {
    console.error('[admin.changePassword]', error);
    return fail(res, 'Failed to change password.', 500);
  }
}

async function getWallet(req, res) {
  try {
    const adminSettingsService = require('../services/adminSettings.service');
    const wallet = await adminSettingsService.getWalletSnapshot();
    return ok(res, {wallet}, 'Wallet snapshot fetched');
  } catch (error) {
    console.error('[admin.getWallet]', error);
    return fail(res, 'Failed to fetch wallet.', 500);
  }
}

async function getHelp(req, res) {
  try {
    const adminSettingsService = require('../services/adminSettings.service');
    const help = adminSettingsService.getHelpSupport();
    return ok(res, {help}, 'Help support fetched');
  } catch (error) {
    console.error('[admin.getHelp]', error);
    return fail(res, 'Failed to fetch help info.', 500);
  }
}

async function getBank(req, res) {
  try {
    const adminSettingsService = require('../services/adminSettings.service');
    const result = await adminSettingsService.getSettingsProfile(
      req.auth.adminId,
    );
    if (!result.ok) return fail(res, result.message, 404);
    return ok(res, {bank: result.admin.bank, admin: result.admin}, 'Bank fetched');
  } catch (error) {
    console.error('[admin.getBank]', error);
    return fail(res, 'Failed to fetch bank details.', 500);
  }
}

async function sendBankOtp(req, res) {
  try {
    const adminSettingsService = require('../services/adminSettings.service');
    const result = await adminSettingsService.sendBankOtp(req.auth.adminId);
    if (!result.ok) return fail(res, result.message, 400);
    return ok(
      res,
      {
        destination: result.destination,
        channel: result.channel,
        phoneMasked: result.phoneMasked,
        otpExpiresInMinutes: result.otpExpiresInMinutes,
        ...(result.debugOtp ? {debugOtp: result.debugOtp} : {}),
      },
      'OTP sent',
    );
  } catch (error) {
    console.error('[admin.sendBankOtp]', error);
    return fail(res, 'Failed to send OTP.', 500);
  }
}

async function verifyBankOtp(req, res) {
  try {
    const {otp} = req.body || {};
    const adminSettingsService = require('../services/adminSettings.service');
    const result = await adminSettingsService.verifyBankOtp(
      req.auth.adminId,
      otp,
    );
    if (!result.ok) return fail(res, result.message, 400);
    return ok(
      res,
      {
        bankChallengeToken: result.bankChallengeToken,
        expiresInMinutes: result.expiresInMinutes,
      },
      'OTP verified',
    );
  } catch (error) {
    console.error('[admin.verifyBankOtp]', error);
    return fail(res, 'Failed to verify OTP.', 500);
  }
}

async function confirmBank(req, res) {
  try {
    const {bankChallengeToken, ...bank} = req.body || {};
    const adminSettingsService = require('../services/adminSettings.service');
    const result = await adminSettingsService.confirmBankUpdate(
      req.auth.adminId,
      bankChallengeToken,
      bank,
    );
    if (!result.ok) return fail(res, result.message, 400);
    return ok(
      res,
      {
        bank: result.bank,
        admin: result.admin,
        reference: result.reference,
        updatedOnLabel: result.updatedOnLabel,
      },
      'Bank details updated',
    );
  } catch (error) {
    console.error('[admin.confirmBank]', error);
    return fail(res, 'Failed to update bank details.', 500);
  }
}

module.exports = {
  login,
  verify2fa,
  resend2fa,
  forgotPassword,
  resetPassword,
  me,
  updateProfile,
  changePassword,
  getWallet,
  getHelp,
  getBank,
  sendBankOtp,
  verifyBankOtp,
  confirmBank,
};
