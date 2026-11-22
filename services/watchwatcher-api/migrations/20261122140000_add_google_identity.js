exports.up = (pgm) => {
  pgm.alterColumn('users', 'password_hash', { notNull: false });
  pgm.createTable('account_identities', {
    id: { type: 'uuid', primaryKey: true },
    account_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    provider: { type: 'varchar(32)', notNull: true },
    provider_subject: { type: 'text', notNull: true },
    provider_email: { type: 'varchar(254)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('account_identities', 'account_identities_provider_subject_unique', {
    unique: ['provider', 'provider_subject'],
  });
  pgm.addConstraint('account_identities', 'account_identities_provider_account_unique', {
    unique: ['provider', 'account_id'],
  });
  pgm.createTable('google_auth_challenges', {
    id: { type: 'uuid', primaryKey: true },
    nonce_hash: { type: 'char(64)', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('google_auth_challenges', 'expires_at');
};

exports.down = (pgm) => {
  pgm.sql(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM users WHERE password_hash IS NULL) THEN
      RAISE EXCEPTION 'Cannot remove Google sign-in while passwordless accounts exist';
    END IF;
  END $$;`);
  pgm.dropTable('google_auth_challenges');
  pgm.dropTable('account_identities');
  pgm.alterColumn('users', 'password_hash', { notNull: true });
};