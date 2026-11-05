import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { errText, post, type Item } from '../api'
import { btnGhost, btnPrimary, cardCls, ErrorBox, inputCls, Label, NamedSelect } from '../ui'

export default function NewItemPage() {
  const navigate = useNavigate()
  const [sp] = useSearchParams()
  const [form, setForm] = useState({
    name: '',
    manufacturer_number: sp.get('manufacturer_number') ?? '', // pre-filled when coming from a barcode scan that matched nothing
    quantity: '1',
    note: '',
    how_to_buy: '',
  })
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [locationId, setLocationId] = useState<number | null>(null)
  const [ownerId, setOwnerId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const text = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value }),
  })

  // A barcode scanner ends with Enter. Never let that submit the form.
  function blockEnter(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault()
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const quantity = Number(form.quantity)
    if (!form.name.trim()) return setError('Name is required.')
    if (categoryId === null) return setError('Please choose a category.')
    if (locationId === null) return setError('Please choose a location.')
    if (ownerId === null) return setError('Please choose an owner.')
    if (form.quantity.trim() === '' || !Number.isInteger(quantity) || quantity < 0)
      return setError('Quantity must be a whole number, 0 or more.')
    setBusy(true)
    setError('')
    try {
      const item = await post<Item>('/items', {
        ...form,
        quantity,
        category_id: categoryId,
        location_id: locationId,
        owner_id: ownerId,
      })
      navigate('/items/' + item.id)
    } catch (err) {
      setError(errText(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} onKeyDown={blockEnter} className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">New item</h1>
      <div className={cardCls + ' space-y-4'}>
        <Label text="Name *">
          <input autoFocus className={inputCls} required maxLength={200} {...text('name')} />
        </Label>
        <Label text="Manufacturer Number (optional)">
          <input className={inputCls + ' font-mono'} maxLength={100} {...text('manufacturer_number')} />
        </Label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Label text="Category *">
            <NamedSelect kind="categories" value={categoryId} onChange={setCategoryId} required />
          </Label>
          <Label text="Location *">
            <NamedSelect kind="locations" value={locationId} onChange={setLocationId} required />
          </Label>
        </div>
        <Label text="Owner *">
          <NamedSelect kind="people" value={ownerId} onChange={setOwnerId} required />
        </Label>
        <Label text="Quantity *">
          <input type="number" min={0} step={1} required className={inputCls + ' w-32'} {...text('quantity')} />
        </Label>
        <Label text="Note">
          <textarea rows={2} className={inputCls} placeholder="e.g. this battery was overcharged" {...text('note')} />
        </Label>
        <Label text="How to buy">
          <textarea rows={3} className={inputCls} {...text('how_to_buy')} />
        </Label>
        <p className="text-sm text-slate-500">You can add a picture on the next page.</p>
      </div>
      <ErrorBox message={error} />
      <div className="flex gap-2">
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : 'Create item'}
        </button>
        <button type="button" className={btnGhost} onClick={() => navigate(-1)}>
          Cancel
        </button>
      </div>
    </form>
  )
}
