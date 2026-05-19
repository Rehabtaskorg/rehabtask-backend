# Project Intelligence — RehabTaskApp Backend

## Project Identity
- **Project**: RehabTaskApp — a therapy marketplace platform
- **This repo**: Backend only
- **Absolute path**: `/home/steve/projects/RehabTaskApp-Backend`
- **Sister repo (Frontend)**: `/home/steve/projects/RehabTaskApp-Frontend`
- **Stack**: Node.js 20+, Express 5, JavaScript ES Modules, PostgreSQL (Supabase), Prisma v7, Zod v4, Socket.io

## Sister Repo Awareness
The frontend lives at `/home/steve/projects/RehabTaskApp-Frontend`.
When adding or changing endpoints, validators, or response shapes, consider:
- `src/lib/constants.js` in the frontend may need updating to match
- API response shapes must stay consistent — the frontend depends on `{ success, data, message }`
- Never rename or remove an endpoint without checking if the frontend's `src/lib/*.api.js` files reference it

---

## Standing Orders (Always Apply — Every File You Touch)

1. **Refactor as you go.** Whenever you edit a file, clean up code smells in that file too. Do not wait to be asked.
2. **Leave code more readable than you found it.** Every pass should improve clarity.
3. **Never break existing behavior.** Refactors must preserve all current functionality.
4. **Flag bugs even if out of scope.** Add a `// TODO: [BUG]` comment and mention it in your response.
5. **No silent changes.** If you rename, restructure, or move something, say so clearly.

---

## Language Rules (JavaScript ES Modules Only)

- JavaScript only (`"type": "module"` in `package.json`). Never introduce TypeScript.
- Use `import` / `export` — never `require()` / `module.exports`.
- Use **JSDoc** on all exported functions and services — this compensates for no TypeScript.
- Never use `jsonwebtoken` or `bcryptjs` — auth is fully handled by Supabase.

---

## Architecture — Strict Layer Separation

```
Request → Route → Middleware (auth, validate) → Controller → Service → Prisma → DB
```

| Layer | Job | Must NOT |
|---|---|---|
| `routes/` | Register path + middleware | Contain any logic |
| `controllers/` | Parse req, call service, send res | Query DB, contain business logic |
| `services/` | All business logic | Touch `req`/`res` |
| `validators/` | Zod schemas for request shape | Contain business rules |
| `utils/` | Pure helper functions | Have side effects |

If you see business logic in a controller → move it to the service.
If you see a DB call in a controller → move it to the service.

---

## Naming Conventions

| Thing | Convention |
|---|---|
| Controllers | `[domain].controller.js` or `admin.[domain].controller.js` |
| Services | `[domain].service.js` |
| Routes | `[domain].routes.js` |
| Validators | `[domain].schema.js` |
| Constants | `UPPER_SNAKE_CASE` |
| Route paths | `kebab-case`, plural nouns (`/bookings` not `/getBooking`) |
| Prisma fields | camelCase in code, `snake_case` in DB via `@map()` |

---

## Constants — `src/utils/constants.js` Is the Source of Truth

All of the following must live there, never hardcoded inline:
- Role strings: `USER_ROLES.CUSTOMER`, `USER_ROLES.THERAPIST`, `USER_ROLES.ADMIN`, `USER_ROLES.SUB_ADMIN`
- Status values: `BOOKING_STATUS.PENDING`, `BOOKING_STATUS.COMPLETED`, etc.
- Time values: `FIFTEEN_MIN_MS`, `ONE_HOUR_MS`, `SEVEN_DAYS_MS`
- Rate limit windows must reference these constants, not raw `15 * 60 * 1000` calculations

---

## Error Handling

- Always use typed error classes from `src/utils/errors.js`. Never `throw new Error('plain string')`.
- Every async controller must use `try/catch` + `next(err)`. Never send error responses directly from a controller.
- Fire-and-forget email calls must have `.catch(logger.error)` and a comment explaining they are intentionally non-blocking.

---

## API Response Shape

```js
// Success
res.status(200).json({ success: true, data: { ... }, message: 'Optional' });

// Error — let errorHandler.js handle it via next(err)
```

Never return a raw array at the top level. Always `{ success: true, data: [...] }`.

---

## Database (Prisma)

- All DB access in **services only** — never in controllers, routes, or middleware.
- Use the singleton from `src/config/prisma.js` — never `new PrismaClient()`.
- Avoid N+1 queries — use `include` or `select` to fetch related data in one query.
- Always handle `P2002` (unique constraint) and `P2025` (record not found) Prisma errors.

---

## Dead Code — Flag and Remove

- `jsonwebtoken` and `bcryptjs` are installed but unused → flag for removal from `package.json`
- Sentry DSN is validated in `env.js` but never initialized → either wire it up or remove it
- If you encounter any empty stub, unused import, or dead variable, remove it

---

## Logging

- Use Winston logger from `src/config/logger.js`. Never `console.log` in production code.
- Never log: passwords, tokens, card numbers, PII.

---

## Refactor Checklist (Run On Every File You Touch)

- [ ] Is business logic in a controller? Move to service.
- [ ] Are there `prisma.*` calls outside a service? Move them.
- [ ] Are all errors using typed classes from `errors.js`?
- [ ] Are all async controllers using `try/catch` + `next(err)`?
- [ ] Are magic strings/numbers extracted to `constants.js`?
- [ ] Any `console.log`? Replace with `logger`.
- [ ] Is input validated with Zod before reaching the controller?
- [ ] Any N+1 query risks?
- [ ] Are unused imports removed?