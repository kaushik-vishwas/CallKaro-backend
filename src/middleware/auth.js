const jwt = require('jsonwebtoken');
const {config} = require('../config');
const {fail} = require('../utils/response');

function signToken(user, {role = 'caller'} = {}) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role,
    },
    config.jwtSecret,
    {expiresIn: config.jwtExpiresIn},
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return fail(res, 'Unauthorized. Token required.', 401);
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.auth = {
      userId: payload.sub,
      email: payload.email,
      role: payload.role || 'caller',
    };
    return next();
  } catch {
    return fail(res, 'Invalid or expired token.', 401);
  }
}

function agentAuthRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return fail(res, 'Unauthorized. Token required.', 401);
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.role !== 'agent') {
      return fail(res, 'Agent access required.', 403);
    }
    req.auth = {
      agentId: payload.sub,
      email: payload.email,
      role: 'agent',
    };
    return next();
  } catch {
    return fail(res, 'Invalid or expired token.', 401);
  }
}

module.exports = {signToken, authRequired, agentAuthRequired};
