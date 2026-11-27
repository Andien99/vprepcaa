-- Migration 0009: open sign-up with a profile, and classes joined by code or by email
--
-- Anyone can now create an account with Google. After the first sign-in they fill in
-- a profile on /welcome (first and last name, school, year level, subjects), which
-- sets users.onboarded_at. A student who isn't in a class sees no exam content until
-- they join one, either with the class code or automatically because their teacher
-- added their email to the class (class_invites).
--
-- class_invites: one row per (class, email). accepted_by/accepted_at are set when
-- the student is put into the class (on sign-in, or straight away if the account
-- already exists). Emails are stored lower-case.
-- user_subjects: the subjects on the profile (what a student studies or a teacher
-- teaches). Class membership, not this, decides what a student can see.

CREATE TABLE `class_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`email` text NOT NULL,
	`invited_by` text,
	`accepted_by` text,
	`accepted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_class_invites_email" CHECK("class_invites"."email" = lower("class_invites"."email") AND "class_invites"."email" LIKE '%_@_%')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_class_invites` ON `class_invites` (`class_id`,`email`);--> statement-breakpoint
CREATE INDEX `ix_class_invites_email` ON `class_invites` (`email`);--> statement-breakpoint
CREATE TABLE `user_subjects` (
	`user_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `subject_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `users` ADD `first_name` text;--> statement-breakpoint
ALTER TABLE `users` ADD `last_name` text;--> statement-breakpoint
ALTER TABLE `users` ADD `school_name` text;--> statement-breakpoint
ALTER TABLE `users` ADD `onboarded_at` integer;