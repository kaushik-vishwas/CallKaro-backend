const {ok, fail} = require('../utils/response');
const {signToken} = require('../middleware/auth');
const callerService = require('../services/caller.service');

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

async function signup(req, res) {
  try {
    const {email, password, confirmPassword} = req.body || {};

    if (!isValidEmail(email)) {
      return fail(res, 'Please enter a valid email address.');
    }
    if (!password || String(password).length < 8) {
      return fail(res, 'Password must be at least 8 characters.');
    }
    if (password !== confirmPassword) {
      return fail(res, 'Passwords do not match.');
    }

    const user = await callerService.createPendingUser({email, password});
    const otpInfo = await callerService.saveOtp(email, 'signup');

    return ok(
      res,
      {
        email: user.email,
        name: user.name,
        otpExpiresInMinutes: otpInfo.otpExpiresInMinutes,
        emailSent: otpInfo.emailSent,
        // Only returned when email is not configured (local fallback)
        ...(otpInfo.otp ? {debugOtp: otpInfo.otp} : {}),
      },
      otpInfo.emailSent ? 'OTP sent successfully' : 'OTP generated (check server logs)',
      201,
    );
  } catch (error) {
    return fail(res, error.message || 'Signup failed.');
  }
}

async function verifyOtp(req, res) {
  try {
    const {email, otp, flow} = req.body || {};
    if (!isValidEmail(email) || !otp) {
      return fail(res, 'Email and OTP are required.');
    }

    const purpose =
      flow === 'forgot-password' ? 'forgot-password' : 'signup';

    const result = await callerService.verifyStoredOtp(email, otp, purpose);
    if (!result.ok) {
      return fail(res, result.message);
    }

    // Forgot-password: only confirm OTP, then client sets a new password
    if (purpose === 'forgot-password') {
      return ok(
        res,
        {email, verified: true},
        'OTP verified successfully',
      );
    }

    const user = await callerService.verifyUserSignup(email);
    if (!user) {
      return fail(res, 'User not found for this email.', 404);
    }

    const token = signToken(user);
    return ok(
      res,
      {
        token,
        accessToken: token,
        user: callerService.publicUser(user),
      },
      'OTP verified successfully',
    );
  } catch (error) {
    return fail(res, error.message || 'OTP verification failed.');
  }
}

async function forgotPassword(req, res) {
  try {
    const {email} = req.body || {};
    if (!isValidEmail(email)) {
      return fail(res, 'Please enter a valid email address.');
    }

    const user = await callerService.findUserByEmail(email);
    if (!user) {
      return ok(res, {email}, 'If an account exists, OTP has been sent.');
    }

    const otpInfo = await callerService.saveOtp(email, 'forgot-password');
    return ok(
      res,
      {
        email,
        otpExpiresInMinutes: otpInfo.otpExpiresInMinutes,
        emailSent: otpInfo.emailSent,
        ...(otpInfo.otp ? {debugOtp: otpInfo.otp} : {}),
      },
      otpInfo.emailSent ? 'OTP sent successfully' : 'OTP generated (check server logs)',
    );
  } catch (error) {
    return fail(res, error.message || 'Failed to send OTP.');
  }
}

async function createNewPassword(req, res) {
  try {
    const {email, newPassword, confirmNewPassword} = req.body || {};
    if (!isValidEmail(email)) {
      return fail(res, 'Please enter a valid email address.');
    }
    if (!newPassword || String(newPassword).length < 8) {
      return fail(res, 'Password must be at least 8 characters.');
    }
    if (newPassword !== confirmNewPassword) {
      return fail(res, 'Passwords do not match.');
    }

    const user = await callerService.setPassword(email, newPassword);
    if (!user) {
      return fail(res, 'User not found.', 404);
    }

    const token = signToken(user);
    return ok(
      res,
      {
        token,
        accessToken: token,
        user: callerService.publicUser(user),
      },
      'Password updated successfully',
    );
  } catch (error) {
    return fail(res, error.message || 'Password update failed.');
  }
}

