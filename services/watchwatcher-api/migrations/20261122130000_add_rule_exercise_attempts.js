exports.up = (pgm) => {
  pgm.addColumn('progress_snapshots', {
    rule_exercise_attempts: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
  });
  pgm.addConstraint('progress_snapshots', 'progress_rule_exercise_attempts_array_check', {
    check: "jsonb_typeof(rule_exercise_attempts) = 'array'",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('progress_snapshots', 'progress_rule_exercise_attempts_array_check');
  pgm.dropColumn('progress_snapshots', 'rule_exercise_attempts');
};