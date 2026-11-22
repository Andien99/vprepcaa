import {
  sqliteTable,
  sqliteView,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
  foreignKey,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Drizzle definitions for the D1 schema in /migrations. The SQL migration files are
// the source of truth for what is applied (they also hold triggers and views, which
// Drizzle can't express); keep this file in step so queries and drizzle-kit agree.
// Table and column docs: docs/database.md.
//
// Conventions: text ids; timestamps are integer milliseconds (mode 'timestamp_ms');
// booleans are integer 0/1 (mode 'boolean').

const now = sql`(unixepoch() * 1000)`;
const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now);
const updatedAt = () => integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now);
const ms = (/** @type {string} */ name) => integer(name, { mode: 'timestamp_ms' });
const bool = (/** @type {string} */ name) => integer(name, { mode: 'boolean' });

// ===========================================================================
// IDENTITY (Better Auth)
// Export names are Better Auth's model names (user, session, account, verification);
// the tables they point at are users, sessions and auth_accounts.
// Field names are what Better Auth uses; column names are snake_case.
// ===========================================================================

export const user = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: bool('email_verified').notNull().default(false),
    image: text('image'),
    // 'student' | 'teacher' | 'admin'. Set from the allowlist when the account is first created.
    platformRole: text('platform_role').notNull().default('student'),
    yearLevel: integer('year_level'),
    status: text('status').notNull().default('active'), // 'active' | 'suspended'
    // Profile, filled in on /welcome after the first sign-in (migration 0009).
    firstName: text('first_name'),
    lastName: text('last_name'),
    schoolName: text('school_name'),
    onboardedAt: ms('onboarded_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ux_users_email').on(t.email),
    index('ix_users_platform_role').on(t.platformRole),
    check('ck_users_platform_role', sql`${t.platformRole} IN ('student', 'teacher', 'admin')`),
    check('ck_users_year_level', sql`${t.yearLevel} IS NULL OR ${t.yearLevel} BETWEEN 7 AND 12`),
    check('ck_users_status', sql`${t.status} IN ('active', 'suspended')`),
  ],
);

export const session = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: ms('expires_at').notNull(),
    token: text('token').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('ux_sessions_token').on(t.token),
    index('ix_sessions_user').on(t.userId),
    index('ix_sessions_expires').on(t.expiresAt),
  ],
);

export const account = sqliteTable(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    // Encrypted by Better Auth (account.encryptOAuthTokens); triggers reject plaintext.
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ms('access_token_expires_at'),
    refreshTokenExpiresAt: ms('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'), // scrypt hash only (email/password sign-in is not enabled)
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ux_auth_accounts_provider').on(t.providerId, t.accountId),
    index('ix_auth_accounts_user').on(t.userId),
  ],
);

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: ms('expires_at').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Only emails listed here can create an account. Rows are managed in the database,
// never in git, so no personal addresses appear in this public repo.
export const allowlist = sqliteTable('allowlist', {
  email: text('email').primaryKey(),
  role: text('role').notNull().default('student'),
  createdAt: createdAt(),
});

// ===========================================================================
// EDUCATION
// ===========================================================================

export const schools = sqliteTable(
  'schools',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    shortName: text('short_name'),
    state: text('state').notNull().default('VIC'),
    timezone: text('timezone').notNull().default('Australia/Melbourne'),
    isActive: bool('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('ux_schools_name_state').on(t.name, t.state)],
);

export const schoolMembers = sqliteTable(
  'school_members',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'student' | 'teacher' | 'school_admin'
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ux_school_members').on(t.schoolId, t.userId),
    index('ix_school_members_user').on(t.userId),
    check('ck_school_members_role', sql`${t.role} IN ('student', 'teacher', 'school_admin')`),
  ],
);

export const subjects = sqliteTable(
  'subjects',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    studyDesign: text('study_design'),
    position: integer('position').notNull().default(0),
    isActive: bool('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('ux_subjects_code').on(t.code)],
);

export const chapters = sqliteTable(
  'chapters',
  {
    id: text('id').primaryKey(),
    subjectId: text('subject_id').notNull().references(() => subjects.id, { onDelete: 'restrict' }),
    code: text('code'),
    title: text('title').notNull(),
    description: text('description'),
    position: integer('position').notNull(),
    isActive: bool('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ux_chapters_position').on(t.subjectId, t.position),
    uniqueIndex('ux_chapters_code').on(t.subjectId, t.code),
  ],
);

export const topics = sqliteTable(
  'topics',
  {
    id: text('id').primaryKey(),
    chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'restrict' }),
    code: text('code'),
    title: text('title').notNull(),
    position: integer('position').notNull(),
    isActive: bool('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ux_topics_position').on(t.chapterId, t.position),
    uniqueIndex('ux_topics_code').on(t.chapterId, t.code),
  ],
);

