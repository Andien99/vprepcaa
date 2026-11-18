-- Migration 0003: classes, enrolment and access control
-- classes, class_members, chapter_access, student_access_overrides
-- views: v_student_class_chapter_access, v_student_chapter_access
--
-- Access is resolved per (student, class, chapter) in this order:
--   1. student_access_overrides row (unexpired)  -> grant / deny
--   2. chapter_access row for the class          -> open (inside its window) / locked
--   3. classes.default_chapter_access            -> open / locked
-- A student may see a chapter if ANY of their active classes resolves to open.

-- ---------------------------------------------------------------------------
-- classes: a teaching group for one subject. school_id is NULL for groups that
-- don't belong to a school (e.g. private tutoring).
-- ---------------------------------------------------------------------------
CREATE TABLE `classes` (
    `id`                     TEXT PRIMARY KEY NOT NULL,
    `school_id`              TEXT REFERENCES `schools` (`id`) ON DELETE RESTRICT,
    `subject_id`             TEXT NOT NULL REFERENCES `subjects` (`id`) ON DELETE RESTRICT,
    `name`                   TEXT NOT NULL,              -- '12GEN-A'
    `academic_year`          INTEGER NOT NULL CHECK (`academic_year` BETWEEN 2000 AND 2100),
    `join_code`              TEXT,                       -- short code students type to join
    `default_chapter_access` TEXT DEFAULT 'locked' NOT NULL
                             CHECK (`default_chapter_access` IN ('open', 'locked')),
    `is_archived`            INTEGER DEFAULT 0 NOT NULL CHECK (`is_archived` IN (0, 1)),
    `created_by`             TEXT REFERENCES `users` (`id`) ON DELETE SET NULL,
    `created_at`             INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `updated_at`             INTEGER DEFAULT (unixepoch() * 1000) NOT NULL
);

CREATE UNIQUE INDEX `ux_classes_join_code` ON `classes` (`join_code`) WHERE `join_code` IS NOT NULL;
CREATE INDEX `ix_classes_school_year` ON `classes` (`school_id`, `academic_year`);
CREATE INDEX `ix_classes_subject` ON `classes` (`subject_id`);
CREATE INDEX `ix_classes_created_by` ON `classes` (`created_by`);

CREATE TRIGGER `trg_classes_updated_at` AFTER UPDATE ON `classes`
FOR EACH ROW WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
    UPDATE `classes` SET `updated_at` = (unixepoch() * 1000) WHERE `id` = NEW.`id`;
END;

-- ---------------------------------------------------------------------------
-- class_members: enrolment of teachers and students, with a per-class role.
-- A teacher can run many classes and a student can be in many classes.
-- UNIQUE (class_id, user_id) prevents duplicate enrolment.
-- ---------------------------------------------------------------------------
CREATE TABLE `class_members` (
    `id`         TEXT PRIMARY KEY NOT NULL,
    `class_id`   TEXT NOT NULL REFERENCES `classes` (`id`) ON DELETE CASCADE,
    `user_id`    TEXT NOT NULL REFERENCES `users` (`id`) ON DELETE CASCADE,
    `role`       TEXT NOT NULL CHECK (`role` IN ('teacher', 'student')),
    `joined_at`  INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `created_at` INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `updated_at` INTEGER DEFAULT (unixepoch() * 1000) NOT NULL
);

CREATE UNIQUE INDEX `ux_class_members` ON `class_members` (`class_id`, `user_id`);
CREATE INDEX `ix_class_members_user` ON `class_members` (`user_id`, `role`);     -- "my classes"
CREATE INDEX `ix_class_members_roster` ON `class_members` (`class_id`, `role`);  -- class roster

CREATE TRIGGER `trg_class_members_updated_at` AFTER UPDATE ON `class_members`
FOR EACH ROW WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
    UPDATE `class_members` SET `updated_at` = (unixepoch() * 1000) WHERE `id` = NEW.`id`;
END;

-- Only teacher/admin accounts can hold the teacher role in a class.
CREATE TRIGGER `trg_class_members_teacher_ins` BEFORE INSERT ON `class_members`
FOR EACH ROW WHEN NEW.`role` = 'teacher'
    AND (SELECT `platform_role` FROM `users` WHERE `id` = NEW.`user_id`) = 'student'
BEGIN
    SELECT RAISE(ABORT, 'class_members: a student account cannot be a class teacher');
END;

CREATE TRIGGER `trg_class_members_teacher_upd` BEFORE UPDATE OF `role`, `user_id` ON `class_members`
FOR EACH ROW WHEN NEW.`role` = 'teacher'
    AND (SELECT `platform_role` FROM `users` WHERE `id` = NEW.`user_id`) = 'student'
BEGIN
    SELECT RAISE(ABORT, 'class_members: a student account cannot be a class teacher');
END;

-- ---------------------------------------------------------------------------
-- chapter_access: a class's rule for one chapter. 'open' may carry a window
-- (opens_at inclusive, closes_at exclusive) for scheduled unlocks.
-- ---------------------------------------------------------------------------
CREATE TABLE `chapter_access` (
    `id`         TEXT PRIMARY KEY NOT NULL,
    `class_id`   TEXT NOT NULL REFERENCES `classes` (`id`) ON DELETE CASCADE,
    `chapter_id` TEXT NOT NULL REFERENCES `chapters` (`id`) ON DELETE CASCADE,
    `access`     TEXT NOT NULL CHECK (`access` IN ('open', 'locked')),
    `opens_at`   INTEGER,
    `closes_at`  INTEGER,
    `set_by`     TEXT REFERENCES `users` (`id`) ON DELETE SET NULL,
    `created_at` INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `updated_at` INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    CONSTRAINT `ck_chapter_access_window` CHECK (`opens_at` IS NULL OR `closes_at` IS NULL OR `closes_at` > `opens_at`)
);

