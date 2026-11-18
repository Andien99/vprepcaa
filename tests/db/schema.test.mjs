// Database schema tests. No extra dependencies: uses Node's built-in SQLite
// (same engine as D1) with foreign keys on, as D1 enforces them.
//   npm run test:db
//
// 1. Applies 0000_auth.sql and inserts a pre-existing Better Auth user with
//    plaintext Google tokens, as on production before 0001.
// 2. Applies the remaining migrations and checks that user survived and the
//    tokens were cleared.
// 3. Loads seeds/dev.sql and checks constraints, access rules and cascades.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { symmetricEncrypt, hashPassword } from 'better-auth/crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrations = readdirSync(join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
const run = (f) => db.exec(readFileSync(f, 'utf8').replaceAll('--> statement-breakpoint', ''));

let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
};
const rejects = (name, sql, pattern) => {
  try {
    db.exec(sql);
    ok(`${name} (expected an error, none raised)`, false);
  } catch (e) {
    ok(`${name} -> ${e.message}`, !pattern || pattern.test(e.message));
  }
};
const accepts = (name, sql) => {
  try {
    db.exec(sql);
    ok(name, true);
  } catch (e) {
    ok(`${name} -> ${e.message}`, false);
  }
};
const one = (sql, ...p) => db.prepare(sql).get(...p);
const tx = (fn) => {
  db.exec('SAVEPOINT t');
  try {
    fn();
  } finally {
    db.exec('ROLLBACK TO t; RELEASE t');
  }
};

// --- 1. production-like starting point --------------------------------------
run(join(root, 'migrations', migrations[0]));
db.exec(`
  INSERT INTO allowlist (email, role) VALUES ('existing-admin@example.test', 'admin');
  INSERT INTO user (id, name, email, email_verified, platform_role) VALUES ('ba_user_1', 'Existing admin', 'existing-admin@example.test', 1, 'admin');
  INSERT INTO account (id, account_id, provider_id, user_id, access_token, refresh_token, id_token)
    VALUES ('ba_acc_1', '1234567890', 'google', 'ba_user_1', 'ya29.plaintext-access', '1//plaintext-refresh', 'eyJhbGciOi.plain.jwt');
  INSERT INTO session (id, expires_at, token, user_id) VALUES ('ba_ses_1', 4102444800000, 'existing-session-token', 'ba_user_1');
`);

// --- 2. upgrade --------------------------------------------------------------
for (const f of migrations.slice(1)) run(join(root, 'migrations', f));
ok('existing user kept through the rename', one(`SELECT platform_role r FROM users WHERE id='ba_user_1'`)?.r === 'admin');
ok('existing session kept', one(`SELECT user_id u FROM sessions WHERE token='existing-session-token'`)?.u === 'ba_user_1');
ok('plaintext OAuth tokens cleared',
  one(`SELECT access_token a, refresh_token r, id_token i FROM auth_accounts WHERE id='ba_acc_1'`).a === null
  && one(`SELECT refresh_token r FROM auth_accounts WHERE id='ba_acc_1'`).r === null);
ok('new user columns have defaults', one(`SELECT status s FROM users WHERE id='ba_user_1'`).s === 'active');
ok('renamed FKs point at users', db.prepare(`PRAGMA foreign_key_list('auth_accounts')`).all()[0].table === 'users');

// --- 3. seed -------------------------------------------------------------------
run(join(root, 'seeds', 'dev.sql'));
ok('foreign_key_check is clean', db.prepare('PRAGMA foreign_key_check').all().length === 0);
ok('integrity_check ok', one('PRAGMA integrity_check').integrity_check === 'ok');

// --- identity ------------------------------------------------------------------
rejects('duplicate email', `INSERT INTO users (id,name,email) VALUES ('x','dup','student1@example.test')`, /UNIQUE/);
rejects('unknown platform_role', `INSERT INTO users (id,name,email,platform_role) VALUES ('x','x','x@example.test','superuser')`, /platform_role/);
rejects('plaintext access token rejected',
  `INSERT INTO auth_accounts (id,account_id,provider_id,user_id,access_token) VALUES ('x','sub-x','google','usr_student4','ya29.abc')`, /encrypted/);
rejects('plaintext JWT id_token rejected',
  `UPDATE auth_accounts SET id_token='eyJhbGciOi.payload.sig' WHERE id='acc_student4'`, /encrypted/);
rejects('plaintext password rejected',
  `UPDATE auth_accounts SET password='hunter2' WHERE id='acc_student4'`, /hashed/);
const enc = await symmetricEncrypt({ key: 'test-secret-that-is-at-least-32-characters', data: 'ya29.fake-google-token' });
accepts('Better Auth encrypted token accepted',
  `UPDATE auth_accounts SET access_token='${enc}', refresh_token='${enc}', id_token='${enc}' WHERE id='acc_student4'`);