export const questions = sqliteTable(
  'questions',
  {
    id: text('id').primaryKey(),
    subjectId: text('subject_id').notNull().references(() => subjects.id, { onDelete: 'restrict' }),
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
    sourceType: text('source_type').notNull(), // 'vcaa_exam' | 'sac' | 'textbook' | 'custom'
    sourceRef: text('source_ref').notNull(),
    year: integer('year'),
    exam: text('exam'), // 'E1' | 'E2'
    isNht: bool('is_nht').notNull().default(false),
    section: text('section'),
    questionNumber: text('question_number'),
    format: text('format').notNull(), // 'multiple_choice' | 'short_answer' | 'extended_response'
    marks: integer('marks').notNull(),
    correctOption: text('correct_option'),
    imageKey: text('image_key'),
    solutionKey: text('solution_key'),
    difficulty: text('difficulty'),
    statePctCorrect: real('state_pct_correct'),
    inStudyDesign: bool('in_study_design').notNull().default(true),
    isActive: bool('is_active').notNull().default(true),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // Migration 0008 (question bank). Column CHECKs live in the SQL migration.
    paperId: text('paper_id').references(() => papers.id, { onDelete: 'set null' }),
    stateAvg: real('state_avg'),
    zeroPct: real('zero_pct'),
    howOften: text('how_often'), // 'every_year' | 'two_of_three' | 'repeated_within_year' | 'once' | 'not_classified'
    topDistractor: text('top_distractor'),
    tagSource: text('tag_source'), // 'keyword' | 'ocr_verify' | 'solutions' | 'reviewed'
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('ix_questions_paper').on(t.paperId),
    uniqueIndex('ux_questions_source_global').on(t.subjectId, t.sourceRef).where(sql`${t.schoolId} IS NULL`),
    uniqueIndex('ux_questions_source_school').on(t.subjectId, t.schoolId, t.sourceRef).where(sql`${t.schoolId} IS NOT NULL`),
    index('ix_questions_subject_paper').on(t.subjectId, t.year, t.exam),
    index('ix_questions_school').on(t.schoolId).where(sql`${t.schoolId} IS NOT NULL`),
    index('ix_questions_created_by').on(t.createdBy),
    check('ck_questions_source_type', sql`${t.sourceType} IN ('vcaa_exam', 'sac', 'textbook', 'custom')`),
    check('ck_questions_year', sql`${t.year} IS NULL OR ${t.year} BETWEEN 2000 AND 2100`),
    check('ck_questions_exam', sql`${t.exam} IS NULL OR ${t.exam} IN ('E1', 'E2')`),
    check('ck_questions_format', sql`${t.format} IN ('multiple_choice', 'short_answer', 'extended_response')`),
    check('ck_questions_marks', sql`${t.marks} > 0`),
    check('ck_questions_correct_option', sql`${t.correctOption} IS NULL OR ${t.correctOption} IN ('A', 'B', 'C', 'D', 'E')`),
    check('ck_questions_difficulty', sql`${t.difficulty} IS NULL OR ${t.difficulty} IN ('easy', 'medium', 'hard')`),
    check('ck_questions_state_pct', sql`${t.statePctCorrect} IS NULL OR ${t.statePctCorrect} BETWEEN 0 AND 100`),
    check('ck_questions_sac_has_school', sql`${t.sourceType} <> 'sac' OR ${t.schoolId} IS NOT NULL`),
    check('ck_questions_mc_answer', sql`${t.format} = 'multiple_choice' OR ${t.correctOption} IS NULL`),
  ],
);

export const questionTopics = sqliteTable(
  'question_topics',
  {
    questionId: text('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
    topicId: text('topic_id').notNull().references(() => topics.id, { onDelete: 'restrict' }),
    isPrimary: bool('is_primary').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.questionId, t.topicId] }),
    index('ix_question_topics_topic').on(t.topicId),
    uniqueIndex('ux_question_topics_primary').on(t.questionId).where(sql`${t.isPrimary} = 1`),
  ],
);

