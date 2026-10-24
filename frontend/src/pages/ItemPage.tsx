import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  api, del, errText, patch, post, qs,
  type Item, type Movement, type MovementResult, type Page,
} from '../api'
import {
  btnDanger, btnGhost, btnPrimary, cardCls, Dialog, ErrorBox, fmtTime, inputCls, Label, NamedSelect,
} from '../ui'

const MAX_IMAGE = 5 * 1024 * 1024

type Notice = { kind: 'warn' | 'err'; text: string } | null

// A text box that saves when it loses focus.
function AutoField({
  label, value, onSave, multiline = false, mono = false, rows = 3,
}: {
  label: string
  value: string
  onSave: (v: string) => Promise<void>
  multiline?: boolean
  mono?: boolean
  rows?: number
}) {
  const [text, setText] = useState(value)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => setText(value), [value])

  async function save() {
    if (text === value) return
    try {
      await onSave(text)
      setError('')
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      setError(errText(e))
    }
  }

  const cls = inputCls + (mono ? ' font-mono' : '')
  return (
    <div>
      <Label text={label}>
        {multiline ? (
          <textarea rows={rows} className={cls} value={text} onChange={(e) => setText(e.target.value)} onBlur={save} />
        ) : (
          <input
            className={cls}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} // Enter saves (scanner-friendly)
          />
        )}
      </Label>
      {saved && <p className="mt-1 text-xs text-green-700">Saved</p>}
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  )
}

function parseWhole(s: string, min: number): number | null {
  const n = Number(s)
  return s.trim() !== '' && Number.isInteger(n) && n >= min ? n : null
}

