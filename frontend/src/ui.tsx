import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, errText, post, type NameOut } from './api'

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

// Loads the category or location list.
export function useNamed(kind: 'categories' | 'locations') {
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
  kind: 'categories' | 'locations'
  value: number | null
  onChange: (id: number | null) => void
  allowNone?: boolean
  required?: boolean
}) {
  const [list, setList] = useNamed(kind)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const noun = kind === 'categories' ? 'category' : 'location'

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
