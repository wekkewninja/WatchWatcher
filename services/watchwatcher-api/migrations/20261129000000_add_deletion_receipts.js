exports.up = (pgm) => {
  pgm.createTable('deletion_receipts', {
    session_hash: { type: 'char(64)', primaryKey: true },
    expires_at: { type: 'timestamptz', notNull: true },
  });
  pgm.createIndex('deletion_receipts', 'expires_at');
  pgm.createIndex('sessions', 'account_id');
};

exports.down = (pgm) => {
  pgm.dropIndex('sessions', 'account_id');
  pgm.dropTable('deletion_receipts');
};