async function login(req, res) {
  try {
    const {email, password} = req.body || {};
    if (!isValidEmail(email) || !password) {
      return fail(res, 'Email and password are required.');
    }

    const result = await callerService.validateLogin(email, password);
    if (!result.ok) {
      return fail(res, result.message, 401);
    }

    const token = signToken(result.user);
    return ok(
      res,
      {
        token,
        accessToken: token,
        user: callerService.publicUser(result.user),
      },
      'Login successful',
    );
  } catch (error) {
    return fail(res, error.message || 'Login failed.');
  }
}

async function getUser(req, res) {
  try {
    const user = await callerService.findUserById(req.auth.userId);
    if (!user) {
      return fail(res, 'User not found.', 404);
    }
    return ok(
      res,
      callerService.publicUser(user),
      'User fetched successfully',
    );
  } catch (error) {
    return fail(res, error.message || 'Failed to fetch user.');
  }
}

async function updatePassword(req, res) {
  try {
    const {currentPassword, newPassword, confirmNewPassword} = req.body || {};
    if (!currentPassword || !newPassword) {
      return fail(res, 'Current and new password are required.');
    }
    if (newPassword !== confirmNewPassword) {
      return fail(res, 'Passwords do not match.');
    }
    if (String(newPassword).length < 8) {
      return fail(res, 'Password must be at least 8 characters.');
    }

    const result = await callerService.updatePassword(
      req.auth.userId,
      currentPassword,
      newPassword,
    );
    if (!result.ok) {
      return fail(res, result.message);
    }

    return ok(res, {}, 'Password updated successfully');
  } catch (error) {
    return fail(res, error.message || 'Password update failed.');
  }
}

async function editProfile(req, res) {
  try {
    const {name, profile} = req.body || {};
    if (!name && typeof profile === 'undefined') {
      return fail(res, 'Provide name and/or profile.');
    }

    const user = await callerService.editProfile(req.auth.userId, {name, profile});
    if (!user) {
      return fail(res, 'User not found.', 404);
    }

    return ok(
      res,
      {user: callerService.publicUser(user)},
      'Profile updated successfully',
    );
  } catch (error) {
    return fail(res, error.message || 'Failed to update profile.');
  }
}

async function dailyRewardStatus(req, res) {
  try {
    const status = await callerService.getDailyRewardStatus(req.auth.userId);
    return ok(res, status, 'Daily reward status fetched');
  } catch (error) {
    return fail(res, error.message || 'Failed to fetch daily reward status.');
  }
}

async function claimDailyReward(req, res) {
  try {
    const result = await callerService.claimDailyReward(req.auth.userId);
    if (!result.ok) {
      return fail(res, result.message);
    }
    return ok(res, result.data, 'Daily reward claimed successfully');
  } catch (error) {
    return fail(res, error.message || 'Failed to claim daily reward.');
  }
}

async function createOrder(req, res) {
  try {
    const amount = Number(req.body?.amount);
    const result = await callerService.createRechargeOrder(
      req.auth.userId,
      amount,
    );
    if (!result.ok) {
      return fail(res, result.message);
    }
    return ok(res, result.data, 'Order created successfully', 201);
  } catch (error) {
    return fail(res, error.message || 'Failed to create order.');
  }
}

async function verifyPayment(req, res) {
  try {
    const result = await callerService.verifyRechargePayment(
      req.auth.userId,
      req.body || {},
    );
    if (!result.ok) {
      return fail(res, result.message);
    }
    return ok(res, result.data, 'Payment verified successfully');
  } catch (error) {
    return fail(res, error.message || 'Payment verification failed.');
  }
}

module.exports = {
  signup,
  verifyOtp,
  forgotPassword,
  createNewPassword,
  login,
  getUser,
  updatePassword,
  editProfile,
  dailyRewardStatus,
  claimDailyReward,
  createOrder,
  verifyPayment,
};
