-- Migration 0006: the subjects teachers can create classes for.
-- Names only (no exam content). INSERT OR IGNORE keeps this safe to re-run and
-- leaves any subject that already exists with the same code untouched.
INSERT OR IGNORE INTO `subjects` (`id`, `code`, `name`, `position`) VALUES
  ('sub_gen34',  'GEN34',  'General Mathematics Units 3&4',  1),
  ('sub_mm34',   'MM34',   'Mathematical Methods Units 3&4', 2),
  ('sub_chem34', 'CHEM34', 'Chemistry Units 3&4',            3);
