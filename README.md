# Lab Inventory

A simple inventory app for a lab's engineering parts. Single user, no login, runs on localhost.
Works fully offline (no CDN assets or remote fonts).

**Stack:** PostgreSQL (Docker) · FastAPI + SQLAlchemy 2 + psycopg 3 · React + Vite + TypeScript + Tailwind + React Router

**Requirements:** Docker, Python 3.11+, Node.js 20+.

## Setup

```bash
git clone <repo-url> inventory
cd inventory

# 1. Database credentials (open .env and change the password)
cp .env.example .env

# 2. Start PostgreSQL
docker compose up -d

# 3. Start the backend: http://127.0.0.1:8000 (API docs at /docs)
cd backend
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# 4. In a second terminal, start the frontend: http://127.0.0.1:5173
cd frontend
npm install
npm run dev
```

Open http://127.0.0.1:5173. Tables are created and the default categories (Mechanical, Electrical, Electronics, EE) and people (Mecatron, IES, JPC, Project House) are added automatically the first time the backend starts. The frontend proxies `/api` to the backend.

Next time, you only need `docker compose up -d`, then the backend and frontend start commands.

## Using it

- **New item:** pick a category, then a subcategory (or "+ Add new" to create one with its fields), fill in its fields, and the name is generated: `Battery.4S.1`, `Battery.4S.2`, `Battery.6S.1`. Location, owner and quantity are required; picture, Manufacturer Number, note and How to buy are optional.
- **Subcategory templates:** "Edit" beside the subcategory renames it (its items' names follow, keeping their numbers), renames field labels (names do not change) or adds fields at the end. A new field shows as "Needs value" on existing items, and their names change once a value is saved. Subcategories and fields cannot be removed or reordered.
- **Items:** search by name or Manufacturer Number, filter by category, location and owner. A barcode scanner types the code and presses Enter in the search box. The item opens directly only if exactly one item has that exact Manufacturer Number (spaces trimmed, case-insensitive) and no other item matches. Otherwise the exact matches are listed, or the partial matches if there are no exact ones. An unknown code offers "Add new item" with the Manufacturer Number filled in.
- **Item page:** fields save when you click out of them, except template values, which have their own Save button. Saving a different value gives the item the next number for its new name, and its movement history follows. Category, subcategory and owner cannot be changed. Borrow and Return need a person; a person can only return units they have outstanding. Set count also changes the quantity (and is how you add stock; setting it to 0 just saves 0). Items cannot be removed. Pictures: JPEG, PNG or WebP, up to 5 MB.
- **People:** one shared list for borrowers and owners. Dropdowns have "+ Add new". Every item has an owner, chosen when it is created and not editable after that.
- **Movements:** read-only log of every borrow, return and count change, with a person filter and a "Not yet returned" filter (items where any person still has units out).

## Reset the local database

Stop the backend, then from the project root:

```bash
docker compose down -v      # deletes the database volume
docker compose up -d
```

Restart the backend and it recreates the tables. Uploaded pictures live in `data/images/`; empty that folder too for a clean slate (otherwise they are just unused files).

## Layout

```
docker-compose.yml  .env.example  .gitignore  README.md  CLAUDE.md
backend/    main.py (routes) · models.py (tables) · schemas.py · requirements.txt
frontend/   Vite React TS app (src/pages has one file per page)
data/images/  uploaded pictures (created automatically, not in git)
```