export const classes = sqliteTable(
  'classes',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
    subjectId: text('subject_id').notNull().references(() => subjects.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    academicYear: integer('academic_year').notNull(),
    joinCode: text('join_code'),
    defaultChapterAccess: text('default_chapter_access').notNull().default('locked'), // 'open' | 'locked'
    isArchived: bool('is_archived').notNull().default(false),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ux_classes_join_code').on(t.joinCode).where(sql`${t.joinCode} IS NOT NULL`),
    index('ix_classes_school_year').on(t.schoolId, t.academicYear),
    index('ix_classes_subject').on(t.subjectId),
    index('ix_classes_created_by').on(t.createdBy),
    check('ck_classes_year', sql`${t.academicYear} BETWEEN 2000 AND 2100`),
    check('ck_classes_default_access', sql`${t.defaultChapterAccess} IN ('open', 'locked')`),
  ],
);

export const classMembers = sqliteTable(
  'class_members',
  {
    id: text('id').primaryKey(),
    classId: text('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'teacher' | 'student'
    joinedAt: ms('joined_at').notNull().default(now),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ux_class_members').on(t.classId, t.userId),
    index('ix_class_members_user').on(t.userId, t.role),
    index('ix_class_members_roster').on(t.classId, t.role),
    check('ck_class_members_role', sql`${t.role} IN ('teacher', 'student')`),
  ],
);

// The subjects a user studies (students) or teaches (teachers), from their profile.
export const userSubjects = sqliteTable(
  'user_subjects',
  {
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    subjectId: text('subject_id').notNull().references(() => subjects.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.subjectId] })],
);

