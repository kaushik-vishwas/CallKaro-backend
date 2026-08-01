const jwt = require('jsonwebtoken');
const {config} = require('../config');
const {fail} = require('../utils/response');

/**
 * Accepts either a caller or receiver JWT for shared chat endpoints.
 */
function chatAuthRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return fail(res, 'Unauthorized. Token required.', 401);
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const role = payload.role || 'caller';

    if (role === 'receiver') {
      req.auth = {
        receiverId: payload.sub,
        email: payload.email,
        role: 'receiver',
      };
      return next();
    }

    if (role === 'caller') {
      req.auth = {
        userId: payload.sub,
        email: payload.email,
        role: 'caller',
      };
      return next();
    }

    return fail(res, 'Caller or receiver access required.', 403);
  } catch {
    return fail(res, 'Invalid or expired token.', 401);
  }
}

module.exports = {chatAuthRequired};
