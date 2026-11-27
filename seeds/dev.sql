-- Seed data for a LOCAL test environment only. Never run with --remote.
--   npm run db:seed:local
--
-- Everything here is fictional (this repo is public): one test school, 3 staff,
-- 5 students, 2 subjects, 3 classes. Emails use the reserved .test domain,
-- question refs start with "TEST", statistics are invented, and image/solution
-- keys point at dev placeholders. No VCAA content.
-- IDs are readable on purpose; the app and Better Auth generate random IDs.
-- Times use unixepoch('<ISO>') * 1000 so they read as dates.
--
-- Local sign-in without Google: the sessions below hold the raw tokens
-- 'dev-session-token-student-1' and 'dev-session-token-teacher-1'. Better Auth
-- only accepts them inside a cookie signed with BETTER_AUTH_SECRET (see
-- docs/database.md, "Local testing").

-- ===== IDENTITY =============================================================
INSERT INTO allowlist (email, role) VALUES
  ('admin@example.test', 'admin'), ('teacher1@example.test', 'teacher'), ('teacher2@example.test', 'teacher'),
  ('student1@example.test', 'student'), ('student2@example.test', 'student'), ('student3@example.test', 'student'),
  ('student4@example.test', 'student'), ('student5@example.test', 'student');

INSERT INTO users (id, name, email, email_verified, platform_role, year_level, status) VALUES
  ('usr_admin',    'Andy (admin)', 'admin@example.test',    1, 'admin',   NULL, 'active'),
  ('usr_teacher1', 'Ms Rivera',    'teacher1@example.test', 1, 'teacher', NULL, 'active'),
  ('usr_teacher2', 'Mr Okafor',    'teacher2@example.test', 1, 'teacher', NULL, 'active'),
  ('usr_student1', 'Lena N.',      'student1@example.test', 1, 'student', 12,   'active'),
  ('usr_student2', 'Tom B.',       'student2@example.test', 1, 'student', 12,   'active'),
  ('usr_student3', 'Priya S.',     'student3@example.test', 1, 'student', 12,   'active'),
  ('usr_student4', 'Marco D.',     'student4@example.test', 1, 'student', 11,   'active'),
  ('usr_student5', 'Jess W.',      'student5@example.test', 1, 'student', 12,   'suspended');

