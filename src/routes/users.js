const express = require('express');
const authenticate = require('../middleware/authenticate');

const router = express.Router();

/**
 * @openapi
 * /api/users/me:
 *   get:
 *     tags: [Users]
 *     summary: Get the authenticated user's profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Authenticated user's profile.
 *       401:
 *         description: Access token is missing, invalid, expired, or revoked.
 */
router.get('/users/me', authenticate, (req, res) => {
  res.json({ user: req.authUser });
});

module.exports = router;
