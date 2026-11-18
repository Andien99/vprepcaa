-- Migration 0005: student progress
-- question_attempts, student_progress, achievements, user_achievements

-- ---------------------------------------------------------------------------
-- question_attempts: append-only log of every answer a student submits.
-- Never updated, so no updated_at. Rolled up into student_progress by the app.
-- class_id / submission_id become NULL when the class or assignment is deleted,
-- so the student keeps their history.
-- ---------------------------------------------------------------------------
CREATE TABLE `question_attempts` (
    `id`               TEXT PRIMARY KEY NOT NULL,
    `user_id`          TEXT NOT NULL REFERENCES `users` (`id`) ON DELETE CASCADE,
    `question_id`      TEXT NOT NULL REFERENCES `questions` (`id`) ON DELETE RESTRICT,
    `class_id`         TEXT REFERENCES `classes` (`id`) ON DELETE SET NULL,
    `submission_id`    TEXT REFERENCES `assignment_submissions` (`id`) ON DELETE SET NULL,
    `source`           TEXT NOT NULL
                       CHECK (`source` IN ('daily', 'weekly', 'topic', 'history', 'assignment', 'free')),
    `selected_option`  TEXT CHECK (`selected_option` IS NULL OR `selected_option` IN ('A', 'B', 'C', 'D', 'E')),
    `response_json`    TEXT CHECK (`response_json` IS NULL OR json_valid(`response_json`)),  -- part marks, working keys
    `marks_awarded`    REAL NOT NULL CHECK (`marks_awarded` >= 0),
    `marks_available`  INTEGER NOT NULL CHECK (`marks_available` > 0),
    `is_correct`       INTEGER NOT NULL CHECK (`is_correct` IN (0, 1)),   -- full marks
    `marked_by`        TEXT DEFAULT 'auto' NOT NULL CHECK (`marked_by` IN ('auto', 'self', 'teacher')),
    `solution_viewed`  INTEGER DEFAULT 0 NOT NULL CHECK (`solution_viewed` IN (0, 1)),
    `is_redo`          INTEGER DEFAULT 0 NOT NULL CHECK (`is_redo` IN (0, 1)),
    `duration_seconds` INTEGER CHECK (`duration_seconds` IS NULL OR `duration_seconds` >= 0),
    `started_at`       INTEGER,
    `submitted_at`     INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `created_at`       INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    CONSTRAINT `ck_attempts_marks` CHECK (`marks_awarded` <= `marks_available`),
    CONSTRAINT `ck_attempts_submission_source` CHECK (`submission_id` IS NULL OR `source` = 'assignment')
);

CREATE INDEX `ix_question_attempts_user_time` ON `question_attempts` (`user_id`, `submitted_at`);
CREATE INDEX `ix_question_attempts_user_question` ON `question_attempts` (`user_id`, `question_id`, `submitted_at`);
CREATE INDEX `ix_question_attempts_question` ON `question_attempts` (`question_id`);
CREATE INDEX `ix_question_attempts_class_time` ON `question_attempts` (`class_id`, `submitted_at`) WHERE `class_id` IS NOT NULL;
CREATE INDEX `ix_question_attempts_submission` ON `question_attempts` (`submission_id`) WHERE `submission_id` IS NOT NULL;

