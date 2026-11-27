# vprepcaa

VCAA exam practice platform. Successor to `vcaa-pixel-practice` (the original single-file app).

- Frontend: vanilla HTML, CSS and JavaScript (ES modules) in `web/`
- Backend: Cloudflare Worker with Hono in `worker/src/`, API under `/api/v1`
- Data: Cloudflare D1 (relational, schema in `migrations/`, documented in `docs/database.md`) and R2 (images and solutions, private)
- Auth: Google sign-in through Better Auth. Anyone can create an account; new accounts fill in a profile on `/welcome`, then students join a class with its code or are added by their teacher's email list. Teachers and admins are given their role through the `allowlist` table

**This repo is public. Never commit exam questions, answer keys, worked solutions, images from VCAA papers, or any secret.**

## Develop

```
npm install
npm run dev      # http://localhost:8787
```

Check: http://localhost:8787/api/v1/health

## Accounts, profiles and classes

1. **Sign in with Google** (`/signin`). Any Google account can sign up. It's a student account unless the email is on `allowlist` as a teacher or admin (an account added to the allowlist later is promoted on its next sign-in).
2. **Profile** (`/welcome`). First and last name, school (optional), year level (students, 7–12) and subjects. Every page sends an account without a profile here first; "Edit profile" brings it back later.
3. **Join a class.** A student who isn't in a class sees only "Join your class" on the dashboard, with two ways in:
   - the 6-character class code from their teacher, or
   - their teacher adds their email under **Students and emails** on the class. They're put in the class as soon as they sign in with that Google account, or straight away if they already have one ("check again" on the gate picks it up).

Until a student is in a class, the bank and practice show them no exam content. Teachers see each class's students (and whether they joined by code or email list) and the emails still waiting to sign in.

API: `GET /api/v1/me` (profile, classes; also claims email-list classes), `PUT /api/v1/me/profile`, `GET|POST /api/v1/classes/:id/invites`, `DELETE /api/v1/classes/:id/invites/:inviteId` (`worker/src/lib/profile.js`). Tests: `npm run test:onboarding`.

## Student dashboard

`/student/` shows a student their recommended next activity, today's daily questions (chosen with the Pixel Practice rules and stored per day), homework from their classes, chapters completed and remaining, their daily streak, progress per subject and recent results. Everything comes from one call, `GET /api/v1/dashboard` (`worker/src/lib/dashboard.js`, `worker/src/lib/daily.js`). Teachers see their classes on the same page.

## Practice screen

`/practice/` is the Pixel Practice question screen for the web: `?mode=daily|fix|mixed&subject=GEN34`, `?mode=topic&chapter=<id>` or `?assignment=<id>`. On a monitor it fills one screen: the question image (zoomable) on the left, answering on the right.

- Multiple choice: answer-sheet ovals (keys A–E work), checked straight away with the worked solution.
- Written: a graph-paper working space (pen pressure, eraser, undo, S Pen side button erases, palm rejection), then "I'm done, mark it" shows each part's solution, examiner notes and state average with a mark stepper underneath.
- Homework: answers are saved but not checked until it's handed in; after hand-in the solutions open (per the teacher's setting) and written answers are self-marked. Multiple-choice-only homework is marked on hand-in.
- Every answer updates spaced repetition (wrong → tomorrow and the fix list; right → 1, 3, 7, 16, 35, 70 days).

API: `GET /api/v1/practice/session`, `GET /api/v1/questions/:id/image`, `GET /api/v1/questions/:id/solution`, `POST /api/v1/attempts`, `POST /api/v1/assignments/:id/submit` (`worker/src/lib/practice.js`). Images and solutions come from the private R2 bucket, only to students who can see the question; solutions stay hidden while homework holding the question keeps them hidden.

## Question bank

`/bank/` is the Notion question database rebuilt for the app: every question in a colour-coded table with its Notion name, question type, study design area, paper, format, marks, difficulty, state average and how often it is examined. Group by area, type, paper, difficulty or chapter; filter by area, type, year, exam, format and difficulty; sort any column. Clicking a row opens the question image and its worked solution.

- Students see the questions in their open chapters, with their own result on each (full, part, zero, fix list), can star questions and "Practise these" sends the filtered set to `/practice/?mode=pick`. Their weakest question types show on the dashboard as coloured links into the bank.
- Teachers edit their school's questions and add SAC or trial papers; admins edit the shared VCAA bank. The editor covers name (with the naming convention), paper, answer, marks, difficulty, types, areas, topic, exam statistics, image and solution sections, and publishing.
- New exams: "New paper" then "Add questions" (drop the question images, named like `MC12.png` or `2026 E2 Q3.png`, or type ranges like `MC1-MC20, Q1-Q6`). Questions are created as drafts, then published.
- Admins manage question types and areas (rename, recolour, merge) under "Types & areas".

API (`worker/src/lib/bank.js`): `GET /api/v1/bank/subjects|meta|questions`, `PUT|DELETE /bank/stars/:id`, `PATCH /bank/questions/:id`, `PUT /bank/questions/:id/solution|image`, `POST /bank/papers|questions|types`, `PATCH /bank/types/:id`, `POST /bank/types/:id/merge`, `PATCH /bank/areas/:id`. Tables and permissions: [docs/database.md](docs/database.md#question-bank-migration-0008).

## Database

```
npm run db:migrate:local
npm run db:seed:local     # fictional test data, local only (dev.sql + dev-dashboard.sql)
npm run test:db
```

See `docs/database.md` for every table, its relationships, and how to apply migrations to production.

Question banks: see "Importing the question banks" in `docs/database.md`.
