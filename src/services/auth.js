const { createHash, randomBytes, randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
// const sql = require('mssql/msnodesqlv8');
const sql = require('mssql');
const { getPool } = require('../db');

const issuer = 'customers-api';
const audience = 'customers-api';

function getAuthConfig() {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_ACCESS_SECRET must be set to at least 32 bytes.');
  }

  const accessTokenTtlSeconds = Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 900);
  const refreshTokenTtlDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
  if (
    !Number.isInteger(accessTokenTtlSeconds) ||
    accessTokenTtlSeconds <= 0 ||
    !Number.isInteger(refreshTokenTtlDays) ||
    refreshTokenTtlDays <= 0
  ) {
    throw new Error('Token lifetimes must be positive whole numbers.');
  }

  return { secret, accessTokenTtlSeconds, refreshTokenTtlDays };
}

function createRefreshToken() {
  return randomBytes(32).toString('base64url');
}

function hashRefreshToken(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}

function createAccessToken(userId, sessionId) {
  const { secret, accessTokenTtlSeconds } = getAuthConfig();
  return {
    accessToken: jwt.sign(
      { sid: sessionId },
      secret,
      {
        algorithm: 'HS256',
        audience,
        expiresIn: accessTokenTtlSeconds,
        issuer,
        subject: String(userId),
      },
    ),
    expiresIn: accessTokenTtlSeconds,
  };
}

function buildTokenResponse(userId, sessionId, refreshToken) {
  return {
    tokenType: 'Bearer',
    ...createAccessToken(userId, sessionId),
    refreshToken,
  };
}

async function createRefreshSession(
  transaction,
  userId,
  refreshToken,
  userAgent,
  sessionId = randomUUID(),
) {
  const { refreshTokenTtlDays } = getAuthConfig();
  await transaction
    .request()
    .input('sessionId', sql.UniqueIdentifier, sessionId)
    .input('userId', sql.BigInt, String(userId))
    .input('tokenHash', sql.Binary(32), hashRefreshToken(refreshToken))
    .input('refreshTokenTtlDays', sql.Int, refreshTokenTtlDays)
    .input('userAgent', sql.NVarChar(500), userAgent ? userAgent.slice(0, 500) : null)
    .query(`
      INSERT INTO dbo.RefreshTokenSessions
        (SessionId, UserId, TokenHash, CreatedAt, ExpiresAt, UserAgent)
      VALUES
        (@sessionId, @userId, @tokenHash, SYSUTCDATETIME(),
         DATEADD(day, @refreshTokenTtlDays, SYSUTCDATETIME()), @userAgent)
    `);

  return sessionId;
}

async function login(email, password, userAgent) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('email', sql.NVarChar(255), email.trim().toLowerCase())
    .query(`
      SELECT UserId, FullName, Email, PasswordHash
      FROM dbo.Users
      WHERE Email = @email AND IsActive = 1
    `);
  const user = result.recordset[0];
  if (!user || !(await bcrypt.compare(password, user.PasswordHash))) {
    return null;
  }

  const refreshToken = createRefreshToken();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const sessionId = await createRefreshSession(
      transaction,
      user.UserId,
      refreshToken,
      userAgent,
    );
    await transaction.commit();

    return {
      ...buildTokenResponse(user.UserId, sessionId, refreshToken),
      user: {
        userId: String(user.UserId),
        fullName: user.FullName,
        email: user.Email,
      },
    };
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      console.error('Failed to roll back login transaction:', rollbackError);
    }
    throw error;
  }
}

async function register(fullName, email, password, userAgent) {
  const pool = await getPool();
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await pool
    .request()
    .input('email', sql.NVarChar(255), normalizedEmail)
    .query('SELECT TOP (1) UserId FROM dbo.Users WHERE Email = @email');

  if (existing.recordset.length > 0) {
    return null;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const refreshToken = createRefreshToken();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const result = await transaction
      .request()
      .input('fullName', sql.NVarChar(150), fullName.trim())
      .input('email', sql.NVarChar(255), normalizedEmail)
      .input('passwordHash', sql.NVarChar(255), passwordHash)
      .query(`
        INSERT INTO dbo.Users (FullName, Email, PasswordHash)
        OUTPUT INSERTED.UserId, INSERTED.FullName, INSERTED.Email
        VALUES (@fullName, @email, @passwordHash)
      `);
    const user = result.recordset[0];
    const sessionId = await createRefreshSession(
      transaction,
      user.UserId,
      refreshToken,
      userAgent,
    );
    const tokens = buildTokenResponse(user.UserId, sessionId, refreshToken);
    await transaction.commit();

    return {
      ...tokens,
      user: {
        userId: String(user.UserId),
        fullName: user.FullName,
        email: user.Email,
      },
    };
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      console.error('Failed to roll back registration transaction:', rollbackError);
    }

    if (error.number === 2601 || error.number === 2627) {
      return null;
    }
    throw error;
  }
}

