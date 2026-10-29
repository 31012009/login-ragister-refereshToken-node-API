const sql = require('mssql/msnodesqlv8');

const server = process.env.DB_SERVER || 'localhost\\SQLEXPRESS';
const configuredPort = process.env.DB_PORT;
const port = configuredPort ? Number(configuredPort) : undefined;

if (
  configuredPort &&
  (!Number.isInteger(port) || port < 1 || port > 65535)
) {
  throw new Error('DB_PORT must be a whole number between 1 and 65535.');
}

if (port && server.includes('\\')) {
  throw new Error('Set DB_SERVER to a hostname without an instance name when using DB_PORT.');
}

const isLocalServer = /^(localhost|127\.0\.0\.1|\.)(\\[^\\]+)?$/i.test(server);
const serverAddress = port
  ? `tcp:${server},${port}`
  : isLocalServer && !/^(lpc|tcp|np):/i.test(server)
    ? `lpc:${server}`
    : server;

const config = {
  connectionString: [
    `Driver={${process.env.DB_DRIVER || 'ODBC Driver 17 for SQL Server'}}`,
    `Server=${serverAddress}`,
    `Database=${process.env.DB_DATABASE || 'MyDatabase'}`,
    'Trusted_Connection=Yes',
    'TrustServerCertificate=Yes',
  ].join(';'),
};

let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config).connect().catch((error) => {
      poolPromise = undefined;
      throw error;
    });
  }

  return poolPromise;
}

module.exports = { getPool };
