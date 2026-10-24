import { NavLink, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'
import ItemPage from './pages/ItemPage'
import ItemsPage from './pages/ItemsPage'
import MovementsPage from './pages/MovementsPage'
import NewItemPage from './pages/NewItemPage'

const link = ({ isActive }: { isActive: boolean }) =>
  'rounded px-3 py-1.5 text-sm font-medium ' +
  (isActive ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-200')

export default function App() {
  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-3">
          <span className="mr-4 font-semibold">Lab Inventory</span>
          <NavLink to="/" end className={link}>
            Home
          </NavLink>
          <NavLink to="/items" end className={link}>
            Items
          </NavLink>
          <NavLink to="/movements" className={link}>
            Movements
          </NavLink>
          <NavLink to="/items/new" className={(s) => link(s) + ' ml-auto'}>
            + New item
          </NavLink>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/items/new" element={<NewItemPage />} />
          <Route path="/items/:id" element={<ItemPage />} />
          <Route path="/movements" element={<MovementsPage />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </>
  )
}