-- ---------------------------------------------------------------------------
-- student_progress: current state per student per question, derived from
-- question_attempts. Holds the spaced-repetition schedule that the original app
-- kept in IndexedDB, so progress syncs across devices.
-- ---------------------------------------------------------------------------
CREATE TABLE `student_progress` (
    `user_id`            TEXT NOT NULL REFERENCES `users` (`id`) ON DELETE CASCADE,
    `question_id`        TEXT NOT NULL REFERENCES `questions` (`id`) ON DELETE CASCADE,
    `attempts_count`     INTEGER DEFAULT 0 NOT NULL CHECK (`attempts_count` >= 0),
    `correct_count`      INTEGER DEFAULT 0 NOT NULL CHECK (`correct_count` >= 0),
    `best_marks`         REAL,
    `last_marks`         REAL,
    `first_attempted_at` INTEGER,
    `last_attempted_at`  INTEGER,
    `srs_step`           INTEGER DEFAULT 0 NOT NULL CHECK (`srs_step` >= 0),   -- index into 1,3,7,16,35,70 days
    `srs_interval_days`  INTEGER CHECK (`srs_interval_days` IS NULL OR `srs_interval_days` >= 0),
    `srs_due_at`         INTEGER,
    `mastery`            REAL CHECK (`mastery` IS NULL OR `mastery` BETWEEN 0 AND 1),
    `on_fix_list`        INTEGER DEFAULT 0 NOT NULL CHECK (`on_fix_list` IN (0, 1)),
    `created_at`         INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `updated_at`         INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    PRIMARY KEY (`user_id`, `question_id`),
    CONSTRAINT `ck_progress_counts` CHECK (`correct_count` <= `attempts_count`)
);

CREATE INDEX `ix_student_progress_due` ON `student_progress` (`user_id`, `srs_due_at`);
CREATE INDEX `ix_student_progress_fix` ON `student_progress` (`user_id`) WHERE `on_fix_list` = 1;
CREATE INDEX `ix_student_progress_question` ON `student_progress` (`question_id`);

CREATE TRIGGER `trg_student_progress_updated_at` AFTER UPDATE ON `student_progress`
FOR EACH ROW WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
    UPDATE `student_progress` SET `updated_at` = (unixepoch() * 1000)
    WHERE `user_id` = NEW.`user_id` AND `question_id` = NEW.`question_id`;
END;

-- ---------------------------------------------------------------------------
-- achievements: the badge catalogue (global, not per student)
-- ---------------------------------------------------------------------------
CREATE TABLE `achievements` (
    `id`            TEXT PRIMARY KEY NOT NULL,
    `code`          TEXT NOT NULL,                  -- 'streak_7'
    `name`          TEXT NOT NULL,
    `description`   TEXT NOT NULL,
    `category`      TEXT DEFAULT 'general' NOT NULL
                    CHECK (`category` IN ('general', 'streak', 'mastery', 'volume', 'assignment')),
    `icon_key`      TEXT,                           -- R2 key of the pixel-art badge
    `criteria_json` TEXT CHECK (`criteria_json` IS NULL OR json_valid(`criteria_json`)),
    `points`        INTEGER DEFAULT 0 NOT NULL CHECK (`points` >= 0),
    `is_active`     INTEGER DEFAULT 1 NOT NULL CHECK (`is_active` IN (0, 1)),
    `created_at`    INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `updated_at`    INTEGER DEFAULT (unixepoch() * 1000) NOT NULL
);

CREATE UNIQUE INDEX `ux_achievements_code` ON `achievements` (`code`);

CREATE TRIGGER `trg_achievements_updated_at` AFTER UPDATE ON `achievements`
FOR EACH ROW WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
    UPDATE `achievements` SET `updated_at` = (unixepoch() * 1000) WHERE `id` = NEW.`id`;
END;

-- ---------------------------------------------------------------------------
-- user_achievements: which student earned which badge, and when
-- ---------------------------------------------------------------------------
CREATE TABLE `user_achievements` (
    `id`             TEXT PRIMARY KEY NOT NULL,
    `user_id`        TEXT NOT NULL REFERENCES `users` (`id`) ON DELETE CASCADE,
    `achievement_id` TEXT NOT NULL REFERENCES `achievements` (`id`) ON DELETE RESTRICT,
    `awarded_at`     INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `context_json`   TEXT CHECK (`context_json` IS NULL OR json_valid(`context_json`)),  -- e.g. {"subject":"GEN34"}
    `created_at`     INTEGER DEFAULT (unixepoch() * 1000) NOT NULL
);

CREATE UNIQUE INDEX `ux_user_achievements` ON `user_achievements` (`user_id`, `achievement_id`);
CREATE INDEX `ix_user_achievements_achievement` ON `user_achievements` (`achievement_id`);
