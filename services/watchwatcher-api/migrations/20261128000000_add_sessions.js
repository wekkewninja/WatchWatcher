exports.up = (pgm) => {
  pgm.createTable('sessions', {
    id: { type: 'uuid', primaryKey: true },
    account_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    expires_at: { type: 'timestamptz', notNull: true },
  });
  pgm.createIndex('sessions', 'expires_at');
};

exports.down = (pgm) => {
  pgm.dropTable('sessions');
};