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

## Database

```
npm run db:migrate:local
npm run db:seed:local     # fictional test data, local only (dev.sql + dev-dashboard.sql)
npm run test:db
```

See `docs/database.md` for every table, its relationships, and how to apply migrations to production.

Question banks: see "Importing the question banks" in `docs/database.md`.
