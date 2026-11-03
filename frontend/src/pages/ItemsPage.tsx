import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, errText, qs, type Item, type Page } from '../api'
import { btnPrimary, ErrorBox, inputCls, Pager, useNamed, useQueryState } from '../ui'

const PAGE_SIZE = 50

export default function ItemsPage() {
  const navigate = useNavigate()
  const [get, set] = useQueryState()
  const q = get('q')
  const exact = get('exact') === '1' // list only exact Manufacturer Number matches for q (after a scan)
  const category = get('category')
  const location = get('location')
  const page = Number(get('page')) || 1

  const [text, setText] = useState(q)
  const [data, setData] = useState<Page<Item> | null>(null)
  const [error, setError] = useState('')
  const [scanMiss, setScanMiss] = useState('')
  const [categories] = useNamed('categories')
  const [locations] = useNamed('locations')

  // Search as you type (debounced).
  useEffect(() => {
    const t = setTimeout(() => {
      if (text !== q) set({ q: text, page: '' })
    }, 250)
    return () => clearTimeout(t)
  }, [text])

  useEffect(() => {
    let cancelled = false
    api<Page<Item>>(
      '/items' +
        qs({
          q: exact ? undefined : q,
          manufacturer_number: exact ? q : undefined,
          category_id: category,
          location_id: location,
          page,
          page_size: PAGE_SIZE,
        }),
    )
      .then((d) => {
        if (cancelled) return
        setData(d)
        setError('')
      })
      .catch((e) => !cancelled && setError(errText(e)))
    return () => {
      cancelled = true
    }
  }, [q, exact, category, location, page])

  // Barcode scanners type the code and press Enter. There is no <form> here, so Enter can never submit anything.
  async function onEnter() {
    const code = text.trim()
    if (!code) return
    try {
      const [matches, all] = await Promise.all([
        api<Page<Item>>('/items' + qs({ manufacturer_number: code, page_size: 1 })),
        api<Page<Item>>('/items' + qs({ q: code, page_size: 1 })),
      ])
      // Open directly only when one item matches exactly and nothing else matches at all.
      if (matches.total === 1 && all.total === 1) return navigate('/items/' + matches.items[0].id)
      setScanMiss(all.total === 0 ? code : '')
      setText(code)
      // Exact matches hide partial ones, and a scan looks across all categories and locations.
      if (matches.total > 0) set({ q: code, exact: '1', category: '', location: '', page: '' })
      else set({ q: code, exact: '', page: '' })
    } catch (e) {
      setError(errText(e))
    }
  }

  const filtered = q || category || location

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input
          autoFocus
          className={inputCls + ' flex-1 min-w-48'}
          placeholder="Search name or Manufacturer Number (or scan a barcode)"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setScanMiss('')
            if (exact) set({ exact: '' })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onEnter()
            }
          }}
        />
        <select
          className={inputCls + ' w-auto'}
          value={category}
          onChange={(e) => set({ category: e.target.value, page: '' })}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className={inputCls + ' w-auto'}
          value={location}
          onChange={(e) => set({ location: e.target.value, page: '' })}
        >
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <ErrorBox message={error} />

      {scanMiss && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
          <span>
            No item with Manufacturer Number <span className="font-mono">{scanMiss}</span>.
          </span>
          <Link className={btnPrimary} to={'/items/new' + qs({ manufacturer_number: scanMiss })}>
            Add new item
          </Link>
        </div>
      )}

      {data && data.total === 0 && !filtered && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="mb-3 text-slate-600">No items yet.</p>
          <Link className={btnPrimary} to="/items/new">
            Add your first item
          </Link>
        </div>
      )}

      {data && data.total === 0 && filtered && <p className="text-slate-600">No items match.</p>}

      {data && data.total > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-3 py-2">Name / Manufacturer Number</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <Link to={'/items/' + i.id} className="font-medium text-blue-700 hover:underline">
                        {i.name}
                      </Link>
                      {i.manufacturer_number && <span className="ml-2 font-mono text-xs text-slate-500">{i.manufacturer_number}</span>}
                      {i.low_stock && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">low</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{i.category?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{i.location?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-medium">{i.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={data.total} pageSize={PAGE_SIZE} onPage={(p) => set({ page: p > 1 ? String(p) : '' })} />
        </>
      )}
    </div>
  )
}
