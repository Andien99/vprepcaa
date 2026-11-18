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

## Database

```
npm run db:migrate:local
npm run db:seed:local     # fictional test data, local only
npm run test:db
```

See `docs/database.md` for every table, its relationships, and how to apply migrations to production.
