# Lab Inventory

Single-user inventory app for a lab's engineering parts. Localhost only, no login.
**Keep it simple: fewest files, fewest dependencies, no over-engineering.**

## Layout
- `docker-compose.yml`: PostgreSQL only (credentials from `.env`, named volume `pgdata`)
- `backend/`: FastAPI + SQLAlchemy 2 + psycopg 3. Files: `main.py` (routes), `models.py` (tables, engine), `schemas.py` (request/response models)
- `frontend/`: React + Vite + TypeScript + Tailwind (v4, via `@tailwindcss/vite`) + React Router. Plain `fetch` and `useState`/`useEffect` only. `src/api.ts` (fetch helper + types), `src/ui.tsx` (shared bits), `src/pages/*` (one file per page)
- `data/images/`: uploaded pictures (gitignored)

## Run
```
docker compose up -d
cd backend && source venv/bin/activate && uvicorn main:app --host 127.0.0.1 --port 8000 --reload
cd frontend && npm run dev          # Vite proxies /api to 127.0.0.1:8000
```
API docs: http://127.0.0.1:8000/docs

## Rules to keep
- No Alembic: tables are created on startup. Schema changes mean resetting the local DB (`docker compose down -v`).
- Everything works offline: no CDN assets or remote fonts.
- All routes live under `/api/v1`. Errors: 422 validation, 409 business-rule violation, with a human-readable `detail` string.
- Quantity only changes through `POST /items/{id}/movements` (BORROW / RETURN / ADJUST). It locks the item row (`SELECT ... FOR UPDATE`) and writes the movement in the same transaction. `PATCH /items/{id}` rejects `quantity`.
- BORROW and RETURN require a person; `movement.person_id` is NULL only for ADJUST. Outstanding borrowed units = sum(BORROW) - sum(RETURN) per person per item. It is computed, never stored. Returning more than a person borrowed warns but is allowed.
- People (`Person`) are one shared list for borrowers and owners, with no rename or removal. An item's owner is required and not editable after creation.
- Items cannot be removed. `movement.item_id` is a required FK (ON DELETE RESTRICT), and movements show the item's current name and Manufacturer Number through a join.
- Pictures can be replaced or removed; both delete the old file from disk.
- Manufacturer Number is optional and not unique. Empty input is stored as NULL.
- Pressing Enter in the search box opens an item only if exactly one item has that exact Manufacturer Number (trimmed, case-insensitive) and no other item matches; otherwise it lists the exact matches, or the partial matches if there are none.
- Barcode scans end with Enter: search and form inputs must never submit a form on Enter (the search box has no `<form>`, the new-item form blocks Enter in inputs).
- Images: JPEG/PNG/WebP, max 5 MB, verified with Pillow, saved under a random name in `data/images/`; only the path is stored on the item.

## Out of scope (do not build)
Login, projects, suppliers, purchase links, prices, quick add, archive/restore, reorder levels, custom fields, CSV import/export, backups, camera barcode scanning, label printing, tests, Alembic, containerizing the backend/frontend.
