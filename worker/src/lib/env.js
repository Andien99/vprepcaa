/**
 * @typedef {Object} Env
 * @property {D1Database} DB
 * @property {R2Bucket} CONTENT
 * @property {Fetcher} ASSETS
 * @property {string} [BETTER_AUTH_URL] Production base URL. Unset on Previews.
 * @property {string} [AUTH_ALLOWED_HOSTS] Comma-separated host patterns for Previews (e.g. "*.workers.dev").
 * @property {string} BETTER_AUTH_SECRET
 * @property {string} GOOGLE_CLIENT_ID
 * @property {string} GOOGLE_CLIENT_SECRET
 */
export {};
