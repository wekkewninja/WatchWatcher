exports.up = (pgm) => {
  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true },
    name: { type: 'varchar(80)', notNull: true },
    email: { type: 'varchar(254)', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('users', 'users_email_lowercase_check', { check: 'email = lower(email)' });

  pgm.createTable('progress_snapshots', {
    account_id: {
      type: 'uuid',
      primaryKey: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    topic_mastery: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    weak_spot_log: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    drill_queue: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    revision: { type: 'integer', notNull: true, default: 1 },
    synced_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('progress_snapshots', 'progress_revision_positive_check', { check: 'revision > 0' });
  pgm.addConstraint('progress_snapshots', 'progress_topic_mastery_object_check', { check: "jsonb_typeof(topic_mastery) = 'object'" });
  pgm.addConstraint('progress_snapshots', 'progress_weak_spot_log_array_check', { check: "jsonb_typeof(weak_spot_log) = 'array'" });
  pgm.addConstraint('progress_snapshots', 'progress_drill_queue_array_check', { check: "jsonb_typeof(drill_queue) = 'array'" });
};

exports.down = (pgm) => {
  pgm.dropTable('progress_snapshots');
  pgm.dropTable('users');
};