// Emails a teacher has added to a class. A student signing in with one of these
// emails is put into the class automatically (no code needed).
export const classInvites = sqliteTable(
  'class_invites',
  {
    id: text('id').primaryKey(),
    classId: text('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    invitedBy: text('invited_by').references(() => user.id, { onDelete: 'set null' }),
    acceptedBy: text('accepted_by').references(() => user.id, { onDelete: 'set null' }),
    acceptedAt: ms('accepted_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ux_class_invites').on(t.classId, t.email),
    index('ix_class_invites_email').on(t.email),
    check('ck_class_invites_email', sql`${t.email} = lower(${t.email}) AND ${t.email} LIKE '%_@_%'`),
  ],
);

// ===========================================================================
// ACCESS CONTROL
// ===========================================================================

export const chapterAccess = sqliteTable(
  'chapter_access',
  {
    id: text('id').primaryKey(),
    classId: text('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
    chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
    access: text('access').notNull(), // 'open' | 'locked'
    opensAt: ms('opens_at'),
    closesAt: ms('closes_at'),
    setBy: text('set_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ux_chapter_access').on(t.classId, t.chapterId),
    index('ix_chapter_access_chapter').on(t.chapterId),
    check('ck_chapter_access_access', sql`${t.access} IN ('open', 'locked')`),
    check('ck_chapter_access_window', sql`${t.opensAt} IS NULL OR ${t.closesAt} IS NULL OR ${t.closesAt} > ${t.opensAt}`),
  ],
);

export const studentAccessOverrides = sqliteTable(
  'student_access_overrides',
  {
    id: text('id').primaryKey(),
    classId: text('class_id').notNull(),
    studentId: text('student_id').notNull(),
    chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
    access: text('access').notNull(), // 'grant' | 'deny'
    reason: text('reason'),
    expiresAt: ms('expires_at'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'fk_overrides_enrolment',
      columns: [t.classId, t.studentId],
      foreignColumns: [classMembers.classId, classMembers.userId],
    }).onDelete('cascade'),
    uniqueIndex('ux_student_access_overrides').on(t.classId, t.studentId, t.chapterId),
    index('ix_student_access_overrides_student').on(t.studentId),
    index('ix_student_access_overrides_chapter').on(t.chapterId),
    check('ck_overrides_access', sql`${t.access} IN ('grant', 'deny')`),
  ],
);

// Defined in 0003_classes_and_access.sql; .existing() keeps drizzle-kit from managing them.
export const vStudentClassChapterAccess = sqliteView('v_student_class_chapter_access', {
  studentId: text('student_id').notNull(),
  classId: text('class_id').notNull(),
  chapterId: text('chapter_id').notNull(),
  subjectId: text('subject_id').notNull(),
  canAccess: bool('can_access').notNull(),
  decidedBy: text('decided_by').notNull(), // 'student_override' | 'chapter_access' | 'class_default'
}).existing();

export const vStudentChapterAccess = sqliteView('v_student_chapter_access', {
  studentId: text('student_id').notNull(),
  chapterId: text('chapter_id').notNull(),
  subjectId: text('subject_id').notNull(),
  canAccess: bool('can_access').notNull(),
}).existing();

// ===========================================================================
// CLASSROOM MANAGEMENT
// ===========================================================================

export const assignments = sqliteTable(
  'assignments',
  {
    id: text('id').primaryKey(),
    classId: text('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    instructionsMd: text('instructions_md'),
    status: text('status').notNull().default('draft'), // 'draft' | 'published' | 'closed'
    opensAt: ms('opens_at'),
    dueAt: ms('due_at'),
    timeLimitMinutes: integer('time_limit_minutes'),
    allowLate: bool('allow_late').notNull().default(true),
    solutionsVisibility: text('solutions_visibility').notNull().default('after_submit'),
    publishedAt: ms('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('ix_assignments_class_due').on(t.classId, t.status, t.dueAt),
    index('ix_assignments_created_by').on(t.createdBy),
    check('ck_assignments_status', sql`${t.status} IN ('draft', 'published', 'closed')`),
    check('ck_assignments_time_limit', sql`${t.timeLimitMinutes} IS NULL OR ${t.timeLimitMinutes} > 0`),
    check('ck_assignments_solutions', sql`${t.solutionsVisibility} IN ('after_submit', 'after_due', 'never')`),
    check('ck_assignments_window', sql`${t.opensAt} IS NULL OR ${t.dueAt} IS NULL OR ${t.dueAt} > ${t.opensAt}`),
    check('ck_assignments_published', sql`${t.status} = 'draft' OR ${t.publishedAt} IS NOT NULL`),
  ],
);

export const assignmentQuestions = sqliteTable(
  'assignment_questions',
  {
    id: text('id').primaryKey(),
    assignmentId: text('assignment_id').notNull().references(() => assignments.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull().references(() => questions.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    marksOverride: integer('marks_override'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ux_assignment_questions_question').on(t.assignmentId, t.questionId),
    uniqueIndex('ux_assignment_questions_position').on(t.assignmentId, t.position),
    index('ix_assignment_questions_question').on(t.questionId),
    check('ck_assignment_questions_position', sql`${t.position} > 0`),
    check('ck_assignment_questions_marks', sql`${t.marksOverride} IS NULL OR ${t.marksOverride} > 0`),
  ],
);

export const assignmentSubmissions = sqliteTable(
  'assignment_submissions',
  {
    id: text('id').primaryKey(),
    assignmentId: text('assignment_id').notNull().references(() => assignments.id, { onDelete: 'cascade' }),
    studentId: text('student_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('in_progress'), // 'in_progress' | 'submitted' | 'marked' | 'returned'
    startedAt: ms('started_at').notNull().default(now),
    submittedAt: ms('submitted_at'),
    isLate: bool('is_late').notNull().default(false),
    score: real('score'),
    maxScore: real('max_score'),
    feedbackMd: text('feedback_md'),
    markedBy: text('marked_by').references(() => user.id, { onDelete: 'set null' }),
    markedAt: ms('marked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ux_assignment_submissions').on(t.assignmentId, t.studentId),
    index('ix_assignment_submissions_student').on(t.studentId, t.status),
    check('ck_submissions_status', sql`${t.status} IN ('in_progress', 'submitted', 'marked', 'returned')`),
    check('ck_submissions_score_min', sql`${t.score} IS NULL OR ${t.score} >= 0`),
    check('ck_submissions_max_score', sql`${t.maxScore} IS NULL OR ${t.maxScore} > 0`),
    check('ck_submissions_score', sql`${t.score} IS NULL OR ${t.maxScore} IS NULL OR ${t.score} <= ${t.maxScore}`),
    check('ck_submissions_submitted', sql`${t.status} = 'in_progress' OR ${t.submittedAt} IS NOT NULL`),
  ],
);

// ===========================================================================
// STUDENT PROGRESS
// ===========================================================================

export const questionAttempts = sqliteTable(
  'question_attempts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull().references(() => questions.id, { onDelete: 'restrict' }),
    classId: text('class_id').references(() => classes.id, { onDelete: 'set null' }),
    submissionId: text('submission_id').references(() => assignmentSubmissions.id, { onDelete: 'set null' }),
    source: text('source').notNull(), // 'daily' | 'weekly' | 'topic' | 'history' | 'assignment' | 'free'
    selectedOption: text('selected_option'),
    responseJson: text('response_json', { mode: 'json' }),
    marksAwarded: real('marks_awarded').notNull(),
    marksAvailable: integer('marks_available').notNull(),
    isCorrect: bool('is_correct').notNull(),
    markedBy: text('marked_by').notNull().default('auto'), // 'auto' | 'self' | 'teacher'
    solutionViewed: bool('solution_viewed').notNull().default(false),
    isRedo: bool('is_redo').notNull().default(false),
    durationSeconds: integer('duration_seconds'),
    startedAt: ms('started_at'),
    submittedAt: ms('submitted_at').notNull().default(now),
    createdAt: createdAt(),
  },
  (t) => [
    index('ix_question_attempts_user_time').on(t.userId, t.submittedAt),
    index('ix_question_attempts_user_question').on(t.userId, t.questionId, t.submittedAt),
    index('ix_question_attempts_question').on(t.questionId),
    index('ix_question_attempts_class_time').on(t.classId, t.submittedAt).where(sql`${t.classId} IS NOT NULL`),
    index('ix_question_attempts_submission').on(t.submissionId).where(sql`${t.submissionId} IS NOT NULL`),
    check('ck_attempts_source', sql`${t.source} IN ('daily', 'weekly', 'topic', 'history', 'assignment', 'free')`),
    check('ck_attempts_option', sql`${t.selectedOption} IS NULL OR ${t.selectedOption} IN ('A', 'B', 'C', 'D', 'E')`),
    check('ck_attempts_json', sql`${t.responseJson} IS NULL OR json_valid(${t.responseJson})`),
    check('ck_attempts_marks_min', sql`${t.marksAwarded} >= 0`),
    check('ck_attempts_available', sql`${t.marksAvailable} > 0`),
    check('ck_attempts_marked_by', sql`${t.markedBy} IN ('auto', 'self', 'teacher')`),
    check('ck_attempts_duration', sql`${t.durationSeconds} IS NULL OR ${t.durationSeconds} >= 0`),
    check('ck_attempts_marks', sql`${t.marksAwarded} <= ${t.marksAvailable}`),
    check('ck_attempts_submission_source', sql`${t.submissionId} IS NULL OR ${t.source} = 'assignment'`),
  ],
);

export const studentProgress = sqliteTable(
  'student_progress',
  {
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
    attemptsCount: integer('attempts_count').notNull().default(0),
    correctCount: integer('correct_count').notNull().default(0),
    bestMarks: real('best_marks'),
    lastMarks: real('last_marks'),
    firstAttemptedAt: ms('first_attempted_at'),
    lastAttemptedAt: ms('last_attempted_at'),
    srsStep: integer('srs_step').notNull().default(0),
    srsIntervalDays: integer('srs_interval_days'),
    srsDueAt: ms('srs_due_at'),
    mastery: real('mastery'),
    onFixList: bool('on_fix_list').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.questionId] }),
    index('ix_student_progress_due').on(t.userId, t.srsDueAt),
    index('ix_student_progress_fix').on(t.userId).where(sql`${t.onFixList} = 1`),
    index('ix_student_progress_question').on(t.questionId),
    check('ck_progress_attempts', sql`${t.attemptsCount} >= 0`),
    check('ck_progress_correct', sql`${t.correctCount} >= 0`),
    check('ck_progress_srs_step', sql`${t.srsStep} >= 0`),
    check('ck_progress_interval', sql`${t.srsIntervalDays} IS NULL OR ${t.srsIntervalDays} >= 0`),
    check('ck_progress_mastery', sql`${t.mastery} IS NULL OR ${t.mastery} BETWEEN 0 AND 1`),
    check('ck_progress_counts', sql`${t.correctCount} <= ${t.attemptsCount}`),
  ],
);

export const achievements = sqliteTable(
  'achievements',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull().default('general'),
    iconKey: text('icon_key'),
    criteriaJson: text('criteria_json', { mode: 'json' }),
    points: integer('points').notNull().default(0),
    isActive: bool('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ux_achievements_code').on(t.code),
    check('ck_achievements_category', sql`${t.category} IN ('general', 'streak', 'mastery', 'volume', 'assignment')`),
    check('ck_achievements_criteria', sql`${t.criteriaJson} IS NULL OR json_valid(${t.criteriaJson})`),
    check('ck_achievements_points', sql`${t.points} >= 0`),
  ],
);

export const userAchievements = sqliteTable(
  'user_achievements',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    achievementId: text('achievement_id').notNull().references(() => achievements.id, { onDelete: 'restrict' }),
    awardedAt: ms('awarded_at').notNull().default(now),
    contextJson: text('context_json', { mode: 'json' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ux_user_achievements').on(t.userId, t.achievementId),
    index('ix_user_achievements_achievement').on(t.achievementId),
    check('ck_user_achievements_context', sql`${t.contextJson} IS NULL OR json_valid(${t.contextJson})`),
  ],
);

// ===========================================================================
// DAILY SETS
// ===========================================================================

export const dailySets = sqliteTable(
  'daily_sets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    subjectId: text('subject_id').notNull().references(() => subjects.id, { onDelete: 'cascade' }),
    setDate: text('set_date').notNull(), // 'YYYY-MM-DD', Australia/Melbourne
    itemsJson: text('items_json', { mode: 'json' }).notNull(), // [{ q, k }]
    algorithm: text('algorithm').notNull().default('pp-v1'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ux_daily_sets').on(t.userId, t.subjectId, t.setDate),
    index('ix_daily_sets_user_date').on(t.userId, t.setDate),
    check('ck_daily_sets_date', sql`${t.setDate} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
    check('ck_daily_sets_items', sql`json_valid(${t.itemsJson}) AND json_type(${t.itemsJson}) = 'array'`),
  ],
);

// ===========================================================================
// QUESTION BANK (migration 0008): the Notion question-bank design
// ===========================================================================

const COLOURS = `'default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'`;

export const studyAreas = sqliteTable(
  'study_areas',
  {
    id: text('id').primaryKey(),
    subjectId: text('subject_id').notNull().references(() => subjects.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    colour: text('colour').notNull().default('default'),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('ux_study_areas_code').on(t.subjectId, t.code), check('ck_study_areas_colour', sql.raw(`"colour" IN (${COLOURS})`))],
);

export const questionTypes = sqliteTable(
  'question_types',
  {
    id: text('id').primaryKey(),
    subjectId: text('subject_id').notNull().references(() => subjects.id, { onDelete: 'cascade' }),
    studyAreaId: text('study_area_id').references(() => studyAreas.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    colour: text('colour'),
    position: integer('position').notNull().default(0),
    isActive: bool('is_active').notNull().default(true),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ux_question_types_name').on(t.subjectId, t.name),
    index('ix_question_types_area').on(t.studyAreaId),
    check('ck_question_types_colour', sql.raw(`"colour" IS NULL OR "colour" IN (${COLOURS})`)),
  ],
);

export const questionTypeTags = sqliteTable(
  'question_type_tags',
  {
    questionId: text('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
    questionTypeId: text('question_type_id').notNull().references(() => questionTypes.id, { onDelete: 'cascade' }),
    isPrimary: bool('is_primary').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.questionId, t.questionTypeId] }),
    uniqueIndex('ux_question_type_tags_primary').on(t.questionId).where(sql`${t.isPrimary} = 1`),
    index('ix_question_type_tags_type').on(t.questionTypeId),
  ],
);

export const questionAreaTags = sqliteTable(
  'question_area_tags',
  {
    questionId: text('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
    studyAreaId: text('study_area_id').notNull().references(() => studyAreas.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.studyAreaId] }), index('ix_question_area_tags_area').on(t.studyAreaId)],
);

export const papers = sqliteTable(
  'papers',
  {
    id: text('id').primaryKey(),
    subjectId: text('subject_id').notNull().references(() => subjects.id, { onDelete: 'cascade' }),
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    source: text('source').notNull().default('vcaa'), // 'vcaa' | 'vcaa_nht' | 'sac' | 'trial' | 'other'
    year: integer('year'),
    exam: text('exam'),
    isPublished: bool('is_published').notNull().default(true),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ux_papers_code_global').on(t.subjectId, t.code).where(sql`${t.schoolId} IS NULL`),
    uniqueIndex('ux_papers_code_school').on(t.subjectId, t.schoolId, t.code).where(sql`${t.schoolId} IS NOT NULL`),
    check('ck_papers_source', sql`${t.source} IN ('vcaa', 'vcaa_nht', 'sac', 'trial', 'other')`),
    check('ck_papers_year', sql`${t.year} IS NULL OR ${t.year} BETWEEN 2000 AND 2100`),
    check('ck_papers_exam', sql`${t.exam} IS NULL OR ${t.exam} IN ('E1', 'E2')`),
  ],
);

export const questionStars = sqliteTable(
  'question_stars',
  {
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.questionId] })],
);
