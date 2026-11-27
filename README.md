# vprepcaa

VCAA exam practice platform. Successor to `vcaa-pixel-practice` (the original single-file app).

- Frontend: vanilla HTML, CSS and JavaScript (ES modules) in `web/`
- Backend: Cloudflare Worker with Hono in `worker/src/`, API under `/api/v1`
- Data: Cloudflare D1 (relational, schema in `migrations/`, documented in `docs/database.md`) and R2 (images and solutions, private)
- Auth: Google sign-in through Better Auth. Students sign up with a class code from their teacher; staff are added through the `allowlist` table

**This repo is public. Never commit exam questions, answer keys, worked solutions, images from VCAA papers, or any secret.**

## Develop

```
npm install
npm run dev      # http://localhost:8787
```

Check: http://localhost:8787/api/v1/health

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
