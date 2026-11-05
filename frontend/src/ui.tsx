import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, errText, patch, post, type NameOut, type Subcategory } from './api'

export const inputCls =
  'w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
const btn = 'rounded px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'
export const btnPrimary = btn + ' bg-blue-600 text-white hover:bg-blue-700'
export const btnGhost = btn + ' border border-slate-300 bg-white hover:bg-slate-100'
export const cardCls = 'rounded-lg border border-slate-200 bg-white p-4 shadow-sm'

export const fmtTime = (iso: string) => new Date(iso).toLocaleString()

export function ErrorBox({ message }: { message: string }) {
  if (!message) return null
  return <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p>
}

export function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{text}</span>
      {children}
    </label>
  )
}

export function Dialog({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 className="mb-3 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function Pager({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number
  total: number
  pageSize: number
  onPage: (p: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex items-center justify-between text-sm text-slate-600">
      <span>
        {total} result{total === 1 ? '' : 's'}
        {pages > 1 && ` · page ${page} of ${pages}`}
      </span>
      {pages > 1 && (
        <div className="flex gap-2">
          <button type="button" className={btnGhost} disabled={page <= 1} onClick={() => onPage(page - 1)}>
            Previous
          </button>
          <button type="button" className={btnGhost} disabled={page >= pages} onClick={() => onPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  )
}

type NamedKind = 'categories' | 'locations' | 'people'
const NOUN = { categories: 'category', locations: 'location', people: 'person' }

// Loads the category, location or people list.
export function useNamed(kind: NamedKind) {
  const [list, setList] = useState<NameOut[]>([])
  useEffect(() => {
    api<NameOut[]>('/' + kind).then(setList).catch(() => {})
  }, [kind])
  return [list, setList] as const
}

// Dropdown with an "+ Add new" option that creates the value inline.
export function NamedSelect({
  kind,
  value,
  onChange,
  allowNone = false,
  required = false,
}: {
  kind: NamedKind
  value: number | null
  onChange: (id: number | null) => void
  allowNone?: boolean
  required?: boolean
}) {
  const [list, setList] = useNamed(kind)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const noun = NOUN[kind]

  async function create() {
    if (!name.trim()) return
    try {
      const row = await post<NameOut>('/' + kind, { name })
      setList((l) => [...l, row].sort((a, b) => a.name.localeCompare(b.name)))
      onChange(row.id)
      setAdding(false)
      setName('')
      setError('')
    } catch (e) {
      setError(errText(e))
    }
  }

  if (adding) {
    return (
      <div className="space-y-1">
        <div className="flex gap-2">
          <input
            autoFocus
            className={inputCls}
            placeholder={`New ${noun} name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault() // never submit the surrounding page by accident
                create()
              }
            }}
          />
          <button type="button" className={btnPrimary} onClick={create}>
            Add
          </button>
          <button type="button" className={btnGhost} onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
        <ErrorBox message={error} />
      </div>
    )
  }

  return (
    <select
      className={inputCls}
      required={required}
      value={value ?? ''}
      onChange={(e) => {
        if (e.target.value === '__new') setAdding(true)
        else onChange(e.target.value ? Number(e.target.value) : null)
      }}
    >
      <option value="" disabled={!allowNone}>{allowNone ? '— none —' : `Select ${noun}…`}</option>
      {list.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
      <option value="__new">+ Add new…</option>
    </select>
  )
}

// The generated name without its number, e.g. Battery.4S
export function namePrefix(sub: Subcategory, values: Record<string, string>): string {
  return [sub.name, ...sub.fields.map((f) => (values[f.id] ?? '').trim())].filter(Boolean).join('.')
}

// Popup to create a subcategory (sub = null) or edit one. Existing fields can be renamed but not removed or reordered.
export function SubcategoryDialog({
  categoryId,
  sub,
  onClose,
  onSaved,
}: {
  categoryId: number
  sub: Subcategory | null
  onClose: () => void
  onSaved: (saved: Subcategory) => void
}) {
  const [name, setName] = useState(sub?.name ?? '')
  const [rows, setRows] = useState<{ id?: number; label: string }[]>(
    sub ? sub.fields.map((f) => ({ id: f.id, label: f.label })) : [],
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const setRow = (index: number, label: string) =>
    setRows(rows.map((r, i) => (i === index ? { ...r, label } : r)))

  async function save() {
    if (!name.trim()) return setError('Subcategory name is required.')
    if (rows.some((r) => r.id !== undefined && !r.label.trim())) return setError('Field labels cannot be empty.')
    const filled = rows.filter((r) => r.label.trim()) // new rows left empty are ignored
    setBusy(true)
    setError('')
    try {
      const saved = sub
        ? await patch<Subcategory>('/subcategories/' + sub.id, { name, fields: filled })
        : await post<Subcategory>('/subcategories', {
            name,
            category_id: categoryId,
            fields: filled.map((r) => r.label),
          })
      onSaved(saved)
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }

  return (
    <Dialog title={sub ? 'Edit subcategory' : 'New subcategory'}>
      <div className="space-y-3">
        <Label text="Subcategory name *">
          <input autoFocus className={inputCls} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </Label>
        <div className="space-y-2">
          <span className="block text-sm font-medium text-slate-700">Fields</span>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className={inputCls}
                  maxLength={100}
                  aria-label={`Field ${i + 1} label`}
                  placeholder="Field label, e.g. Cells"
                  value={r.label}
                  onChange={(e) => setRow(i, e.target.value)}
                />
                {r.id === undefined && (
                  <button type="button" className={btnGhost} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" className={btnGhost} onClick={() => setRows([...rows, { label: '' }])}>
            + Add field
          </button>
          {sub && (
            <p className="text-xs text-slate-500">
              Saved fields cannot be removed or reordered. Existing items show a new field as "Needs value".
            </p>
          )}
        </div>
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Dialog>
  )
}

// Keeps search/filter/page in the URL so the Back button returns to the same results.
export function useQueryState() {
  const [sp, setSp] = useSearchParams()
  const get = (k: string) => sp.get(k) ?? ''
  const set = (changes: Record<string, string>) =>
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(changes)) {
          if (v) next.set(k, v)
          else next.delete(k)
        }
        return next
      },
      { replace: true },
    )
  return [get, set] as const
}