CREATE UNIQUE INDEX `ux_chapter_access` ON `chapter_access` (`class_id`, `chapter_id`);
CREATE INDEX `ix_chapter_access_chapter` ON `chapter_access` (`chapter_id`);

CREATE TRIGGER `trg_chapter_access_updated_at` AFTER UPDATE ON `chapter_access`
FOR EACH ROW WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
    UPDATE `chapter_access` SET `updated_at` = (unixepoch() * 1000) WHERE `id` = NEW.`id`;
END;

-- The chapter must belong to the class's subject.
CREATE TRIGGER `trg_chapter_access_subject` BEFORE INSERT ON `chapter_access`
FOR EACH ROW WHEN (SELECT `subject_id` FROM `chapters` WHERE `id` = NEW.`chapter_id`)
               <> (SELECT `subject_id` FROM `classes`  WHERE `id` = NEW.`class_id`)
BEGIN
    SELECT RAISE(ABORT, 'chapter_access: chapter is not part of this class''s subject');
END;

-- ---------------------------------------------------------------------------
-- student_access_overrides: one student, one chapter, within one class.
-- The composite FK to class_members means the student must be enrolled in the
-- class, and the override is removed automatically when they leave it.
-- ---------------------------------------------------------------------------
CREATE TABLE `student_access_overrides` (
    `id`         TEXT PRIMARY KEY NOT NULL,
    `class_id`   TEXT NOT NULL,
    `student_id` TEXT NOT NULL,
    `chapter_id` TEXT NOT NULL REFERENCES `chapters` (`id`) ON DELETE CASCADE,
    `access`     TEXT NOT NULL CHECK (`access` IN ('grant', 'deny')),
    `reason`     TEXT,                              -- e.g. 'extension work', 'catch-up'
    `expires_at` INTEGER,
    `created_by` TEXT REFERENCES `users` (`id`) ON DELETE SET NULL,
    `created_at` INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    `updated_at` INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    FOREIGN KEY (`class_id`, `student_id`)
        REFERENCES `class_members` (`class_id`, `user_id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX `ux_student_access_overrides` ON `student_access_overrides` (`class_id`, `student_id`, `chapter_id`);
CREATE INDEX `ix_student_access_overrides_student` ON `student_access_overrides` (`student_id`);
CREATE INDEX `ix_student_access_overrides_chapter` ON `student_access_overrides` (`chapter_id`);

CREATE TRIGGER `trg_student_access_overrides_updated_at` AFTER UPDATE ON `student_access_overrides`
FOR EACH ROW WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
    UPDATE `student_access_overrides` SET `updated_at` = (unixepoch() * 1000) WHERE `id` = NEW.`id`;
END;

CREATE TRIGGER `trg_student_access_overrides_subject` BEFORE INSERT ON `student_access_overrides`
FOR EACH ROW WHEN (SELECT `subject_id` FROM `chapters` WHERE `id` = NEW.`chapter_id`)
               <> (SELECT `subject_id` FROM `classes`  WHERE `id` = NEW.`class_id`)
BEGIN
    SELECT RAISE(ABORT, 'student_access_overrides: chapter is not part of this class''s subject');
END;

-- ---------------------------------------------------------------------------
-- Views
-- v_student_class_chapter_access: resolved decision per student, class and
-- chapter, plus which rule decided it (for the teacher's access screen).
-- v_student_chapter_access: one row per student and chapter; can_access = 1 if
-- any of the student's active classes allows it.
-- ---------------------------------------------------------------------------
CREATE VIEW `v_student_class_chapter_access` AS
SELECT
    cm.`user_id`  AS `student_id`,
    c.`id`        AS `class_id`,
    ch.`id`       AS `chapter_id`,
    ch.`subject_id` AS `subject_id`,
    CASE
        WHEN o.`id` IS NOT NULL AND (o.`expires_at` IS NULL OR o.`expires_at` > unixepoch() * 1000)
            THEN o.`access` = 'grant'
        WHEN ca.`id` IS NOT NULL
            THEN ca.`access` = 'open'
                 AND (ca.`opens_at`  IS NULL OR ca.`opens_at` <= unixepoch() * 1000)
                 AND (ca.`closes_at` IS NULL OR ca.`closes_at` > unixepoch() * 1000)
        ELSE c.`default_chapter_access` = 'open'
    END AS `can_access`,
    CASE
        WHEN o.`id` IS NOT NULL AND (o.`expires_at` IS NULL OR o.`expires_at` > unixepoch() * 1000)
            THEN 'student_override'
        WHEN ca.`id` IS NOT NULL THEN 'chapter_access'
        ELSE 'class_default'
    END AS `decided_by`
FROM `class_members` cm
JOIN `classes`  c  ON c.`id` = cm.`class_id` AND c.`is_archived` = 0
JOIN `chapters` ch ON ch.`subject_id` = c.`subject_id` AND ch.`is_active` = 1
LEFT JOIN `chapter_access` ca
       ON ca.`class_id` = c.`id` AND ca.`chapter_id` = ch.`id`
LEFT JOIN `student_access_overrides` o
       ON o.`class_id` = c.`id` AND o.`student_id` = cm.`user_id` AND o.`chapter_id` = ch.`id`
WHERE cm.`role` = 'student';

CREATE VIEW `v_student_chapter_access` AS
SELECT `student_id`, `chapter_id`, `subject_id`, MAX(`can_access`) AS `can_access`
FROM `v_student_class_chapter_access`
GROUP BY `student_id`, `chapter_id`, `subject_id`;