const pw = await hashPassword('correct horse battery staple');
accepts('Better Auth scrypt password hash accepted', `UPDATE auth_accounts SET password='${pw}' WHERE id='acc_student4'`);
rejects('same Google account linked twice',
  `INSERT INTO auth_accounts (id,account_id,provider_id,user_id) VALUES ('x','google-sub-0000000011','google','usr_student5')`, /UNIQUE/);

// --- enrolment ------------------------------------------------------------------
rejects('duplicate class enrolment blocked',
  `INSERT INTO class_members (id,class_id,user_id,role) VALUES ('x','cls_12gen_a','usr_student1','student')`, /UNIQUE/);
rejects('student account cannot be a class teacher',
  `INSERT INTO class_members (id,class_id,user_id,role) VALUES ('x','cls_12mm_a','usr_student3','teacher')`, /cannot be a class teacher/);
ok('student in multiple classes',
  one(`SELECT count(*) n FROM class_members WHERE user_id='usr_student2' AND role='student'`).n === 3);
ok('teacher managing multiple classes',
  one(`SELECT count(*) n FROM class_members WHERE user_id='usr_admin' AND role='teacher'`).n === 2);

// --- curriculum -------------------------------------------------------------------
rejects('SAC question must belong to a school',
  `INSERT INTO questions (id,subject_id,source_type,source_ref,format,marks) VALUES ('x','sub_gen34','sac','SAC X','short_answer',2)`, /CHECK/);
rejects('two primary topics for one question',
  `INSERT INTO question_topics (question_id,topic_id,is_primary) VALUES ('q_gen_01','tp_gen_1f',1)`, /UNIQUE/);
rejects('duplicate global source_ref',
  `INSERT INTO questions (id,subject_id,source_type,source_ref,format,marks) VALUES ('x','sub_gen34','vcaa_exam','TEST 2024 E1 Q1','multiple_choice',1)`, /UNIQUE/);
rejects('duplicate school source_ref',
  `INSERT INTO questions (id,subject_id,school_id,source_type,source_ref,format,marks) VALUES ('x','sub_gen34','sch_test','sac','TEST SAC 1 Q3','short_answer',2)`, /UNIQUE/);
rejects('MC answer on a written question',
  `INSERT INTO questions (id,subject_id,source_type,source_ref,format,marks,correct_option) VALUES ('x','sub_gen34','custom','X1','short_answer',2,'A')`, /CHECK/);
rejects('chapter delete restricted while topics exist', `DELETE FROM chapters WHERE id='ch_gen_1'`, /FOREIGN KEY/);
rejects('question delete restricted while attempted', `DELETE FROM questions WHERE id='q_gen_01'`, /FOREIGN KEY/);

// --- access control -----------------------------------------------------------------
const access = (s, ch) => one(`SELECT can_access FROM v_student_chapter_access WHERE student_id=? AND chapter_id=?`, s, ch)?.can_access;
ok('class rule: CH1 open for 12GEN-A student', access('usr_student1', 'ch_gen_1') === 1);
ok('scheduled chapter not yet open', access('usr_student1', 'ch_gen_2') === 0);
ok('explicit class lock applies', access('usr_student1', 'ch_gen_3') === 0);
ok('class default open applies (12MM-A CH1)', access('usr_student1', 'ch_mm_1') === 1);
ok('student override grant beats class lock', access('usr_student3', 'ch_gen_3') === 1);
ok('student override deny beats class default open', access('usr_student4', 'ch_mm_2') === 0);
ok('any-class union: tutoring group opens GEN CH3 for Tom', access('usr_student2', 'ch_gen_3') === 1);
ok('no class in subject -> no rows (Priya has no MM34 class)', access('usr_student3', 'ch_mm_1') === undefined);
ok('decided_by reported',
  one(`SELECT decided_by d FROM v_student_class_chapter_access WHERE student_id='usr_student3' AND chapter_id='ch_gen_3'`).d === 'student_override');
rejects('override for a student not in the class',
  `INSERT INTO student_access_overrides (id,class_id,student_id,chapter_id,access) VALUES ('x','cls_12mm_a','usr_student3','ch_mm_1','grant')`, /FOREIGN KEY/);
rejects('chapter_access with a chapter from another subject',
  `INSERT INTO chapter_access (id,class_id,chapter_id,access) VALUES ('x','cls_12gen_a','ch_mm_1','open')`, /subject/);
rejects('duplicate chapter_access row',
  `INSERT INTO chapter_access (id,class_id,chapter_id,access) VALUES ('x','cls_12gen_a','ch_gen_1','locked')`, /UNIQUE/);
