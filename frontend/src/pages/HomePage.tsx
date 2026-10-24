import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, errText, type Home } from '../api'
import { btnPrimary, cardCls, ErrorBox } from '../ui'

export default function HomePage() {
  const [data, setData] = useState<Home | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<Home>('/home').then(setData).catch((e) => setError(errText(e)))
  }, [])

  if (error) return <ErrorBox message={error} />
  if (!data) return <p className="text-slate-500">Loading…</p>

  if (data.total_items === 0)
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
        <p className="mb-3 text-slate-600">Nothing here yet.</p>
        <Link className={btnPrimary} to="/items/new">
          Add your first item
        </Link>
      </div>
    )

  const n = data.low_stock_count
  return (
    <div className="space-y-4">
      {n > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          ⚠ {n} item{n === 1 ? '' : 's'} low on stock
        </div>
      )}

      <div className={cardCls + ' flex items-baseline justify-between'}>
        <div>
          <div className="text-3xl font-bold">{data.total_items}</div>
          <div className="text-sm text-slate-500">item{data.total_items === 1 ? '' : 's'} in total</div>
        </div>
        <Link to="/items" className="text-sm text-blue-700 hover:underline">
          Browse all items →
        </Link>
      </div>

      {n > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
          {data.low_stock_items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span>
                <Link to={'/items/' + i.id} className="font-medium text-blue-700 hover:underline">
                  {i.name}
                </Link>
                {i.sku && <span className="ml-2 font-mono text-xs text-slate-500">{i.sku}</span>}
                <span className="ml-2 text-slate-500">
                  {[i.category?.name, i.location?.name].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="font-medium">{i.quantity} left</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
