# Customers API

Node.js REST API for reading customers from SQL Server using the Windows
account running the API (Windows Integrated Authentication).

## Requirements

- Node.js 18 or later
- SQL Server Express with the `MyDatabase` database and `dbo.customers` table
- Microsoft ODBC Driver 17 for SQL Server installed on the machine
- The Windows account running Node.js must have permission to read
  `dbo.customers`

## Run

```powershell
npm install
Copy-Item .env.example .env
# Set JWT_ACCESS_SECRET in .env to a random value of at least 32 bytes.
npm start
```

Set `CORS_ORIGINS` to a comma-separated list of exact frontend origins, including
the scheme and port (for example `http://localhost:5173,http://localhost:4200`).
CORS preflight is enabled for the API's JSON and bearer-token requests, and
credentialed requests are allowed for these configured origins. Requests without
an `Origin` header, such as server-to-server calls, are unaffected.

The default connection uses `ODBC Driver 17 for SQL Server`, server
`localhost\SQLEXPRESS`, and database `MyDatabase`. Update `DB_DRIVER`,
`DB_SERVER`, `DB_DATABASE`, or `PORT` in `.env` if needed. No SQL username or
password is used; access is granted to the current Windows account.

## Endpoints

- `GET /api/customers` — returns an array of `{ id, name, country }` objects.
- `POST /api/auth/register` — create an account with `{ "fullName", "email", "password" }`; passwords must be at least 8 characters and at most 72 UTF-8 bytes. Returns the new profile and access token, and sets the refresh token in an HttpOnly cookie.
- `POST /api/auth/login` — authenticate with `{ "email", "password" }`; returns the access token and sets the refresh token in an HttpOnly cookie.
- `POST /api/auth/refresh` — rotate the refresh token from its HttpOnly cookie; returns a new access token and replaces the cookie.
- `POST /api/auth/logout` — revoke the session identified by the refresh-token cookie and clear the cookie.
- `POST /api/auth/logout-all` — revoke all sessions for the bearer-authenticated user.
- `GET /api/users/me` — return the profile for the bearer-authenticated user.
- `GET /api-docs` — interactive Swagger UI.

Authentication uses `dbo.Users` (`Email`, bcrypt `PasswordHash`, and `IsActive`)
and the existing `dbo.RefreshTokenSessions` table. Refresh tokens are set in an
HttpOnly cookie (not returned in JSON) and stored in SQL Server as SHA-256 hashes.
Refresh rotates the current session token; revoked sessions immediately
invalidate their access tokens as well. The cookie uses `SameSite=Lax` and is
marked `Secure` in production.

Browser clients must send credentialed requests so the browser stores and sends
the cookie. For Angular `HttpClient`, include `{ withCredentials: true }` on
login, registration, refresh, and logout requests. The refresh request has no
body; do not try to read the HttpOnly refresh cookie from JavaScript. Keep the
access token from the JSON response for bearer-authenticated API requests.

Set `JWT_ACCESS_SECRET` in `.env` to a cryptographically random value of at
least 32 bytes before starting the API. For example, generate one with
`node -e "console.log(require('node:crypto').randomBytes(64).toString('base64'))"`.
Access tokens default to 15 minutes and refresh tokens to 30 days; configure
`ACCESS_TOKEN_TTL_SECONDS` and `REFRESH_TOKEN_TTL_DAYS` as needed.

The API is organized into Express routers under `src/routes` and shared
middleware under `src/middleware`. Errors passed from routes are logged and
returned as JSON by the error-handling middleware.

The API returns `{ id, name, country }`. The current table schema stores the
name value in `first_name`, which the API aliases as `name`:

```sql
SELECT id, first_name AS name, country FROM dbo.customers
```