tx(() => {
  db.exec(`UPDATE student_access_overrides SET expires_at = unixepoch('2020-01-01') * 1000 WHERE id='sao_01'`);
  ok('expired override falls back to the class rule', access('usr_student3', 'ch_gen_3') === 0);
});
tx(() => {
  db.exec(`UPDATE chapter_access SET opens_at = unixepoch('2020-01-01') * 1000 WHERE id='ca_02'`);
  ok('scheduled chapter opens once its time passes', access('usr_student1', 'ch_gen_2') === 1);
});
tx(() => {
  db.exec(`UPDATE classes SET is_archived = 1 WHERE id='cls_tutor'`);
  ok('archived class no longer grants access', access('usr_student2', 'ch_gen_3') === 0);
});

// --- assignments ----------------------------------------------------------------------
rejects('duplicate submission per student',
  `INSERT INTO assignment_submissions (id,assignment_id,student_id) VALUES ('x','asg_01','usr_student1')`, /UNIQUE/);
rejects('submission by a student not in the class',
  `INSERT INTO assignment_submissions (id,assignment_id,student_id) VALUES ('x','asg_01','usr_student4')`, /not enrolled/);
rejects('question added twice to an assignment',
  `INSERT INTO assignment_questions (id,assignment_id,question_id,position) VALUES ('x','asg_01','q_gen_01',9)`, /UNIQUE/);
rejects('published assignment needs published_at',
  `INSERT INTO assignments (id,class_id,title,status) VALUES ('x','cls_12gen_a','x','published')`, /CHECK/);
rejects('marks awarded above marks available',
  `INSERT INTO question_attempts (id,user_id,question_id,source,marks_awarded,marks_available,is_correct) VALUES ('x','usr_student1','q_gen_01','free',2,1,1)`, /CHECK/);

// --- cascades -------------------------------------------------------------------------
tx(() => {
  db.exec(`DELETE FROM class_members WHERE class_id='cls_12gen_a' AND user_id='usr_student3'`);
  ok("leaving a class removes that class's overrides",
    one(`SELECT count(*) n FROM student_access_overrides WHERE student_id='usr_student3'`).n === 0);
});
tx(() => {
  db.exec(`DELETE FROM classes WHERE id='cls_12gen_a'`);
  ok('class delete cascades to members, access rules, assignments, submissions',
    one(`SELECT (SELECT count(*) FROM class_members WHERE class_id='cls_12gen_a')
              + (SELECT count(*) FROM chapter_access WHERE class_id='cls_12gen_a')
              + (SELECT count(*) FROM assignments WHERE class_id='cls_12gen_a')
              + (SELECT count(*) FROM assignment_submissions WHERE assignment_id='asg_01') n`).n === 0);
  ok('class delete keeps student attempts (class_id/submission_id set NULL)',
    one(`SELECT count(*) n FROM question_attempts WHERE id IN ('att_01','att_02','att_03','att_04')
         AND class_id IS NULL AND submission_id IS NULL`).n === 4);
});
tx(() => {
  db.exec(`DELETE FROM users WHERE id='usr_student1'`);
  ok('user delete erases all of their data',
    one(`SELECT (SELECT count(*) FROM auth_accounts WHERE user_id='usr_student1')
              + (SELECT count(*) FROM sessions WHERE user_id='usr_student1')
              + (SELECT count(*) FROM school_members WHERE user_id='usr_student1')
              + (SELECT count(*) FROM class_members WHERE user_id='usr_student1')
              + (SELECT count(*) FROM question_attempts WHERE user_id='usr_student1')
              + (SELECT count(*) FROM student_progress WHERE user_id='usr_student1')
              + (SELECT count(*) FROM assignment_submissions WHERE student_id='usr_student1')
              + (SELECT count(*) FROM user_achievements WHERE user_id='usr_student1') n`).n === 0);
});
tx(() => {
  db.exec(`DELETE FROM users WHERE id='usr_teacher1'`);
  ok('teacher delete keeps their class and questions (created_by set NULL)',
    one(`SELECT created_by c FROM classes WHERE id='cls_12gen_a'`).c === null
    && one(`SELECT created_by c FROM questions WHERE id='q_gen_05'`).c === null);
});
rejects('school delete restricted while it has classes', `DELETE FROM schools WHERE id='sch_test'`, /FOREIGN KEY/);

// --- updated_at trigger -----------------------------------------------------------------
tx(() => {
  db.exec(`UPDATE classes SET updated_at = 0 WHERE id='cls_12mm_a'`);
  db.exec(`UPDATE classes SET name = '12MM-A (renamed)' WHERE id='cls_12mm_a'`);
  ok('updated_at refreshed by trigger', one(`SELECT updated_at u FROM classes WHERE id='cls_12mm_a'`).u > 1.7e12);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
