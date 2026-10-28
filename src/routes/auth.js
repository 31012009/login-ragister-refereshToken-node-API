const express = require('express');
const authenticate = require('../middleware/authenticate');
const authService = require('../services/auth');

const router = express.Router();
const refreshCookieName = 'refreshToken';
const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30) * 24 * 60 * 60 * 1000,
};

function sendTokens(res, tokens, status = 200) {
  const { refreshToken, ...response } = tokens;
  return res
    .cookie(refreshCookieName, refreshToken, refreshCookieOptions)
    .status(status)
    .json(response);
}

function clearRefreshCookie(res) {
  return res.clearCookie(refreshCookieName, {
    httpOnly: true,
    secure: refreshCookieOptions.secure,
    sameSite: refreshCookieOptions.sameSite,
    path: refreshCookieOptions.path,
  });
}

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     tags: [Authentication]
 *     summary: Register a user and issue tokens
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, email, password]
 *             properties:
 *               fullName: { type: string, maxLength: 150 }
 *               email: { type: string, format: email, maxLength: 255 }
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 description: At least 8 characters and no more than 72 UTF-8 bytes.
 *           example:
 *             fullName: Jane Doe
 *             email: jane.doe@example.com
 *             password: ChangeMe123!
 *     responses:
 *       201:
 *         description: User registered, access token returned, and refresh token set in an HttpOnly cookie.
 *       400:
 *         description: Registration details are invalid.
 *       409:
 *         description: An account with this email already exists.
 */
router.post('/auth/register', async (req, res, next) => {
  const { fullName, email, password } = req.body || {};
  const normalizedName = typeof fullName === 'string' ? fullName.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim() : '';
  const passwordBytes = typeof password === 'string'
    ? Buffer.byteLength(password, 'utf8')
    : 0;

  if (
    !normalizedName ||
    normalizedName.length > 150 ||
    !normalizedEmail ||
    normalizedEmail.length > 255 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
    typeof password !== 'string' ||
    Array.from(password).length < 8 ||
    passwordBytes > 72
  ) {
    return res.status(400).json({
      error: 'Provide a name, valid email, and a password of at least 8 characters and at most 72 UTF-8 bytes.',
    });
  }

  try {
    const result = await authService.register(
      normalizedName,
      normalizedEmail,
      password,
      req.get('user-agent'),
    );
    if (!result) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    return sendTokens(res, result, 201);
  } catch (error) {
    return next(error);
  }
});

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Authentication]
 *     summary: Log in and issue tokens
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *     responses:
 *       200:
 *         description: Authenticated user and access token; refresh token is set in an HttpOnly cookie.
 *       400:
 *         description: Email or password is missing.
 *       401:
 *         description: Credentials are invalid or the account is inactive.
 */
router.post('/auth/login', async (req, res, next) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const tokens = await authService.login(email, password, req.get('user-agent'));
    if (!tokens) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    return sendTokens(res, tokens);
  } catch (error) {
    return next(error);
  }
});

/**
 * @openapi
 * /api/auth/refresh:
 *   post:
 *     tags: [Authentication]
 *     summary: Rotate a refresh token
 *     responses:
 *       200:
 *         description: New access token; the rotated refresh token is set in an HttpOnly cookie.
 *       400:
 *         description: Refresh token cookie is missing.
 *       401:
 *         description: Refresh token is invalid, expired, revoked, or belongs to an inactive user.
 */
router.post('/auth/refresh', async (req, res, next) => {
  const refreshToken = req.cookies[refreshCookieName];
  if (typeof refreshToken !== 'string' || !refreshToken) {
    return res.status(400).json({ error: 'Refresh token cookie is required.' });
  }

  try {
    const tokens = await authService.refresh(refreshToken, req.get('user-agent'));
    if (!tokens) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Invalid or expired refresh token.' });
    }
    return sendTokens(res, tokens);
  } catch (error) {
    return next(error);
  }
});

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     tags: [Authentication]
 *     summary: Revoke the presented refresh session
 *     responses:
 *       204:
 *         description: Session revoked, if it existed.
 */
router.post('/auth/logout', async (req, res, next) => {
  try {
    const refreshToken = req.cookies[refreshCookieName];
    if (typeof refreshToken === 'string' && refreshToken) {
      await authService.logout(refreshToken);
    }
    clearRefreshCookie(res);
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

/**
 * @openapi
 * /api/auth/logout-all:
 *   post:
 *     tags: [Authentication]
 *     summary: Revoke all refresh sessions for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       204:
 *         description: All sessions revoked.
 *       401:
 *         description: Access token is missing or invalid.
 */
router.post('/auth/logout-all', authenticate, async (req, res, next) => {
  try {
    await authService.logoutAll(req.authUser.userId);
    clearRefreshCookie(res);
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
