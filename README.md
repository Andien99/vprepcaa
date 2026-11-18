# vprepcaa

VCAA exam practice platform. Successor to `vcaa-pixel-practice` (the original single-file app).

- Frontend: vanilla HTML, CSS and JavaScript (ES modules) in `web/`
- Backend: Cloudflare Worker with Hono in `worker/src/`, API under `/api/v1`
- Data: Cloudflare D1 (relational) and R2 (images, private), added in the next step
- Auth: Google sign-in through Better Auth (later step)

**This repo is public. Never commit exam questions, answer keys, worked solutions, images from VCAA papers, or any secret.**

## Develop

```
npm install
npm run dev      # http://localhost:8787
```

Check: http://localhost:8787/api/v1/health
