function errorHandler(error, req, res, next) {
  console.error(`Request failed: ${req.method} ${req.originalUrl}`, error);

  if (res.headersSent) {
    return next(error);
  }

  const status = Number(error.status || error.statusCode);
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: 'Invalid request.' });
  }

  res.status(500).json({ error: 'Internal server error.' });
}

module.exports = errorHandler;