export default function ItemPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)

  const [item, setItem] = useState<Item | null>(null)
  const [moves, setMoves] = useState<Movement[]>([])
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState<Notice>(null)
  const [imageError, setImageError] = useState('')
  const [busy, setBusy] = useState(false)
  const [borrowN, setBorrowN] = useState('1')
  const [returnN, setReturnN] = useState('1')
  const [countN, setCountN] = useState('')
  const [dialog, setDialog] = useState<'delete' | 'zero' | null>(null)

  const loadMoves = () =>
    api<Page<Movement>>('/movements' + qs({ item_id: id, page_size: 20 }))
      .then((p) => setMoves(p.items))
      .catch(() => {})

  useEffect(() => {
    setItem(null)
    setLoadError('')
    api<Item>(`/items/${id}`).then(setItem).catch((e) => setLoadError(errText(e)))
    loadMoves()
  }, [id])

  useEffect(() => {
    if (item) setCountN(String(item.quantity))
  }, [item?.quantity])

  if (loadError)
    return (
      <div className="space-y-3">
        <ErrorBox message={loadError} />
        <Link to="/items" className="text-blue-700 hover:underline">
          ← Back to items
        </Link>
      </div>
    )
  if (!item) return <p className="text-slate-500">Loading…</p>

  async function save(field: string, value: unknown) {
    setItem(await patch<Item>(`/items/${id}`, { [field]: value }))
    if (field === 'name' || field === 'sku') loadMoves() // log shows the new name / SKU
  }

  async function saveRef(field: 'category_id' | 'location_id', value: number | null) {
    try {
      await save(field, value)
      setNotice(null)
    } catch (e) {
      setNotice({ kind: 'err', text: errText(e) })
    }
  }

  async function stock(type: 'BORROW' | 'RETURN' | 'ADJUST', quantity: number): Promise<boolean> {
    setBusy(true)
    setNotice(null)
    try {
      const res = await post<MovementResult>(`/items/${id}/movements`, { type, quantity })
      setItem(res.item)
      if (res.warning) setNotice({ kind: 'warn', text: res.warning })
      await loadMoves()
      return true
    } catch (e) {
      setNotice({ kind: 'err', text: errText(e) })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function borrow() {
    const n = parseWhole(borrowN, 1)
    if (n === null) return setNotice({ kind: 'err', text: 'Enter a whole number, 1 or more.' })
    if (await stock('BORROW', n)) setBorrowN('1')
  }

  async function giveBack() {
    const n = parseWhole(returnN, 1)
    if (n === null) return setNotice({ kind: 'err', text: 'Enter a whole number, 1 or more.' })
    if (await stock('RETURN', n)) setReturnN('1')
  }

  async function setCount() {
    const n = parseWhole(countN, 0)
    if (n === null) return setNotice({ kind: 'err', text: 'Enter a whole number, 0 or more.' })
    if (n === 0) return setDialog('zero')
    await stock('ADJUST', n)
  }

  async function keepAtZero() {
    setDialog(null)
    await stock('ADJUST', 0)
  }

  async function deleteItem() {
    setDialog(null)
    try {
      await del(`/items/${id}`)
      navigate('/items')
    } catch (e) {
      setNotice({ kind: 'err', text: errText(e) })
    }
  }

  // "Delete" from the zero dialog: log the count going to 0 first, then remove the item.
  async function zeroThenDelete() {
    setDialog(null)
    if (await stock('ADJUST', 0)) await deleteItem()
  }

  async function toggleLowStock() {
    try {
      setItem(await post<Item>(`/items/${id}/low-stock`))
    } catch (e) {
      setNotice({ kind: 'err', text: errText(e) })
    }
  }

  async function upload(file: File) {
    if (file.size > MAX_IMAGE) return setImageError('Image is larger than 5 MB.')
    const body = new FormData()
    body.append('file', file)
    try {
      setItem(await api<Item>(`/items/${id}/image`, { method: 'POST', body }))
      setImageError('')
    } catch (e) {
      setImageError(errText(e))
    }
  }

  async function removeImage() {
    try {
      setItem(await del<Item>(`/items/${id}/image`))
      setImageError('')
    } catch (e) {
      setImageError(errText(e))
    }
  }

  const noticeCls =
    notice?.kind === 'warn'
      ? 'border-amber-300 bg-amber-50 text-amber-900'
      : 'border-red-300 bg-red-50 text-red-800'

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link to="/items" className="text-sm text-blue-700 hover:underline">
            ← Items
          </Link>
          <h1 className="text-xl font-semibold">
            {item.name}
            {item.sku && <span className="ml-2 font-mono text-sm font-normal text-slate-500">{item.sku}</span>}
          </h1>
        </div>
        <button type="button" className={btnGhost + ' text-red-700'} onClick={() => setDialog('delete')}>
          Delete item
        </button>
      </div>

      {/* Stock */}
      <section className={cardCls + ' space-y-4'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-sm text-slate-500">In stock</span>
            <div className="text-4xl font-bold">{item.quantity}</div>
          </div>
          <button
            type="button"
            onClick={toggleLowStock}
            className={
              item.low_stock
                ? 'rounded border border-amber-400 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900'
                : btnGhost
            }
          >
            {item.low_stock ? '⚠ Low stock (click to clear)' : 'Mark as low stock'}
          </button>
        </div>

        {notice && <p className={`rounded border px-3 py-2 text-sm ${noticeCls}`}>{notice.text}</p>}

        {/* No <form> here, so Enter in a number box never submits anything. */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <input
              type="number" min={1} step={1} className={inputCls} aria-label="Borrow amount"
              value={borrowN} onChange={(e) => setBorrowN(e.target.value)}
            />
            <button type="button" className={btnPrimary + ' w-full'} disabled={busy} onClick={borrow}>
              Borrow
            </button>
          </div>
          <div className="space-y-1">
            <input
              type="number" min={1} step={1} className={inputCls} aria-label="Return amount"
              value={returnN} onChange={(e) => setReturnN(e.target.value)}
            />
            <button type="button" className={btnPrimary + ' w-full'} disabled={busy} onClick={giveBack}>
              Return
            </button>
          </div>
          <div className="space-y-1">
            <input
              type="number" min={0} step={1} className={inputCls} aria-label="New actual quantity"
              value={countN} onChange={(e) => setCountN(e.target.value)}
            />
            <button type="button" className={btnGhost + ' w-full'} disabled={busy} onClick={setCount}>
              Set count
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Set count = the actual number on the shelf now. Use it to add stock or fix the count.
        </p>
      </section>

      {/* Picture and details */}
      <section className={cardCls + ' space-y-4'}>
        <div className="space-y-2">
          {item.image_url && (
            <img src={item.image_url} alt={item.name} className="max-h-64 rounded border border-slate-200 object-contain" />
          )}
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = '' // allow choosing the same file again
                if (f) upload(f)
              }}
            />
            <button type="button" className={btnGhost} onClick={() => fileInput.current?.click()}>
              Choose file
            </button>
            {item.image_url && (
              <button type="button" className={btnGhost} onClick={removeImage}>
                Remove picture
              </button>
            )}
          </div>
          <ErrorBox message={imageError} />
        </div>

        <AutoField label="Name" value={item.name} onSave={(v) => save('name', v)} />
        <AutoField label="SKU / ID / serial number" mono value={item.sku ?? ''} onSave={(v) => save('sku', v)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Label text="Category">
            <NamedSelect kind="categories" allowNone value={item.category_id} onChange={(v) => saveRef('category_id', v)} />
          </Label>
          <Label text="Location">
            <NamedSelect kind="locations" allowNone value={item.location_id} onChange={(v) => saveRef('location_id', v)} />
          </Label>
        </div>
        <AutoField label="Description" multiline value={item.description} onSave={(v) => save('description', v)} />
        <AutoField label="Note" multiline rows={2} value={item.note} onSave={(v) => save('note', v)} />
      </section>

      {/* Movements */}
      <section className={cardCls + ' space-y-3'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Movements</h2>
          {item.outstanding !== null && item.outstanding > 0 && (
            <span className="rounded bg-amber-100 px-2 py-1 text-sm font-semibold text-amber-900 ring-1 ring-amber-300">
              {item.outstanding} currently borrowed, not yet returned
            </span>
          )}
        </div>
        {moves.length === 0 ? (
          <p className="text-sm text-slate-500">No movements yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {moves.map((m) => (
              <li key={m.id} className="flex justify-between gap-3 py-1.5">
                <span className="text-slate-500">{fmtTime(m.created_at)}</span>
                <span>
                  {m.type === 'BORROW' && `Borrowed ${m.quantity}`}
                  {m.type === 'RETURN' && `Returned ${m.quantity}`}
                  {m.type === 'ADJUST' && `Adjusted ${m.quantity > 0 ? '+' : ''}${m.quantity}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-500">
          Latest 20. <Link className="text-blue-700 hover:underline" to={'/movements' + qs({ q: item.sku ?? item.name })}>See all movements</Link>
        </p>
      </section>

      {/* How to buy: always last */}
      <section className={cardCls}>
        <AutoField label="How to buy" multiline rows={4} value={item.how_to_buy} onSave={(v) => save('how_to_buy', v)} />
      </section>

      {dialog === 'delete' && (
        <Dialog title="Delete this item?">
          <p className="mb-4 text-sm text-slate-600">
            “{item.name}” and its picture will be removed. Its movement history stays in the log.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhost} onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button type="button" className={btnDanger} onClick={deleteItem}>
              Delete
            </button>
          </div>
        </Dialog>
      )}

      {dialog === 'zero' && (
        <Dialog title="Quantity is 0">
          <p className="mb-4 text-sm text-slate-600">Quantity is 0. Keep at 0 or Delete item?</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={btnGhost} onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} onClick={keepAtZero}>
              Keep at 0
            </button>
            <button type="button" className={btnDanger} onClick={zeroThenDelete}>
              Delete item
            </button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