async function refresh(refreshToken, userAgent) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(refreshToken)) {
    return null;
  }

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const found = await transaction
      .request()
      .input('tokenHash', sql.Binary(32), hashRefreshToken(refreshToken))
      .query(`
        SELECT TOP (1) s.SessionId, s.UserId, s.RevokedAt,
               CASE WHEN s.ExpiresAt <= SYSUTCDATETIME()
                    THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS IsExpired,
               u.FullName, u.Email, u.IsActive
        FROM dbo.RefreshTokenSessions AS s WITH (UPDLOCK, ROWLOCK)
        INNER JOIN dbo.Users AS u ON u.UserId = s.UserId
        WHERE s.TokenHash = @tokenHash
      `);
    const currentSession = found.recordset[0];

    if (
      !currentSession ||
      currentSession.RevokedAt ||
      currentSession.IsExpired ||
      !currentSession.IsActive
    ) {
      await transaction.rollback();
      return null;
    }

    const nextRefreshToken = createRefreshToken();
    const replacementId = randomUUID();
    await createRefreshSession(
      transaction,
      currentSession.UserId,
      nextRefreshToken,
      userAgent,
      replacementId,
    );
    await transaction
      .request()
      .input('sessionId', sql.UniqueIdentifier, currentSession.SessionId)
      .input('replacedBySessionId', sql.UniqueIdentifier, replacementId)
      .query(`
        UPDATE dbo.RefreshTokenSessions
        SET RevokedAt = SYSUTCDATETIME(),
            LastUsedAt = SYSUTCDATETIME(),
            ReplacedBySessionId = @replacedBySessionId
        WHERE SessionId = @sessionId AND RevokedAt IS NULL
      `);
    await transaction.commit();

    return {
      ...buildTokenResponse(currentSession.UserId, replacementId, nextRefreshToken),
      user: {
        userId: String(currentSession.UserId),
        fullName: currentSession.FullName,
        email: currentSession.Email,
      },
    };
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      console.error('Failed to roll back refresh transaction:', rollbackError);
    }
    throw error;
  }
}

async function logout(refreshToken) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(refreshToken)) {
    return;
  }

  const pool = await getPool();
  await pool
    .request()
    .input('tokenHash', sql.Binary(32), hashRefreshToken(refreshToken))
    .query(`
      UPDATE dbo.RefreshTokenSessions
      SET RevokedAt = SYSUTCDATETIME(),
          LastUsedAt = SYSUTCDATETIME()
      WHERE TokenHash = @tokenHash AND RevokedAt IS NULL
    `);
}

async function logoutAll(userId) {
  const pool = await getPool();
  await pool
    .request()
    .input('userId', sql.BigInt, String(userId))
    .query(`
      UPDATE dbo.RefreshTokenSessions
      SET RevokedAt = SYSUTCDATETIME()
      WHERE UserId = @userId AND RevokedAt IS NULL
    `);
}

async function getActiveSessionUser(userId, sessionId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('userId', sql.BigInt, userId)
    .input('sessionId', sql.UniqueIdentifier, sessionId)
    .query(`
      SELECT u.UserId, u.FullName, u.Email
      FROM dbo.RefreshTokenSessions AS s
      INNER JOIN dbo.Users AS u ON u.UserId = s.UserId
      WHERE s.SessionId = @sessionId
        AND s.UserId = @userId
        AND s.RevokedAt IS NULL
        AND u.IsActive = 1
    `);
  const user = result.recordset[0];
  if (!user) {
    return null;
  }

  return {
    userId: String(user.UserId),
    fullName: user.FullName,
    email: user.Email,
  };
}

function verifyAccessToken(token) {
  return jwt.verify(token, getAuthConfig().secret, {
    algorithms: ['HS256'],
    audience,
    issuer,
  });
}

function validateAuthConfig() {
  getAuthConfig();
}

module.exports = {
  getActiveSessionUser,
  login,
  logout,
  logoutAll,
  register,
  refresh,
  validateAuthConfig,
  verifyAccessToken,
};
