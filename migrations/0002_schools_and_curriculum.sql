-- Migration 0002: schools and the global curriculum
-- schools, school_members, subjects, chapters, topics, questions, question_topics
--
-- Curriculum tables (subjects -> chapters -> topics, questions) hold NO class
-- information. Who may see what is decided in 0003 (chapter_access,
-- student_access_overrides). Curriculum rows are retired with is_active = 0
-- rather than deleted, and deletes are RESTRICTed while anything depends on them.
--
-- Question content (images, worked solutions) is never stored here or in git:
-- only keys into the private R2 bucket (binding CONTENT).

-- ---------------------------------------------------------------------------
-- schools
-- ---------------------------------------------------------------------------
CREATE TABLE `schools` (
    `id`         TEXT PRIMARY KEY NOT NULL,
    `name`       TEXT NOT NULL,
    `short_name` TEXT,
    `state`      TEXT DEFAULT 'VIC' NOT NULL,
    `timezone`   TEXT DEFAULT 'Australia/Melbourne' NOT NULL,
    `is_active`  INTEGER DEFAULT 1 NOT NULL CHECK (`is_active` IN (0, 1)),
    `created_at` INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `updated_at` INTEGER DEFAULT (unixepoch() * 1000) NOT NULL
);

CREATE UNIQUE INDEX `ux_schools_name_state` ON `schools` (`name`, `state`);

CREATE TRIGGER `trg_schools_updated_at` AFTER UPDATE ON `schools`
FOR EACH ROW WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
    UPDATE `schools` SET `updated_at` = (unixepoch() * 1000) WHERE `id` = NEW.`id`;
END;

-- ---------------------------------------------------------------------------
-- school_members: which users belong to which school, and in what capacity.
-- Many-to-many, so a teacher can work at two schools and a student can change
-- schools without a new account.
-- ---------------------------------------------------------------------------
CREATE TABLE `school_members` (
    `id`         TEXT PRIMARY KEY NOT NULL,
    `school_id`  TEXT NOT NULL REFERENCES `schools` (`id`) ON DELETE CASCADE,
    `user_id`    TEXT NOT NULL REFERENCES `users` (`id`) ON DELETE CASCADE,
    `role`       TEXT NOT NULL CHECK (`role` IN ('student', 'teacher', 'school_admin')),
    `created_at` INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `updated_at` INTEGER DEFAULT (unixepoch() * 1000) NOT NULL
);

CREATE UNIQUE INDEX `ux_school_members` ON `school_members` (`school_id`, `user_id`);
CREATE INDEX `ix_school_members_user` ON `school_members` (`user_id`);

CREATE TRIGGER `trg_school_members_updated_at` AFTER UPDATE ON `school_members`
FOR EACH ROW WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
    UPDATE `school_members` SET `updated_at` = (unixepoch() * 1000) WHERE `id` = NEW.`id`;
END;

-- ---------------------------------------------------------------------------
-- subjects: e.g. GEN34 General Mathematics Units 3&4
-- ---------------------------------------------------------------------------
CREATE TABLE `subjects` (
    `id`           TEXT PRIMARY KEY NOT NULL,
    `code`         TEXT NOT NULL,                 -- GEN34, MM34, CHEM34
    `name`         TEXT NOT NULL,
    `study_design` TEXT,                          -- e.g. '2023-2027'
    `position`     INTEGER DEFAULT 0 NOT NULL,
    `is_active`    INTEGER DEFAULT 1 NOT NULL CHECK (`is_active` IN (0, 1)),
    `created_at`   INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `updated_at`   INTEGER DEFAULT (unixepoch() * 1000) NOT NULL
);

CREATE UNIQUE INDEX `ux_subjects_code` ON `subjects` (`code`);

CREATE TRIGGER `trg_subjects_updated_at` AFTER UPDATE ON `subjects`
FOR EACH ROW WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
    UPDATE `subjects` SET `updated_at` = (unixepoch() * 1000) WHERE `id` = NEW.`id`;
END;

-- ---------------------------------------------------------------------------
-- chapters: ordered units within a subject (a Cambridge chapter or area of
-- study). The unit teachers open or lock for a class.
-- ---------------------------------------------------------------------------
CREATE TABLE `chapters` (
    `id`          TEXT PRIMARY KEY NOT NULL,
    `subject_id`  TEXT NOT NULL REFERENCES `subjects` (`id`) ON DELETE RESTRICT,
    `code`        TEXT,                           -- e.g. 'CH1'
    `title`       TEXT NOT NULL,
    `description` TEXT,
    `position`    INTEGER NOT NULL,
    `is_active`   INTEGER DEFAULT 1 NOT NULL CHECK (`is_active` IN (0, 1)),
    `created_at`  INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `updated_at`  INTEGER DEFAULT (unixepoch() * 1000) NOT NULL
);

CREATE UNIQUE INDEX `ux_chapters_position` ON `chapters` (`subject_id`, `position`);
CREATE UNIQUE INDEX `ux_chapters_code` ON `chapters` (`subject_id`, `code`);

CREATE TRIGGER `trg_chapters_updated_at` AFTER UPDATE ON `chapters`
FOR EACH ROW WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
    UPDATE `chapters` SET `updated_at` = (unixepoch() * 1000) WHERE `id` = NEW.`id`;
END;

