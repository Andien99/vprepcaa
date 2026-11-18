-- Extra seed data for the student dashboard. LOCAL test environment only; load it
-- after seeds/dev.sql (npm run db:seed:local does both). Fictional, like dev.sql:
-- question refs start with "TEST" and nothing here comes from a VCAA paper.
--
-- Times are relative to when the seed runs (unixepoch('now', ...)), so Lena
-- (usr_student1) always has a live daily-question streak, homework that is due
-- soon, and recent results to show.

-- ===== More practice questions in the chapters Lena can see =================
INSERT INTO questions (id, subject_id, school_id, source_type, source_ref, year, exam, section, question_number,
                       format, marks, correct_option, image_key, solution_key, difficulty, state_pct_correct, created_by) VALUES
  ('q_gen_06', 'sub_gen34', NULL, 'vcaa_exam', 'TEST 2022 E1 Q3',  2022, 'E1', 'A', '3',  'multiple_choice', 1, 'A', 'dev/placeholder-q.png', 'dev/placeholder-s.json', 'easy',   85, 'usr_admin'),
  ('q_gen_07', 'sub_gen34', NULL, 'vcaa_exam', 'TEST 2022 E1 Q7',  2022, 'E1', 'A', '7',  'multiple_choice', 1, 'E', 'dev/placeholder-q.png', 'dev/placeholder-s.json', 'medium', 55, 'usr_admin'),
  ('q_gen_08', 'sub_gen34', NULL, 'vcaa_exam', 'TEST 2022 E2 Q1',  2022, 'E2', 'A', '1',  'short_answer',    2, NULL, 'dev/placeholder-q.png', 'dev/placeholder-s.json', 'medium', 48, 'usr_admin'),
  ('q_gen_09', 'sub_gen34', NULL, 'vcaa_exam', 'TEST 2021 E1 Q9',  2021, 'E1', 'A', '9',  'multiple_choice', 1, 'B', 'dev/placeholder-q.png', 'dev/placeholder-s.json', 'hard',   31, 'usr_admin'),
  ('q_gen_10', 'sub_gen34', NULL, 'vcaa_exam', 'TEST 2021 E2 Q2',  2021, 'E2', 'A', '2',  'short_answer',    3, NULL, 'dev/placeholder-q.png', 'dev/placeholder-s.json', 'easy',   72, 'usr_admin'),
  ('q_mm_04',  'sub_mm34',  NULL, 'vcaa_exam', 'TEST 2022 E1 Q1',  2022, 'E1', NULL, '1', 'short_answer',    3, NULL, 'dev/placeholder-q.png', 'dev/placeholder-s.json', 'easy',   74, 'usr_admin'),
  ('q_mm_05',  'sub_mm34',  NULL, 'vcaa_exam', 'TEST 2022 E2 Q6',  2022, 'E2', 'A', '6',  'multiple_choice', 1, 'C', 'dev/placeholder-q.png', 'dev/placeholder-s.json', 'medium', 52, 'usr_admin'),
  ('q_mm_06',  'sub_mm34',  NULL, 'vcaa_exam', 'TEST 2021 E2 Q9',  2021, 'E2', 'A', '9',  'multiple_choice', 1, 'D', 'dev/placeholder-q.png', 'dev/placeholder-s.json', 'hard',   28, 'usr_admin'),
  ('q_mm_07',  'sub_mm34',  NULL, 'vcaa_exam', 'TEST 2021 E1 Q4',  2021, 'E1', NULL, '4', 'short_answer',    4, NULL, 'dev/placeholder-q.png', 'dev/placeholder-s.json', 'medium', 45, 'usr_admin');

INSERT INTO question_topics (question_id, topic_id, is_primary) VALUES
  ('q_gen_06', 'tp_gen_1a', 1), ('q_gen_07', 'tp_gen_1f', 1), ('q_gen_08', 'tp_gen_1f', 1),
  ('q_gen_09', 'tp_gen_1a', 1), ('q_gen_10', 'tp_gen_1a', 1),
  ('q_mm_04',  'tp_mm_1a',  1), ('q_mm_05',  'tp_mm_1a',  1), ('q_mm_06',  'tp_mm_2b',  1), ('q_mm_07', 'tp_mm_2a', 1);

