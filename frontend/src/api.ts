export type NameOut = { id: number; name: string }

export type Subcategory = {
  id: number
  name: string
  category_id: number
  fields: { id: number; label: string; position: number }[]
}

export type Item = {
  id: number
  name: string
  manufacturer_number: string | null
  category_id: number
  subcategory_id: number
  field_values: Record<string, string>
  location_id: number | null
  owner_id: number
  category: NameOut
  subcategory: Subcategory
  location: NameOut | null
  owner: NameOut
  quantity: number
  low_stock: boolean
  note: string
  how_to_buy: string
  image_path: string | null
  image_url: string | null
  created_at: string
  updated_at: string
  outstanding: { person: string; quantity: number }[] | null
}

export type Movement = {
  id: number
  item_id: number
  item_name: string
  item_manufacturer_number: string | null
  person: string | null
  type: 'BORROW' | 'RETURN' | 'ADJUST'
  quantity: number
  created_at: string
  outstanding: number
}

export type OutstandingMovement = {
  item_id: number
  item_name: string
  item_manufacturer_number: string | null
  person: string
  outstanding: number
}

export type Page<T> = { items: T[]; total: number; page: number; page_size: number }
export type MovementResult = { item: Item; warning: string | null }
export type Home = { total_items: number; low_stock_count: number; low_stock_items: Item[] }

// Turns a FastAPI error body into one readable sentence.
function errorMessage(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((d: { loc?: unknown[]; msg?: string }) => {
        const field = d.loc?.filter((p) => p !== 'body').join('.')
        return field ? `${field}: ${d.msg}` : d.msg
      })
      .join('; ')
  }
  return `Request failed (${status})`
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (typeof init.body === 'string') headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch('/api/v1' + path, { ...init, headers })
  } catch {
    throw new Error('Cannot reach the server. Is the backend running?')
  }
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(errorMessage(body, res.status))
  return body as T
}

export const post = <T>(path: string, data?: unknown) =>
  api<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) })

export const patch = <T>(path: string, data: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(data) })

export const del = <T = void>(path: string) => api<T>(path, { method: 'DELETE' })

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) s.set(k, String(v))
  }
  const out = s.toString()
  return out ? '?' + out : ''
}
