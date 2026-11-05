import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, errText, post, type Item, type Subcategory } from '../api'
import { btnGhost, btnPrimary, cardCls, ErrorBox, inputCls, Label, namePrefix, NamedSelect, SubcategoryDialog } from '../ui'

const MAX_IMAGE = 5 * 1024 * 1024

export default function NewItemPage() {
  const navigate = useNavigate()
  const [sp] = useSearchParams()
  const [form, setForm] = useState({
    manufacturer_number: sp.get('manufacturer_number') ?? '', // pre-filled when coming from a barcode scan that matched nothing
    quantity: '1',
    note: '',
    how_to_buy: '',
  })
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [subcategories, setSubcategories] = useState<Subcategory[]>([])
  const [subcategoryId, setSubcategoryId] = useState<number | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [locationId, setLocationId] = useState<number | null>(null)
  const [ownerId, setOwnerId] = useState<number | null>(null)
  const [picture, setPicture] = useState<File | null>(null)
  const [dialog, setDialog] = useState<'new' | 'edit' | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const subcategory = subcategories.find((s) => s.id === subcategoryId) ?? null

  useEffect(() => {
    setSubcategories([])
    setSubcategoryId(null)
    setValues({})
    if (categoryId === null) return
    let cancelled = false
    api<Subcategory[]>('/subcategories?category_id=' + categoryId)
      .then((list) => !cancelled && setSubcategories(list))
      .catch((e) => !cancelled && setError(errText(e)))
    return () => {
      cancelled = true
    }
  }, [categoryId])

  const text = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value }),
  })

  // A barcode scanner ends with Enter. Never let that submit the form.
  function blockEnter(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault()
  }

  function savedSubcategory(saved: Subcategory) {
    setSubcategories((list) =>
      [...list.filter((s) => s.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)),
    )
    if (saved.id !== subcategoryId) setValues({})
    setSubcategoryId(saved.id)
    setDialog(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const quantity = Number(form.quantity)
    if (categoryId === null) return setError('Please choose a category.')
    if (subcategory === null) return setError('Please choose a subcategory.')
    const empty = subcategory.fields.find((f) => !(values[f.id] ?? '').trim())
    if (empty) return setError(`Please fill in ${empty.label}.`)
    if (locationId === null) return setError('Please choose a location.')
    if (ownerId === null) return setError('Please choose an owner.')
    if (form.quantity.trim() === '' || !Number.isInteger(quantity) || quantity < 0)
      return setError('Quantity must be a whole number, 0 or more.')
    if (picture && picture.size > MAX_IMAGE) return setError('Image is larger than 5 MB.')
    setBusy(true)
    setError('')
    try {
      const item = await post<Item>('/items', {
        ...form,
        quantity,
        category_id: categoryId,
        subcategory_id: subcategory.id,
        field_values: values,
        location_id: locationId,
        owner_id: ownerId,
      })
      let imageError = ''
      if (picture) {
        const body = new FormData()
        body.append('file', picture)
        await api(`/items/${item.id}/image`, { method: 'POST', body }).catch((err) => {
          imageError = errText(err) // the item exists now, so show this on its page
        })
      }
      navigate('/items/' + item.id, { state: { imageError } })
    } catch (err) {
      setError(errText(err))
      setBusy(false)
    }
  }

  return (
    <>
      <form onSubmit={submit} onKeyDown={blockEnter} className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-xl font-semibold">New item</h1>
        <div className={cardCls + ' space-y-4'}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Label text="Category *">
              <NamedSelect kind="categories" value={categoryId} onChange={setCategoryId} required />
            </Label>
            <div>
              <Label text="Subcategory *">
                <select
                  className={inputCls}
                  required
                  disabled={categoryId === null}
                  value={subcategoryId ?? ''}
                  onChange={(e) => {
                    if (e.target.value === '__new') return setDialog('new')
                    setSubcategoryId(e.target.value ? Number(e.target.value) : null)
                    setValues({})
                  }}
                >
                  <option value="" disabled>
                    {categoryId === null ? 'Choose a category first' : 'Select subcategory…'}
                  </option>
                  {subcategories.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                  <option value="__new">+ Add new…</option>
                </select>
              </Label>
              {subcategory && (
                <button
                  type="button"
                  className="mt-1 rounded border border-slate-300 px-1.5 py-0.5 text-xs hover:bg-slate-100"
                  onClick={() => setDialog('edit')}
                >
                  Edit
                </button>
              )}
            </div>
          </div>

          {subcategory && (
            <div className="space-y-3 rounded border border-slate-200 p-3">
              {subcategory.fields.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {subcategory.fields.map((f) => (
                    <Label key={f.id} text={f.label + ' *'}>
                      <input
                        className={inputCls}
                        required
                        value={values[f.id] ?? ''}
                        onChange={(e) => setValues({ ...values, [f.id]: e.target.value })}
                      />
                    </Label>
                  ))}
                </div>
              )}
              <p className="text-sm text-slate-600">
                Name: <span className="font-mono font-medium">{namePrefix(subcategory, values)}.#</span>
                <span className="ml-2 text-xs text-slate-500">(the number is set when you save)</span>
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Label text="Location *">
              <NamedSelect kind="locations" value={locationId} onChange={setLocationId} required />
            </Label>
            <Label text="Owner *">
              <NamedSelect kind="people" value={ownerId} onChange={setOwnerId} required />
            </Label>
          </div>
          <Label text="Quantity *">
            <input type="number" min={0} step={1} required className={inputCls + ' w-32'} {...text('quantity')} />
          </Label>
          <Label text="Manufacturer Number (optional)">
            <input className={inputCls + ' font-mono'} maxLength={100} {...text('manufacturer_number')} />
          </Label>
          <Label text="Note">
            <textarea rows={2} className={inputCls} placeholder="e.g. this battery was overcharged" {...text('note')} />
          </Label>
          <Label text="How to buy">
            <textarea rows={3} className={inputCls} {...text('how_to_buy')} />
          </Label>
          <Label text="Picture (JPEG, PNG or WebP, up to 5 MB)">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="block text-sm"
              onChange={(e) => setPicture(e.target.files?.[0] ?? null)}
            />
          </Label>
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

      {/* Outside the form, so Enter in the popup can never submit it. */}
      {dialog && categoryId !== null && (
        <SubcategoryDialog
          categoryId={categoryId}
          sub={dialog === 'edit' ? subcategory : null}
          onClose={() => setDialog(null)}
          onSaved={savedSubcategory}
        />
      )}
    </>
  )
}
