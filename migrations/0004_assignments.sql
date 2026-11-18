-- Migration 0004: classroom management
-- assignments, assignment_questions, assignment_submissions

-- ---------------------------------------------------------------------------
-- assignments: a set of questions a teacher gives one class
-- ---------------------------------------------------------------------------
CREATE TABLE `assignments` (
    `id`                   TEXT PRIMARY KEY NOT NULL,
    `class_id`             TEXT NOT NULL REFERENCES `classes` (`id`) ON DELETE CASCADE,
    `created_by`           TEXT REFERENCES `users` (`id`) ON DELETE SET NULL,
    `title`                TEXT NOT NULL,
    `instructions_md`      TEXT,
    `status`               TEXT DEFAULT 'draft' NOT NULL CHECK (`status` IN ('draft', 'published', 'closed')),
    `opens_at`             INTEGER,
    `due_at`               INTEGER,
    `time_limit_minutes`   INTEGER CHECK (`time_limit_minutes` IS NULL OR `time_limit_minutes` > 0),
    `allow_late`           INTEGER DEFAULT 1 NOT NULL CHECK (`allow_late` IN (0, 1)),
    `solutions_visibility` TEXT DEFAULT 'after_submit' NOT NULL
                           CHECK (`solutions_visibility` IN ('after_submit', 'after_due', 'never')),
    `published_at`         INTEGER,
    `created_at`           INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `updated_at`           INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    CONSTRAINT `ck_assignments_window` CHECK (`opens_at` IS NULL OR `due_at` IS NULL OR `due_at` > `opens_at`),
    CONSTRAINT `ck_assignments_published` CHECK (`status` = 'draft' OR `published_at` IS NOT NULL)
);

CREATE INDEX `ix_assignments_class_due` ON `assignments` (`class_id`, `status`, `due_at`);
CREATE INDEX `ix_assignments_created_by` ON `assignments` (`created_by`);

CREATE TRIGGER `trg_assignments_updated_at` AFTER UPDATE ON `assignments`
FOR EACH ROW WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
    UPDATE `assignments` SET `updated_at` = (unixepoch() * 1000) WHERE `id` = NEW.`id`;
END;

-- ---------------------------------------------------------------------------
-- assignment_questions: ordered questions in an assignment.
-- Questions can't be deleted while an assignment uses them (retire instead).
-- ---------------------------------------------------------------------------
CREATE TABLE `assignment_questions` (
    `id`             TEXT PRIMARY KEY NOT NULL,
    `assignment_id`  TEXT NOT NULL REFERENCES `assignments` (`id`) ON DELETE CASCADE,
    `question_id`    TEXT NOT NULL REFERENCES `questions` (`id`) ON DELETE RESTRICT,
    `position`       INTEGER NOT NULL CHECK (`position` > 0),
    `marks_override` INTEGER CHECK (`marks_override` IS NULL OR `marks_override` > 0),
    `created_at`     INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `updated_at`     INTEGER DEFAULT (unixepoch() * 1000) NOT NULL
);

CREATE UNIQUE INDEX `ux_assignment_questions_question` ON `assignment_questions` (`assignment_id`, `question_id`);
CREATE UNIQUE INDEX `ux_assignment_questions_position` ON `assignment_questions` (`assignment_id`, `position`);
CREATE INDEX `ix_assignment_questions_question` ON `assignment_questions` (`question_id`);

CREATE TRIGGER `trg_assignment_questions_updated_at` AFTER UPDATE ON `assignment_questions`
FOR EACH ROW WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
    UPDATE `assignment_questions` SET `updated_at` = (unixepoch() * 1000) WHERE `id` = NEW.`id`;
END;

-- ---------------------------------------------------------------------------
-- assignment_submissions: one per student per assignment. The individual
-- answers are question_attempts rows pointing at the submission.
-- ---------------------------------------------------------------------------
CREATE TABLE `assignment_submissions` (
    `id`            TEXT PRIMARY KEY NOT NULL,
    `assignment_id` TEXT NOT NULL REFERENCES `assignments` (`id`) ON DELETE CASCADE,
    `student_id`    TEXT NOT NULL REFERENCES `users` (`id`) ON DELETE CASCADE,
    `status`        TEXT DEFAULT 'in_progress' NOT NULL
                    CHECK (`status` IN ('in_progress', 'submitted', 'marked', 'returned')),
    `started_at`    INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `submitted_at`  INTEGER,
    `is_late`       INTEGER DEFAULT 0 NOT NULL CHECK (`is_late` IN (0, 1)),
    `score`         REAL CHECK (`score` IS NULL OR `score` >= 0),
    `max_score`     REAL CHECK (`max_score` IS NULL OR `max_score` > 0),
    `feedback_md`   TEXT,
    `marked_by`     TEXT REFERENCES `users` (`id`) ON DELETE SET NULL,
    `marked_at`     INTEGER,
    `created_at`    INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `updated_at`    INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    CONSTRAINT `ck_submissions_score` CHECK (`score` IS NULL OR `max_score` IS NULL OR `score` <= `max_score`),
    CONSTRAINT `ck_submissions_submitted` CHECK (`status` = 'in_progress' OR `submitted_at` IS NOT NULL)
);

CREATE UNIQUE INDEX `ux_assignment_submissions` ON `assignment_submissions` (`assignment_id`, `student_id`);
CREATE INDEX `ix_assignment_submissions_student` ON `assignment_submissions` (`student_id`, `status`);

CREATE TRIGGER `trg_assignment_submissions_updated_at` AFTER UPDATE ON `assignment_submissions`
FOR EACH ROW WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
    UPDATE `assignment_submissions` SET `updated_at` = (unixepoch() * 1000) WHERE `id` = NEW.`id`;
END;

-- Only a student enrolled in the assignment's class can start a submission.
CREATE TRIGGER `trg_assignment_submissions_enrolled` BEFORE INSERT ON `assignment_submissions`
FOR EACH ROW WHEN NOT EXISTS (
    SELECT 1 FROM `class_members` cm
    JOIN `assignments` a ON a.`class_id` = cm.`class_id`
    WHERE a.`id` = NEW.`assignment_id` AND cm.`user_id` = NEW.`student_id` AND cm.`role` = 'student'
)
BEGIN
    SELECT RAISE(ABORT, 'assignment_submissions: student is not enrolled in this class');
END;
