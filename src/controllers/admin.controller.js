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
    return ok(res, {admin: adminService.publicAdmin(admin)}, 'Admin fetched');
  } catch (error) {
    console.error('[admin.me]', error);
    return fail(res, 'Failed to fetch admin.', 500);
  }
}

module.exports = {
  login,
  verify2fa,
  resend2fa,
  forgotPassword,
  resetPassword,
  me,
};
