-- Migration 0007: daily sets
-- daily_sets
--
-- A student's daily questions for one subject on one day, chosen by the Worker
-- (worker/src/lib/daily.js, the Pixel Practice algorithm) the first time the
-- student opens their dashboard that day, then frozen so the set doesn't change
-- on reload or on another device. set_date is the student's local calendar day
-- (Australia/Melbourne), as 'YYYY-MM-DD'.
--
-- items_json is an ordered array of {"q": question id, "k": kind}, where kind is
-- 'fix' | 'retrieval' | 'strengthen' | 'stretch' | 'new'. Question ids are
-- checked by the Worker when it builds the set; a retired question simply stops
-- counting towards the set.

CREATE TABLE `daily_sets` (
    `id`          TEXT PRIMARY KEY NOT NULL,
    `user_id`     TEXT NOT NULL REFERENCES `users` (`id`) ON DELETE CASCADE,
    `subject_id`  TEXT NOT NULL REFERENCES `subjects` (`id`) ON DELETE CASCADE,
    `set_date`    TEXT NOT NULL,
    `items_json`  TEXT NOT NULL,
    `algorithm`   TEXT DEFAULT 'pp-v1' NOT NULL,
    `created_at`  INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
    CONSTRAINT `ck_daily_sets_date` CHECK (`set_date` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    CONSTRAINT `ck_daily_sets_items` CHECK (json_valid(`items_json`) AND json_type(`items_json`) = 'array')
);

CREATE UNIQUE INDEX `ux_daily_sets` ON `daily_sets` (`user_id`, `subject_id`, `set_date`);
CREATE INDEX `ix_daily_sets_user_date` ON `daily_sets` (`user_id`, `set_date`);