-- ---------------------------------------------------------------------------
-- topics: ordered sections within a chapter (e.g. exercise 1F)
-- ---------------------------------------------------------------------------
CREATE TABLE `topics` (
    `id`         TEXT PRIMARY KEY NOT NULL,
    `chapter_id` TEXT NOT NULL REFERENCES `chapters` (`id`) ON DELETE RESTRICT,
    `code`       TEXT,                            -- e.g. '1F'
    `title`      TEXT NOT NULL,
    `position`   INTEGER NOT NULL,
    `is_active`  INTEGER DEFAULT 1 NOT NULL CHECK (`is_active` IN (0, 1)),
    `created_at` INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `updated_at` INTEGER DEFAULT (unixepoch() * 1000) NOT NULL
);

CREATE UNIQUE INDEX `ux_topics_position` ON `topics` (`chapter_id`, `position`);
CREATE UNIQUE INDEX `ux_topics_code` ON `topics` (`chapter_id`, `code`);

CREATE TRIGGER `trg_topics_updated_at` AFTER UPDATE ON `topics`
FOR EACH ROW WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
    UPDATE `topics` SET `updated_at` = (unixepoch() * 1000) WHERE `id` = NEW.`id`;
END;

-- ---------------------------------------------------------------------------
-- questions: past-exam, SAC, textbook and custom questions
-- school_id NULL = global content (VCAA exams), visible to every school.
-- school_id set  = private to that school (e.g. its SAC questions).
-- ---------------------------------------------------------------------------
CREATE TABLE `questions` (
    `id`                TEXT PRIMARY KEY NOT NULL,
    `subject_id`        TEXT NOT NULL REFERENCES `subjects` (`id`) ON DELETE RESTRICT,
    `school_id`         TEXT REFERENCES `schools` (`id`) ON DELETE RESTRICT,
    `source_type`       TEXT NOT NULL CHECK (`source_type` IN ('vcaa_exam', 'sac', 'textbook', 'custom')),
    `source_ref`        TEXT NOT NULL,            -- '2021 E1 M2 Q1', 'SAC 2 2025 Q3'
    `year`              INTEGER CHECK (`year` IS NULL OR `year` BETWEEN 2000 AND 2100),
    `exam`              TEXT CHECK (`exam` IS NULL OR `exam` IN ('E1', 'E2')),
    `is_nht`            INTEGER DEFAULT 0 NOT NULL CHECK (`is_nht` IN (0, 1)),
    `section`           TEXT,                     -- 'A', 'B', or a module name
    `question_number`   TEXT,
    `format`            TEXT NOT NULL CHECK (`format` IN ('multiple_choice', 'short_answer', 'extended_response')),
    `marks`             INTEGER NOT NULL CHECK (`marks` > 0),
    `correct_option`    TEXT CHECK (`correct_option` IS NULL OR `correct_option` IN ('A', 'B', 'C', 'D', 'E')),
    `image_key`         TEXT,                     -- R2 key of the question image
    `solution_key`      TEXT,                     -- R2 key of the solution / examiner notes bundle
    `difficulty`        TEXT CHECK (`difficulty` IS NULL OR `difficulty` IN ('easy', 'medium', 'hard')),
    `state_pct_correct` REAL CHECK (`state_pct_correct` IS NULL OR `state_pct_correct` BETWEEN 0 AND 100),
    `in_study_design`   INTEGER DEFAULT 1 NOT NULL CHECK (`in_study_design` IN (0, 1)),
    `is_active`         INTEGER DEFAULT 1 NOT NULL CHECK (`is_active` IN (0, 1)),
    `created_by`        TEXT REFERENCES `users` (`id`) ON DELETE SET NULL,
    `created_at`        INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `updated_at`        INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    CONSTRAINT `ck_questions_sac_has_school` CHECK (`source_type` <> 'sac' OR `school_id` IS NOT NULL),
    CONSTRAINT `ck_questions_mc_answer` CHECK (`format` = 'multiple_choice' OR `correct_option` IS NULL)
);

-- One source_ref per subject among global questions, and per subject per school
-- among school-private ones (two partial indexes, because NULLs never collide).
CREATE UNIQUE INDEX `ux_questions_source_global` ON `questions` (`subject_id`, `source_ref`) WHERE `school_id` IS NULL;
CREATE UNIQUE INDEX `ux_questions_source_school` ON `questions` (`subject_id`, `school_id`, `source_ref`) WHERE `school_id` IS NOT NULL;
CREATE INDEX `ix_questions_subject_paper` ON `questions` (`subject_id`, `year`, `exam`);
CREATE INDEX `ix_questions_school` ON `questions` (`school_id`) WHERE `school_id` IS NOT NULL;
CREATE INDEX `ix_questions_created_by` ON `questions` (`created_by`);

CREATE TRIGGER `trg_questions_updated_at` AFTER UPDATE ON `questions`
FOR EACH ROW WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
    UPDATE `questions` SET `updated_at` = (unixepoch() * 1000) WHERE `id` = NEW.`id`;
END;

-- ---------------------------------------------------------------------------
-- question_topics: a question can carry several topic tags; exactly one per
-- question may be primary, and the primary topic's chapter decides whether a
-- student can see the question.
-- ---------------------------------------------------------------------------
CREATE TABLE `question_topics` (
    `question_id` TEXT NOT NULL REFERENCES `questions` (`id`) ON DELETE CASCADE,
    `topic_id`    TEXT NOT NULL REFERENCES `topics` (`id`) ON DELETE RESTRICT,
    `is_primary`  INTEGER DEFAULT 0 NOT NULL CHECK (`is_primary` IN (0, 1)),
    `created_at`  INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    PRIMARY KEY (`question_id`, `topic_id`)
);

CREATE INDEX `ix_question_topics_topic` ON `question_topics` (`topic_id`);
CREATE UNIQUE INDEX `ux_question_topics_primary` ON `question_topics` (`question_id`) WHERE `is_primary` = 1;
