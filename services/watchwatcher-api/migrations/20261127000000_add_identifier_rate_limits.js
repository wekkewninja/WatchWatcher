exports.up = (pgm) => {
  pgm.createTable('identifier_rate_limits', {
    key_hash: { type: 'char(64)', primaryKey: true },
    attempt_count: { type: 'integer', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
  });
  pgm.addConstraint('identifier_rate_limits', 'identifier_rate_limits_count_positive', { check: 'attempt_count > 0' });
  pgm.createIndex('identifier_rate_limits', 'expires_at');
};

exports.down = (pgm) => {
  pgm.dropTable('identifier_rate_limits');
};