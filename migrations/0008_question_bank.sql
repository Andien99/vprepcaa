-- Migration 0008: the question bank (the Notion question-bank design, in D1)
--
-- Mirrors Andy's Notion databases ("VCAA Mathematical Methods — Question Bank",
-- "VCAA General Mathematics 3&4 — Question Bank"):
--   Question (title)      questions.source_ref, named by convention, see web/js/naming.js
--   Paper                 papers         ('2024_VCAA_E1', '2024_VCAA-NHT_E2')
--   Study design area     study_areas    + question_area_tags   (coloured)
--   Question type         question_types + question_type_tags   (coloured by their area)
--   Difficulty, Marks, State average, Share scoring zero, How often, Top distractor,
--   Tag source            columns on questions
-- Colours are Notion's names, so tags look the same as they did in Notion:
-- default, gray, brown, orange, yellow, green, blue, purple, pink, red.
--
-- Chapters/topics (migration 0002) stay the teaching units teachers open and lock;
-- study areas and question types are how the bank is classified and filtered, and
-- question types are the unit the daily-question algorithm tracks mastery on.

CREATE TABLE `study_areas` (
    `id`          TEXT PRIMARY KEY NOT NULL,
    `subject_id`  TEXT NOT NULL REFERENCES `subjects` (`id`) ON DELETE CASCADE,
    `code`        TEXT NOT NULL,               -- 'AOS1', 'DATA'
    `name`        TEXT NOT NULL,               -- 'AoS1 Functions relations and graphs'
    `colour`      TEXT DEFAULT 'default' NOT NULL
                  CHECK (`colour` IN ('default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red')),
    `position`    INTEGER DEFAULT 0 NOT NULL,
    `created_at`  INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `updated_at`  INTEGER DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE UNIQUE INDEX `ux_study_areas_code` ON `study_areas` (`subject_id`, `code`);

CREATE TABLE `question_types` (
    `id`             TEXT PRIMARY KEY NOT NULL,
    `subject_id`     TEXT NOT NULL REFERENCES `subjects` (`id`) ON DELETE CASCADE,
    `study_area_id`  TEXT REFERENCES `study_areas` (`id`) ON DELETE SET NULL,
    `name`           TEXT NOT NULL,            -- 'Chain rule'
    `colour`         TEXT                      -- NULL: use the study area's colour
                     CHECK (`colour` IS NULL OR `colour` IN ('default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red')),
    `position`       INTEGER DEFAULT 0 NOT NULL,
    `is_active`      INTEGER DEFAULT 1 NOT NULL CHECK (`is_active` IN (0, 1)),
    `created_by`     TEXT REFERENCES `users` (`id`) ON DELETE SET NULL,
    `created_at`     INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `updated_at`     INTEGER DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE UNIQUE INDEX `ux_question_types_name` ON `question_types` (`subject_id`, `name`);
CREATE INDEX `ix_question_types_area` ON `question_types` (`study_area_id`);

CREATE TABLE `question_type_tags` (
    `question_id`       TEXT NOT NULL REFERENCES `questions` (`id`) ON DELETE CASCADE,
    `question_type_id`  TEXT NOT NULL REFERENCES `question_types` (`id`) ON DELETE CASCADE,
    `is_primary`        INTEGER DEFAULT 0 NOT NULL CHECK (`is_primary` IN (0, 1)),
    PRIMARY KEY (`question_id`, `question_type_id`)
);
CREATE UNIQUE INDEX `ux_question_type_tags_primary` ON `question_type_tags` (`question_id`) WHERE `is_primary` = 1;
CREATE INDEX `ix_question_type_tags_type` ON `question_type_tags` (`question_type_id`);

CREATE TABLE `question_area_tags` (
    `question_id`    TEXT NOT NULL REFERENCES `questions` (`id`) ON DELETE CASCADE,
    `study_area_id`  TEXT NOT NULL REFERENCES `study_areas` (`id`) ON DELETE CASCADE,
    PRIMARY KEY (`question_id`, `study_area_id`)
);
CREATE INDEX `ix_question_area_tags_area` ON `question_area_tags` (`study_area_id`);

-- One row per exam paper. A new exam is a new paper; its questions point at it.
CREATE TABLE `papers` (
    `id`            TEXT PRIMARY KEY NOT NULL,
    `subject_id`    TEXT NOT NULL REFERENCES `subjects` (`id`) ON DELETE CASCADE,
    `school_id`     TEXT REFERENCES `schools` (`id`) ON DELETE CASCADE,   -- NULL: shared (VCAA)
    `code`          TEXT NOT NULL,             -- '2024_VCAA_E1', '2023_VCAA-NHT_E2', '2025_SAC2'
    `name`          TEXT NOT NULL,             -- '2024 Exam 1'
    `source`        TEXT DEFAULT 'vcaa' NOT NULL CHECK (`source` IN ('vcaa', 'vcaa_nht', 'sac', 'trial', 'other')),
    `year`          INTEGER CHECK (`year` IS NULL OR `year` BETWEEN 2000 AND 2100),
    `exam`          TEXT CHECK (`exam` IS NULL OR `exam` IN ('E1', 'E2')),
    `is_published`  INTEGER DEFAULT 1 NOT NULL CHECK (`is_published` IN (0, 1)),
    `created_by`    TEXT REFERENCES `users` (`id`) ON DELETE SET NULL,
    `created_at`    INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `updated_at`    INTEGER DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE UNIQUE INDEX `ux_papers_code_global` ON `papers` (`subject_id`, `code`) WHERE `school_id` IS NULL;
CREATE UNIQUE INDEX `ux_papers_code_school` ON `papers` (`subject_id`, `school_id`, `code`) WHERE `school_id` IS NOT NULL;

ALTER TABLE `questions` ADD `paper_id` TEXT REFERENCES `papers` (`id`) ON DELETE SET NULL;
ALTER TABLE `questions` ADD `state_avg` REAL CHECK (`state_avg` IS NULL OR `state_avg` >= 0);
ALTER TABLE `questions` ADD `zero_pct` REAL CHECK (`zero_pct` IS NULL OR `zero_pct` BETWEEN 0 AND 100);
ALTER TABLE `questions` ADD `how_often` TEXT
    CHECK (`how_often` IS NULL OR `how_often` IN ('every_year', 'two_of_three', 'repeated_within_year', 'once', 'not_classified'));
ALTER TABLE `questions` ADD `top_distractor` TEXT;
ALTER TABLE `questions` ADD `tag_source` TEXT
    CHECK (`tag_source` IS NULL OR `tag_source` IN ('keyword', 'ocr_verify', 'solutions', 'reviewed'));
ALTER TABLE `questions` ADD `updated_by` TEXT REFERENCES `users` (`id`) ON DELETE SET NULL;
CREATE INDEX `ix_questions_paper` ON `questions` (`paper_id`);

-- A student's starred questions (their own revision list).
CREATE TABLE `question_stars` (
    `user_id`      TEXT NOT NULL REFERENCES `users` (`id`) ON DELETE CASCADE,
    `question_id`  TEXT NOT NULL REFERENCES `questions` (`id`) ON DELETE CASCADE,
    `created_at`   INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    PRIMARY KEY (`user_id`, `question_id`)
);

CREATE TRIGGER `trg_study_areas_updated_at` AFTER UPDATE ON `study_areas`
FOR EACH ROW WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
    UPDATE `study_areas` SET `updated_at` = (unixepoch() * 1000) WHERE `id` = NEW.`id`;
END;
CREATE TRIGGER `trg_question_types_updated_at` AFTER UPDATE ON `question_types`
FOR EACH ROW WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
    UPDATE `question_types` SET `updated_at` = (unixepoch() * 1000) WHERE `id` = NEW.`id`;
END;
CREATE TRIGGER `trg_papers_updated_at` AFTER UPDATE ON `papers`
FOR EACH ROW WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
    UPDATE `papers` SET `updated_at` = (unixepoch() * 1000) WHERE `id` = NEW.`id`;
END;
