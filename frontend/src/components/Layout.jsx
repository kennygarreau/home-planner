import { useState } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { LayoutDashboard, FolderOpen, ListTodo, Calendar, Settings, Home, Menu, X, Wrench, Zap, Thermometer } from 'lucide-react'

const nav = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects', icon: FolderOpen, label: 'Projects' },
  { to: '/backlog', icon: ListTodo, label: 'Backlog' },
  { to: '/calendar', icon: Calendar, label: 'Calendar' },
  { to: '/electrical', icon: Zap, label: 'Electrical' },
  { to: '/manual-j', icon: Thermometer, label: 'Manual J' },
  { to: '/tools', icon: Wrench, label: 'Tools' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false)

  const navLinks = (onClick) => nav.map(({ to, icon: Icon, label }) => (
    <NavLink
      key={to}
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
          isActive
            ? 'bg-brand-600/20 text-brand-400 border border-brand-600/30'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
        }`
      }
    >
      <Icon size={16} />
      {label}
    </NavLink>
  ))

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 flex-shrink-0 bg-slate-900 border-r border-slate-800 flex-col">
        <div className="px-5 py-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
              <Home size={16} className="text-white" />
            </div>
            <div>
              <div className="font-display text-xl tracking-widest text-slate-100 uppercase leading-none">Home</div>
              <div className="font-display text-xl tracking-widest text-brand-400 uppercase leading-none">Planner</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navLinks()}
        </nav>
        <div className="px-5 py-4 border-t border-slate-800">
          <p className="text-xs text-slate-600 font-mono">v1.0.0</p>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 border-r border-slate-800 flex flex-col transform transition-transform duration-200 md:hidden ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-5 py-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
              <Home size={16} className="text-white" />
            </div>
            <div>
              <div className="font-display text-lg tracking-widest text-slate-100 uppercase leading-none">Home</div>
              <div className="font-display text-lg tracking-widest text-brand-400 uppercase leading-none">Planner</div>
            </div>
          </div>
          <button onClick={() => setMobileOpen(false)} className="text-slate-500 hover:text-slate-300 p-1">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navLinks(() => setMobileOpen(false))}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-slate-900 border-b border-slate-800 flex-shrink-0">
          <button onClick={() => setMobileOpen(true)} className="text-slate-400 hover:text-slate-200 p-1">
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-brand-600 flex items-center justify-center">
              <Home size={12} className="text-white" />
            </div>
            <span className="font-display text-lg tracking-widest text-slate-100 uppercase">Home Planner</span>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