-- Google links (tokens deliberately NULL: sign-in doesn't need them).
INSERT INTO auth_accounts (id, account_id, provider_id, user_id) VALUES
  ('acc_admin',    'google-sub-0000000001', 'google', 'usr_admin'),
  ('acc_teacher1', 'google-sub-0000000002', 'google', 'usr_teacher1'),
  ('acc_teacher2', 'google-sub-0000000003', 'google', 'usr_teacher2'),
  ('acc_student1', 'google-sub-0000000011', 'google', 'usr_student1'),
  ('acc_student2', 'google-sub-0000000012', 'google', 'usr_student2'),
  ('acc_student3', 'google-sub-0000000013', 'google', 'usr_student3'),
  ('acc_student4', 'google-sub-0000000014', 'google', 'usr_student4'),
  ('acc_student5', 'google-sub-0000000015', 'google', 'usr_student5');

INSERT INTO sessions (id, token, user_id, expires_at, user_agent) VALUES
  ('ses_student1', 'dev-session-token-student-1', 'usr_student1', unixepoch('2030-01-01') * 1000, 'dev seed'),
  ('ses_teacher1', 'dev-session-token-teacher-1', 'usr_teacher1', unixepoch('2030-01-01') * 1000, 'dev seed');

-- ===== SCHOOLS ==============================================================
INSERT INTO schools (id, name, short_name) VALUES
  ('sch_test', 'Pixel Test Secondary College', 'PTSC');

INSERT INTO school_members (id, school_id, user_id, role) VALUES
  ('sm_admin',    'sch_test', 'usr_admin',    'school_admin'),
  ('sm_teacher1', 'sch_test', 'usr_teacher1', 'teacher'),
  ('sm_teacher2', 'sch_test', 'usr_teacher2', 'teacher'),
  ('sm_student1', 'sch_test', 'usr_student1', 'student'),
  ('sm_student2', 'sch_test', 'usr_student2', 'student'),
  ('sm_student3', 'sch_test', 'usr_student3', 'student'),
  ('sm_student4', 'sch_test', 'usr_student4', 'student'),
  ('sm_student5', 'sch_test', 'usr_student5', 'student');

-- ===== CURRICULUM (global) ==================================================
-- Subjects come from migrations/0006_seed_subjects.sql.

INSERT INTO chapters (id, subject_id, code, title, position) VALUES
  ('ch_gen_1', 'sub_gen34', 'CH1', 'Investigating data distributions',   1),
  ('ch_gen_2', 'sub_gen34', 'CH2', 'Associations between two variables', 2),
  ('ch_gen_3', 'sub_gen34', 'CH3', 'Recursion and financial modelling',  3),
  ('ch_mm_1',  'sub_mm34',  'CH1', 'Functions, relations and graphs',    1),
  ('ch_mm_2',  'sub_mm34',  'CH2', 'Differentiation',                    2),
  ('ch_mm_3',  'sub_mm34',  'CH3', 'Discrete random variables',          3);

INSERT INTO topics (id, chapter_id, code, title, position) VALUES
  ('tp_gen_1a', 'ch_gen_1', '1A', 'Displaying and describing distributions', 1),
  ('tp_gen_1f', 'ch_gen_1', '1F', 'The normal distribution',                 2),
  ('tp_gen_2a', 'ch_gen_2', '2A', 'Scatterplots and correlation',            1),
  ('tp_gen_2c', 'ch_gen_2', '2C', 'Least squares regression',                2),
  ('tp_gen_3a', 'ch_gen_3', '3A', 'Recurrence relations',                    1),
  ('tp_gen_3d', 'ch_gen_3', '3D', 'Reducing balance loans',                  2),
  ('tp_mm_1a',  'ch_mm_1',  '1A', 'Transformations of functions',            1),
  ('tp_mm_2a',  'ch_mm_2',  '2A', 'Chain, product and quotient rules',       1),
  ('tp_mm_2b',  'ch_mm_2',  '2B', 'Tangents and stationary points',          2),
  ('tp_mm_3a',  'ch_mm_3',  '3A', 'Expected value and variance',             1);

INSERT INTO questions (id, subject_id, school_id, source_type, source_ref, year, exam, section, question_number,
                       format, marks, correct_option, image_key, solution_key, difficulty, state_pct_correct, created_by) VALUES
  ('q_gen_01', 'sub_gen34', NULL,       'vcaa_exam', 'TEST 2024 E1 Q1',  2024, 'E1', 'A', '1',  'multiple_choice',   1, 'C', 'dev/placeholder-q.png', 'dev/placeholder-s.json', 'easy',   80, 'usr_admin'),
  ('q_gen_02', 'sub_gen34', NULL,       'vcaa_exam', 'TEST 2024 E1 Q5',  2024, 'E1', 'A', '5',  'multiple_choice',   1, 'B', 'dev/placeholder-q.png', 'dev/placeholder-s.json', 'medium', 60, 'usr_admin'),
  ('q_gen_03', 'sub_gen34', NULL,       'vcaa_exam', 'TEST 2024 E2 Q2',  2024, 'E2', 'A', '2',  'short_answer',      3, NULL, 'dev/placeholder-q.png', 'dev/placeholder-s.json', 'medium', 50, 'usr_admin'),
  ('q_gen_04', 'sub_gen34', NULL,       'vcaa_exam', 'TEST 2023 E1 Q20', 2023, 'E1', 'A', '20', 'multiple_choice',   1, 'D', 'dev/placeholder-q.png', 'dev/placeholder-s.json', 'hard',   40, 'usr_admin'),
  ('q_gen_05', 'sub_gen34', 'sch_test', 'sac',       'TEST SAC 1 Q3',    2025, NULL, NULL, '3', 'extended_response', 4, NULL, 'dev/placeholder-q.png', 'dev/placeholder-s.json', 'medium', NULL, 'usr_teacher1'),
  ('q_mm_01',  'sub_mm34',  NULL,       'vcaa_exam', 'TEST 2024 E1 Q2',  2024, 'E1', NULL, '2', 'short_answer',      2, NULL, 'dev/placeholder-q.png', 'dev/placeholder-s.json', 'easy',   70, 'usr_admin'),
  ('q_mm_02',  'sub_mm34',  NULL,       'vcaa_exam', 'TEST 2024 E2 Q4',  2024, 'E2', 'A', '4',  'multiple_choice',   1, 'A', 'dev/placeholder-q.png', 'dev/placeholder-s.json', 'medium', 50, 'usr_admin'),
  ('q_mm_03',  'sub_mm34',  NULL,       'vcaa_exam', 'TEST 2023 E2 Q12', 2023, 'E2', 'A', '12', 'multiple_choice',   1, 'E', 'dev/placeholder-q.png', 'dev/placeholder-s.json', 'hard',   30, 'usr_admin');

INSERT INTO question_topics (question_id, topic_id, is_primary) VALUES
  ('q_gen_01', 'tp_gen_1a', 1),
  ('q_gen_02', 'tp_gen_1f', 1),
  ('q_gen_03', 'tp_gen_2c', 1), ('q_gen_03', 'tp_gen_2a', 0),   -- secondary tag
  ('q_gen_04', 'tp_gen_3d', 1), ('q_gen_04', 'tp_gen_3a', 0),
  ('q_gen_05', 'tp_gen_1a', 1),
  ('q_mm_01',  'tp_mm_2a',  1),
  ('q_mm_02',  'tp_mm_2b',  1),
  ('q_mm_03',  'tp_mm_3a',  1);

-- ===== CLASSES ==============================================================
INSERT INTO classes (id, school_id, subject_id, name, academic_year, join_code, default_chapter_access, created_by) VALUES
  ('cls_12gen_a', 'sch_test', 'sub_gen34', '12GEN-A',          2026, 'GENA26', 'locked', 'usr_teacher1'),
  ('cls_12mm_a',  'sch_test', 'sub_mm34',  '12MM-A',           2026, 'MMAB26', 'open',   'usr_teacher2'),
  ('cls_tutor',   NULL,       'sub_gen34', 'Tuesday tutoring', 2026, 'TUES26', 'open',   'usr_admin');   -- no school

INSERT INTO class_members (id, class_id, user_id, role) VALUES
  -- 12GEN-A: teacher1 + admin co-teaching; students 1-3 and 5
  ('cm_01', 'cls_12gen_a', 'usr_teacher1', 'teacher'),
  ('cm_02', 'cls_12gen_a', 'usr_admin',    'teacher'),
  ('cm_03', 'cls_12gen_a', 'usr_student1', 'student'),
  ('cm_04', 'cls_12gen_a', 'usr_student2', 'student'),
  ('cm_05', 'cls_12gen_a', 'usr_student3', 'student'),
  ('cm_06', 'cls_12gen_a', 'usr_student5', 'student'),
  -- 12MM-A: teacher2; students 1, 2, 4 (students 1 and 2 are in two classes)
  ('cm_07', 'cls_12mm_a',  'usr_teacher2', 'teacher'),
  ('cm_08', 'cls_12mm_a',  'usr_student1', 'student'),
  ('cm_09', 'cls_12mm_a',  'usr_student2', 'student'),
  ('cm_10', 'cls_12mm_a',  'usr_student4', 'student'),
  -- Tuesday tutoring (GEN34, no school): student 2's second GEN34 group
  ('cm_11', 'cls_tutor',   'usr_admin',    'teacher'),
  ('cm_12', 'cls_tutor',   'usr_student2', 'student');

-- ===== ACCESS CONTROL =======================================================
-- 12GEN-A defaults to locked: CH1 open now, CH2 opens 2 Feb 2030 (future), CH3 explicitly locked.
INSERT INTO chapter_access (id, class_id, chapter_id, access, opens_at, closes_at, set_by) VALUES
  ('ca_01', 'cls_12gen_a', 'ch_gen_1', 'open',   NULL,                            NULL, 'usr_teacher1'),
  ('ca_02', 'cls_12gen_a', 'ch_gen_2', 'open',   unixepoch('2030-02-02') * 1000, NULL, 'usr_teacher1'),
  ('ca_03', 'cls_12gen_a', 'ch_gen_3', 'locked', NULL,                            NULL, 'usr_teacher1'),
  -- 12MM-A defaults to open but locks probability until it is taught.
  ('ca_04', 'cls_12mm_a',  'ch_mm_3',  'locked', NULL,                            NULL, 'usr_teacher2');

INSERT INTO student_access_overrides (id, class_id, student_id, chapter_id, access, reason, expires_at, created_by) VALUES
  -- Priya gets GEN CH3 early in 12GEN-A (extension work)
  ('sao_01', 'cls_12gen_a', 'usr_student3', 'ch_gen_3', 'grant', 'Extension work', NULL, 'usr_teacher1'),
  -- Marco (Year 11 in MM34) is held back from differentiation until 2030
  ('sao_02', 'cls_12mm_a',  'usr_student4', 'ch_mm_2',  'deny',  'Catch up on CH1 first', unixepoch('2030-01-31') * 1000, 'usr_teacher2');

-- ===== ASSIGNMENTS ==========================================================
INSERT INTO assignments (id, class_id, created_by, title, instructions_md, status, opens_at, due_at, solutions_visibility, published_at) VALUES
  ('asg_01', 'cls_12gen_a', 'usr_teacher1', 'Data distributions check-in', 'Answer all three questions. Show working for Q3.',
     'published', unixepoch('2026-11-10T22:00:00Z') * 1000, unixepoch('2026-11-17T12:59:00Z') * 1000, 'after_due', unixepoch('2026-11-10T21:30:00Z') * 1000),
  ('asg_02', 'cls_12mm_a',  'usr_teacher2', 'Differentiation warm-up', NULL,
     'draft', NULL, unixepoch('2026-11-25T12:59:00Z') * 1000, 'after_submit', NULL);

INSERT INTO assignment_questions (id, assignment_id, question_id, position, marks_override) VALUES
  ('aq_01', 'asg_01', 'q_gen_01', 1, NULL),
  ('aq_02', 'asg_01', 'q_gen_02', 2, NULL),
  ('aq_03', 'asg_01', 'q_gen_05', 3, NULL),
  ('aq_04', 'asg_02', 'q_mm_01',  1, NULL),
  ('aq_05', 'asg_02', 'q_mm_02',  2, 2);

INSERT INTO assignment_submissions (id, assignment_id, student_id, status, started_at, submitted_at, is_late, score, max_score, feedback_md, marked_by, marked_at) VALUES
  ('subm_01', 'asg_01', 'usr_student1', 'marked',      unixepoch('2026-11-12T08:00:00Z') * 1000, unixepoch('2026-11-12T08:25:00Z') * 1000, 0, 5, 6, 'Good comparison of spread; mention outliers.', 'usr_teacher1', unixepoch('2026-11-13T03:00:00Z') * 1000),
  ('subm_02', 'asg_01', 'usr_student2', 'submitted',   unixepoch('2026-11-17T10:00:00Z') * 1000, unixepoch('2026-11-17T13:10:00Z') * 1000, 1, NULL, 6, NULL, NULL, NULL),
  ('subm_03', 'asg_01', 'usr_student3', 'in_progress', unixepoch('2026-11-16T09:00:00Z') * 1000, NULL, 0, NULL, 6, NULL, NULL, NULL);

-- ===== PROGRESS =============================================================
INSERT INTO question_attempts (id, user_id, question_id, class_id, submission_id, source, selected_option, response_json,
                               marks_awarded, marks_available, is_correct, marked_by, solution_viewed, is_redo, duration_seconds, started_at, submitted_at) VALUES
  -- assignment answers
  ('att_01', 'usr_student1', 'q_gen_01', 'cls_12gen_a', 'subm_01', 'assignment', 'C', NULL, 1, 1, 1, 'auto', 0, 0, 70,
     unixepoch('2026-11-12T08:00:00Z') * 1000, unixepoch('2026-11-12T08:01:10Z') * 1000),
  ('att_02', 'usr_student1', 'q_gen_02', 'cls_12gen_a', 'subm_01', 'assignment', 'B', NULL, 1, 1, 1, 'auto', 0, 0, 95,
     unixepoch('2026-11-12T08:01:10Z') * 1000, unixepoch('2026-11-12T08:02:45Z') * 1000),
  ('att_03', 'usr_student1', 'q_gen_05', 'cls_12gen_a', 'subm_01', 'assignment', NULL, '{"parts":{"a":3}}', 3, 4, 0, 'teacher', 0, 0, 1300,
     unixepoch('2026-11-12T08:03:00Z') * 1000, unixepoch('2026-11-12T08:25:00Z') * 1000),
  ('att_04', 'usr_student2', 'q_gen_01', 'cls_12gen_a', 'subm_02', 'assignment', 'A', NULL, 0, 1, 0, 'auto', 0, 0, 40,
     unixepoch('2026-11-17T10:00:00Z') * 1000, unixepoch('2026-11-17T10:00:40Z') * 1000),
  -- self-directed practice
  ('att_05', 'usr_student1', 'q_mm_01',  NULL, NULL, 'daily', NULL, '{"parts":{"a":2}}', 2, 2, 1, 'self', 0, 0, 180,
     unixepoch('2026-11-15T07:00:00Z') * 1000, unixepoch('2026-11-15T07:03:00Z') * 1000),
  ('att_06', 'usr_student2', 'q_gen_04', NULL, NULL, 'topic', 'B', NULL, 0, 1, 0, 'auto', 1, 0, 120,
     unixepoch('2026-11-16T09:00:00Z') * 1000, unixepoch('2026-11-16T09:02:00Z') * 1000),
  ('att_07', 'usr_student2', 'q_gen_04', NULL, NULL, 'daily', 'D', NULL, 1, 1, 1, 'auto', 0, 1, 60,
     unixepoch('2026-11-17T09:00:00Z') * 1000, unixepoch('2026-11-17T09:01:00Z') * 1000),
  ('att_08', 'usr_student4', 'q_mm_02',  NULL, NULL, 'free',  'C', NULL, 0, 1, 0, 'auto', 0, 0, 90,
     unixepoch('2026-11-17T18:00:00Z') * 1000, unixepoch('2026-11-17T18:01:30Z') * 1000);

INSERT INTO student_progress (user_id, question_id, attempts_count, correct_count, best_marks, last_marks,
                              first_attempted_at, last_attempted_at, srs_step, srs_interval_days, srs_due_at, mastery, on_fix_list) VALUES
  ('usr_student1', 'q_gen_01', 1, 1, 1, 1, unixepoch('2026-11-12T08:01:10Z') * 1000, unixepoch('2026-11-12T08:01:10Z') * 1000, 1, 1, unixepoch('2026-11-13T08:01:10Z') * 1000, 0.60, 0),
  ('usr_student1', 'q_gen_02', 1, 1, 1, 1, unixepoch('2026-11-12T08:02:45Z') * 1000, unixepoch('2026-11-12T08:02:45Z') * 1000, 1, 1, unixepoch('2026-11-13T08:02:45Z') * 1000, 0.60, 0),
  ('usr_student1', 'q_gen_05', 1, 0, 3, 3, unixepoch('2026-11-12T08:25:00Z') * 1000, unixepoch('2026-11-12T08:25:00Z') * 1000, 0, 1, unixepoch('2026-11-13T08:25:00Z') * 1000, 0.45, 1),
  ('usr_student1', 'q_mm_01',  1, 1, 2, 2, unixepoch('2026-11-15T07:03:00Z') * 1000, unixepoch('2026-11-15T07:03:00Z') * 1000, 1, 1, unixepoch('2026-11-16T07:03:00Z') * 1000, 0.60, 0),
  ('usr_student2', 'q_gen_01', 1, 0, 0, 0, unixepoch('2026-11-17T10:00:40Z') * 1000, unixepoch('2026-11-17T10:00:40Z') * 1000, 0, 1, unixepoch('2026-11-18T10:00:40Z') * 1000, 0.10, 1),
  ('usr_student2', 'q_gen_04', 2, 1, 1, 1, unixepoch('2026-11-16T09:02:00Z') * 1000, unixepoch('2026-11-17T09:01:00Z') * 1000, 1, 1, unixepoch('2026-11-18T09:01:00Z') * 1000, 0.40, 0),
  ('usr_student4', 'q_mm_02',  1, 0, 0, 0, unixepoch('2026-11-17T18:01:30Z') * 1000, unixepoch('2026-11-17T18:01:30Z') * 1000, 0, 1, unixepoch('2026-11-18T18:01:30Z') * 1000, 0.10, 1);

INSERT INTO achievements (id, code, name, description, category, icon_key, criteria_json, points) VALUES
  ('ach_first',    'first_question', 'First steps',  'Answer your first question.',      'volume',     'dev/badge-first.png',  '{"attempts":1}',         5),
  ('ach_streak7',  'streak_7',       'Week on fire', 'Practise seven days in a row.',    'streak',     'dev/badge-streak.png', '{"streak_days":7}',      25),
  ('ach_fullmark', 'full_marks_set', 'Clean sheet',  'Get full marks on an assignment.', 'assignment', 'dev/badge-clean.png',  '{"assignment_pct":100}', 20);

INSERT INTO user_achievements (id, user_id, achievement_id, awarded_at, context_json) VALUES
  ('ua_01', 'usr_student1', 'ach_first', unixepoch('2026-11-12T08:01:10Z') * 1000, '{"subject":"GEN34"}'),
  ('ua_02', 'usr_student2', 'ach_first', unixepoch('2026-11-16T09:02:00Z') * 1000, '{"subject":"GEN34"}'),
  ('ua_03', 'usr_student4', 'ach_first', unixepoch('2026-11-17T18:01:30Z') * 1000, '{"subject":"MM34"}');

-- Profiles (migration 0009): seeded accounts have already been through /welcome.
UPDATE users SET onboarded_at = unixepoch() * 1000,
  first_name = CASE id WHEN 'usr_admin' THEN 'Andy' WHEN 'usr_teacher1' THEN 'Maria' WHEN 'usr_teacher2' THEN 'Daniel'
    WHEN 'usr_student1' THEN 'Lena' WHEN 'usr_student2' THEN 'Tom' WHEN 'usr_student3' THEN 'Priya' WHEN 'usr_student4' THEN 'Marco' ELSE 'Jess' END,
  last_name = CASE id WHEN 'usr_admin' THEN 'Admin' WHEN 'usr_teacher1' THEN 'Rivera' WHEN 'usr_teacher2' THEN 'Okafor'
    WHEN 'usr_student1' THEN 'Nguyen' WHEN 'usr_student2' THEN 'Brown' WHEN 'usr_student3' THEN 'Singh' WHEN 'usr_student4' THEN 'Di Stefano' ELSE 'Walker' END;
INSERT INTO user_subjects (user_id, subject_id) VALUES
  ('usr_student1', 'sub_gen34'), ('usr_student1', 'sub_mm34'), ('usr_student2', 'sub_gen34'), ('usr_student3', 'sub_mm34'), ('usr_student4', 'sub_gen34');
