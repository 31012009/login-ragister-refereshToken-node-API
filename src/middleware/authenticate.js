const jwt = require('jsonwebtoken');
const {
  getActiveSessionUser,
  verifyAccessToken,
} = require('../services/auth');

async function authenticate(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  let claims;
  try {
    claims = verifyAccessToken(match[1]);
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Invalid or expired access token.' });
    }
    return next(error);
  }

  if (
    !claims ||
    typeof claims !== 'object' ||
    typeof claims.sub !== 'string' ||
    typeof claims.sid !== 'string'
  ) {
    return res.status(401).json({ error: 'Invalid or expired access token.' });
  }

  try {
    const user = await getActiveSessionUser(claims.sub, claims.sid);
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired access token.' });
    }
    req.authUser = { ...user, sessionId: claims.sid };
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = authenticate;
