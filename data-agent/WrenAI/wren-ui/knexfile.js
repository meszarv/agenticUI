// Update with your config settings.

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
if (process.env.DB_TYPE === 'pg') {
  console.log('Using Postgres');
  module.exports = {
    client: 'pg',
    connection: process.env.PG_URL,
  };
} else {
  console.log('Using SQLite');
  module.exports = {
    client: 'better-sqlite3',
    connection: {
      filename: process.env.SQLITE_FILE || './db.sqlite3',
    },
    useNullAsDefault: true,
    pool: {
      afterCreate: (conn, done) => {
        try {
          conn.pragma('journal_mode = WAL');
          conn.pragma('busy_timeout = 30000');
          conn.pragma('synchronous = NORMAL');
          conn.pragma('foreign_keys = ON');
          conn.pragma('cache_size = -64000');
          console.log('[knexfile] SQLite WAL mode enabled');
          done(null, conn);
        } catch (err) {
          console.error('[knexfile] pragma failed:', err?.message || err);
          done(err, conn);
        }
      },
    },
  };
}