-- ===== Homework that is open now =============================================
INSERT INTO assignments (id, class_id, created_by, title, instructions_md, status, opens_at, due_at, solutions_visibility, published_at) VALUES
  ('asg_03', 'cls_12mm_a',  'usr_teacher2', 'Transformations practice', 'Do these before Thursday''s lesson.',
     'published', unixepoch('now', '-2 days') * 1000, unixepoch('now', '+1 day') * 1000, 'after_submit', unixepoch('now', '-2 days') * 1000),
  ('asg_04', 'cls_12gen_a', 'usr_teacher1', 'Normal distribution revision', NULL,
     'published', unixepoch('now', '-1 day') * 1000, unixepoch('now', '+6 days') * 1000, 'after_due', unixepoch('now', '-1 day') * 1000),
  ('asg_05', 'cls_12gen_a', 'usr_teacher1', 'Next week''s set (not open yet)', NULL,
     'published', unixepoch('now', '+3 days') * 1000, unixepoch('now', '+9 days') * 1000, 'after_due', unixepoch('now', '-1 day') * 1000);

INSERT INTO assignment_questions (id, assignment_id, question_id, position) VALUES
  ('aq_06', 'asg_03', 'q_mm_04', 1), ('aq_07', 'asg_03', 'q_mm_05', 2), ('aq_08', 'asg_03', 'q_mm_07', 3),
  ('aq_09', 'asg_04', 'q_gen_02', 1), ('aq_10', 'asg_04', 'q_gen_07', 2), ('aq_11', 'asg_04', 'q_gen_08', 3),
  ('aq_12', 'asg_05', 'q_gen_06', 1);

INSERT INTO assignment_submissions (id, assignment_id, student_id, status, started_at) VALUES
  ('subm_04', 'asg_03', 'usr_student1', 'in_progress', unixepoch('now', '-1 day') * 1000);

-- ===== Lena's daily questions: a five-day run ending yesterday =================
INSERT INTO question_attempts (id, user_id, question_id, class_id, submission_id, source, selected_option,
                               marks_awarded, marks_available, is_correct, marked_by, submitted_at) VALUES
  ('att_d01', 'usr_student1', 'q_gen_06', NULL, NULL, 'daily', 'A', 1, 1, 1, 'auto', unixepoch('now', '-5 days') * 1000),
  ('att_d02', 'usr_student1', 'q_mm_04',  NULL, NULL, 'daily', NULL, 2, 3, 0, 'self', unixepoch('now', '-5 days', '+5 minutes') * 1000),
  ('att_d03', 'usr_student1', 'q_gen_07', NULL, NULL, 'daily', 'C', 0, 1, 0, 'auto', unixepoch('now', '-4 days') * 1000),
  ('att_d04', 'usr_student1', 'q_mm_05',  NULL, NULL, 'daily', 'C', 1, 1, 1, 'auto', unixepoch('now', '-3 days') * 1000),
  ('att_d05', 'usr_student1', 'q_gen_10', NULL, NULL, 'daily', NULL, 3, 3, 1, 'self', unixepoch('now', '-2 days') * 1000),
  ('att_d06', 'usr_student1', 'q_gen_08', NULL, NULL, 'daily', NULL, 1, 2, 0, 'self', unixepoch('now', '-1 day') * 1000),
  ('att_d07', 'usr_student1', 'q_mm_06',  NULL, NULL, 'daily', 'B', 0, 1, 0, 'auto', unixepoch('now', '-1 day', '+3 minutes') * 1000);

-- Homework answer already given in the in-progress submission
INSERT INTO question_attempts (id, user_id, question_id, class_id, submission_id, source, marks_awarded, marks_available, is_correct, marked_by, submitted_at) VALUES
  ('att_h01', 'usr_student1', 'q_mm_04', 'cls_12mm_a', 'subm_04', 'assignment', 3, 3, 1, 'self', unixepoch('now', '-1 day', '+10 minutes') * 1000);
