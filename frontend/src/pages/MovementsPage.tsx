import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, errText, qs, type Movement, type Page } from '../api'
import { ErrorBox, fmtTime, inputCls, Pager, useQueryState } from '../ui'

const PAGE_SIZE = 50
const TYPE_LABEL = { BORROW: 'Borrowed', RETURN: 'Returned', ADJUST: 'Adjusted' }
const TYPE_STYLE = {
  BORROW: 'bg-blue-100 text-blue-800',
  RETURN: 'bg-green-100 text-green-800',
  ADJUST: 'bg-slate-200 text-slate-700',
}

export default function MovementsPage() {
  const [get, set] = useQueryState()
  const q = get('q')
  const type = get('type')
  const notReturned = get('not_returned') === '1'
  const page = Number(get('page')) || 1

  const [text, setText] = useState(q)
  const [data, setData] = useState<Page<Movement> | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const t = setTimeout(() => {
      if (text !== q) set({ q: text, page: '' })
    }, 250)
    return () => clearTimeout(t)
  }, [text])

  useEffect(() => {
    let cancelled = false
    api<Page<Movement>>('/movements' + qs({ q, type, not_returned: notReturned, page, page_size: PAGE_SIZE }))
      .then((d) => {
        if (cancelled) return
        setData(d)
        setError('')
      })
      .catch((e) => !cancelled && setError(errText(e)))
    return () => {
      cancelled = true
    }
  }, [q, type, notReturned, page])

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Movements</h1>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={inputCls + ' flex-1 min-w-48'}
          placeholder="Search item name or Manufacturer Number"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
        />
        <select className={inputCls + ' w-auto'} value={type} onChange={(e) => set({ type: e.target.value, page: '' })}>
          <option value="">All types</option>
          <option value="BORROW">Borrowed</option>
          <option value="RETURN">Returned</option>
          <option value="ADJUST">Adjusted</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={notReturned}
            onChange={(e) => set({ not_returned: e.target.checked ? '1' : '', page: '' })}
          />
          Not yet returned
        </label>
      </div>

      <ErrorBox message={error} />

      {data && data.total === 0 && <p className="text-slate-600">No movements found.</p>}

      {data && data.total > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Still out</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-500">{fmtTime(m.created_at)}</td>
                    <td className="px-3 py-2">
                      <Link to={'/items/' + m.item_id} className="font-medium text-blue-700 hover:underline">
                        {m.item_name}
                      </Link>
                      {m.item_manufacturer_number && <span className="ml-2 font-mono text-xs text-slate-500">{m.item_manufacturer_number}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${TYPE_STYLE[m.type]}`}>{TYPE_LABEL[m.type]}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {m.type === 'ADJUST' && m.quantity > 0 ? '+' : ''}
                      {m.quantity}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {m.outstanding ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">
                          {m.outstanding}
                        </span>
                      ) : (
                        ''
                      )}
                    </td>
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
