const sql = require('mssql/msnodesqlv8');

const config = {
  connectionString: [
    `Driver={${process.env.DB_DRIVER || 'ODBC Driver 17 for SQL Server'}}`,
    `Server=${process.env.DB_SERVER || 'localhost\\SQLEXPRESS'}`,
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
