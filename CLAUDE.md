# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Pet adoption web app (adopters, shelters, admin) for Spain. It is a class project with a demo due in early December 2026, and it will also go in the owner's portfolio. **The application skeleton does not exist yet.** So far the repo contains only:

- the design docs in `docs/`;
- the database schema in `db/schema.sql`;
- the test-lock script in `scripts/test-lock.ts`, with its Claude Code hooks in `.claude/settings.json`.

There is no `package.json` yet. The npm scripts below are the planned ones from `docs/especificaciones-tecnicas.md`.

Keep scope small and prefer the simplest option that works. Features the owner deferred are listed in `docs/reglas-de-negocio.md` §17 and at the end of `docs/casos-de-uso.md`. Do not build them unless asked.

## Language

- **Talking to the owner:** Spanish.
- **Docs** (`docs/`): Spanish.
- **Code:** everything in English (tables, columns, enum values, identifiers, API routes, commits). User-facing UI text is in Spanish.
- **Glossary:** the Spanish ↔ English mapping of entities and states is in `docs/especificaciones-tecnicas.md` §8. Use it instead of inventing new names.

## Source of truth

| Doc | Contains |
|---|---|
| `docs/reglas-de-negocio.md` | Business rules `RN-xx` |
| `docs/casos-de-uso.md` | Use cases `CU-xx` |
| `docs/modelo-entidad-relacion.md` | DB design and key queries |
| `docs/especificaciones-tecnicas.md` | Stack, architecture, decisions, TDD |
| `docs/ux-ui/` | Design system tokens and mockups (the mockups are orientative only) |

**RN/CU IDs are frozen.** A new rule or use case takes the next free number, even when it is placed inside an existing section. A deleted one is marked as removed and its number is never reused.

## TDD and locked tests — strict rule

Development is strict TDD (red → green → refactor).

- When a feature is finished, lock its tests: `node scripts/test-lock.ts lock --feature "CU-xx ..." <files|dirs>`.
- **Locked tests must never be modified or deleted in later tasks.** If a change is truly unavoidable, stop and ask the owner for explicit approval first.
- Only after that approval, record the change with `relock` or `unlock --approved "<reason + who approved>"`.
- New behaviour gets new tests; never edit old ones.

The Claude Code hooks enforce this:

| Hook | Script mode | Effect |
|---|---|---|
| PreToolUse | `hook-pre` | Asks the owner before an edit to a locked test or a `relock`/`unlock`. Denies editing `tests/locked-tests.json` by hand, and denies **any** shell command that mentions that file. |
| PostToolUse (Bash) | `hook-post` | Reports any locked test that a command changed. |
| Stop | `hook-stop` | Blocks ending the turn while a locked test is modified. |

To inspect locks, use `node scripts/test-lock.ts list` or `check`, never `cat` on the manifest.

Name tests after the rule they verify, e.g. `it("RN-87: rejects a visit requested less than 48 h ahead")`.

## Commands

Node 24 runs `.ts` files directly (type stripping), so scripts need no build step.

```sh
node scripts/test-lock.ts check | list | lock | relock | unlock
psql -U postgres -h localhost -d <db> -v ON_ERROR_STOP=1 -f db/schema.sql   # DROPS and recreates all tables
```

`psql` authenticates through `%APPDATA%\postgresql\pgpass.conf`, so use `-w` for non-interactive runs.

Planned, once the skeleton exists:
- `npm run dev` runs the server with `tsx`.
- `npm test` runs Vitest. `pretest` runs `test-lock.ts check`.
- A single test: `npx vitest run <file> -t "RN-87"`.
- `npm run db:reset` runs `db/schema.sql` and then `db/seed.sql`.
- Env vars are loaded with `node --env-file` (no dotenv). `.env` must be gitignored; the current `.gitignore` is still empty.

## Architecture

- **MVC with a service layer:**
  - **Controllers** (`src/server/controllers`, behind `routes/`) only validate the input *format* with Zod and map results to HTTP.
  - **Services** (`src/server/services`) hold every business rule (cite the `RN-xx`) and own the transactions (RN-171).
  - **Models** (`src/server/models`) contain only hand-written, parameterised SQL through `pg`. No ORM.
  - **Scheduled jobs** (`src/server/jobs`, run by `setInterval`, must be idempotent) call the same services as the controllers.
- **One origin.** Express serves both the compiled SPA (`express.static`, with an `index.html` fallback for non-`/api` routes, History API router) and the REST API under `/api`.
  - Sessions are rows in the `Session` table plus an `httpOnly` cookie. No JWT.
  - Chat and notifications use polling. No WebSockets.
- **Frontend.** Vanilla TypeScript compiled by `tsc` with **no bundler**.
  - The browser cannot import npm packages by bare name, so `src/shared` holds **types only**, and Zod stays on the server.
  - Relative imports carry the `.js` extension (ESM, `NodeNext`).
  - CSS uses the tokens from `docs/ux-ui/design-system.md` as CSS variables.
- **Audit log.** Services write `Audit_log` rows inside the same transaction as the action. No triggers. The scope is defined in RN-208 to RN-210.
- **Configurable values.** Deadlines and limits (48 h, 15 days, quota of 3, …; see `docs/reglas-de-negocio.md` §16) come from configuration, never hard-coded.

## Database conventions (`db/schema.sql`)

- **Main tables** are capitalised `Snake_case` and **must always be double-quoted** in SQL (`"Pet"`, `"Visit_slot"`). Unquoted names fold to lowercase and fail.
- **Many-to-many join tables** are lowercase, named after both tables, and end in `_rel` (`adopter_pet_rel`).
- **States** are `text` + `CHECK`, not `ENUM`.
- **No physical deletes of rows with history.** Use states or end dates instead. The exceptions are rows with no history: join-table rows, photos and `Adopter_note`.
- **Integrity in the DB itself:** many rules are enforced by partial unique indexes and composite FKs (for example, a visit's pet and slot must belong to the same shelter). Rules that depend on the current time or on other tables are checked in services.
- **NULL in `CHECK`:** a `CHECK` that evaluates to NULL passes. Guard nullable columns explicitly (see `message_not_empty`).
- **Three SQL files, three roles:**
  - `db/schema.sql` drops everything, creates the tables and loads the catalogues (provinces, species, breeds).
  - `db/seed.sql` holds demo data and runs after the schema. It does not exist yet: a minimal version comes first, the full one at the end.
  - **Tests use only `schema.sql`** and create their own data, never relying on the seed.

## Environment notes

- Windows, with Git at `C:\Git`. Input-box `!` commands use bash.
- `core.autocrlf=true`, so the test-lock script normalises CRLF before hashing.
- PostgreSQL 18 is the target version; use its features freely.
