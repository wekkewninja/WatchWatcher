exports.up = (pgm) => {
  pgm.addColumns('progress_snapshots', {
    objective_practice_attempts: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    exam_sessions: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    deleted_exam_session_ids: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    exam_history_deleted_at: { type: 'timestamptz', notNull: false },
  });
  pgm.addConstraint('progress_snapshots', 'progress_objective_practice_attempts_array_check', {
    check: "jsonb_typeof(objective_practice_attempts) = 'array'",
  });
  pgm.addConstraint('progress_snapshots', 'progress_exam_sessions_array_check', {
    check: "jsonb_typeof(exam_sessions) = 'array'",
  });
  pgm.addConstraint('progress_snapshots', 'progress_deleted_exam_session_ids_array_check', {
    check: "jsonb_typeof(deleted_exam_session_ids) = 'array'",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('progress_snapshots', 'progress_objective_practice_attempts_array_check');
  pgm.dropConstraint('progress_snapshots', 'progress_exam_sessions_array_check');
  pgm.dropConstraint('progress_snapshots', 'progress_deleted_exam_session_ids_array_check');
  pgm.dropColumns('progress_snapshots', ['objective_practice_attempts', 'exam_sessions', 'deleted_exam_session_ids', 'exam_history_deleted_at']);
};