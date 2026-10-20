import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Cloud, Headphones, LayoutDashboard, Library, LoaderCircle, LogOut, Menu, RefreshCw, Search, Settings, ShieldCheck, X } from 'lucide-react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { api } from './api'
import { PersianPopover } from './components/PersianPopover'
import { SearchPalette } from './components/SearchPalette'
import { SettingsDrawer } from './components/SettingsDrawer'
import { SpeechProvider } from './components/SpeechProvider'
import { CloudExplorer } from './pages/CloudExplorer'
import { Collection } from './pages/Collection'
import { Dashboard } from './pages/Dashboard'
import { PracticeStudio } from './pages/PracticeStudio'
import { SyncCenter } from './pages/SyncCenter'
import type { AppSettings, SessionState, SimilarityType, Word } from './types'

const NAV = [
  { path: '/', label: 'Overview', icon: LayoutDashboard }, { path: '/practice', label: 'Practice', icon: Headphones },
  { path: '/cloud', label: 'Word cloud', icon: Cloud }, { path: '/collection', label: 'Collection', icon: Library }, { path: '/sync', label: 'Sync', icon: RefreshCw },
]

function usePath() {
  const [path, setPath] = useState(window.location.pathname + window.location.search)
  useEffect(() => { const handler = () => setPath(window.location.pathname + window.location.search); window.addEventListener('popstate', handler); return () => window.removeEventListener('popstate', handler) }, [])
  const navigate = useCallback((next: string) => { window.history.pushState({}, '', next); setPath(next); window.scrollTo({ top: 0, behavior: 'smooth' }) }, [])
  return { path, pathname: path.split('?')[0], navigate }
}

function Brand() { return <div className="brand"><div className="brand-mark" aria-hidden="true"><BookOpen size={21}/><span/></div><div><strong>English Word Studio</strong><small>Listen · notice · remember</small></div></div> }

function Login({ state, onAuthenticated }: { state: SessionState; onAuthenticated: (state: SessionState) => void }) {
  const [password, setPassword] = useState(''), [confirm, setConfirm] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const setup = Boolean(state.setupRequired)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('')
    if (setup && password !== confirm) { setError('The two passwords do not match.'); return }
    setBusy(true)
    try { onAuthenticated(setup ? await api.setup(password) : await api.login(password)) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Sign in failed') } finally { setBusy(false) }
  }
  return <main className="login-page"><div className="login-ambient one"/><div className="login-ambient two"/><motion.section className="login-card glass" initial={{ opacity: 0, y: 16, scale: .99 }} animate={{ opacity: 1, y: 0, scale: 1 }}><Brand/><div className="login-icon"><ShieldCheck size={28}/></div><span className="eyebrow">Private single-user workspace</span><h1>{setup ? 'Create your owner password' : 'Welcome back'}</h1><p>{setup ? 'Your vocabulary is already here. Protect it with a password of at least 12 characters.' : 'Sign in to continue learning from your personal DuoCards collection.'}</p>{setup && !state.setupAllowed ? <div className="login-error">Initial setup must be completed from the local PC or with a server setup token.</div> : <form onSubmit={submit}><label>Password<input type="password" autoFocus autoComplete={setup ? 'new-password' : 'current-password'} minLength={12} value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 12 characters"/></label>{setup && <label>Confirm password<input type="password" autoComplete="new-password" minLength={12} value={confirm} onChange={event => setConfirm(event.target.value)} placeholder="Repeat your password"/></label>}{error && <div className="login-error" role="alert">{error}</div>}<button className="primary-button full" disabled={busy || password.length < 12 || (setup && confirm.length < 12)}>{busy ? <LoaderCircle className="spin" size={18}/> : <ShieldCheck size={18}/>} {setup ? 'Secure my studio' : 'Sign in'}</button></form>}<small className="login-footnote">Secure scrypt password · HttpOnly session · CSRF protected</small></motion.section></main>
}

function AppShell({ session, onLogout }: { session: SessionState; onLogout: () => void }) {
  const { path, pathname, navigate } = usePath(), [words, setWords] = useState<Word[]>([]), [settings, setSettings] = useState<AppSettings | null>(null), [loading, setLoading] = useState(true), [searchOpen, setSearchOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false), [menu, setMenu] = useState(false)
  const loadWords = useCallback(() => api.words('', 5000).then(data => setWords(data.words)).finally(() => setLoading(false)), [])
  useEffect(() => { Promise.all([loadWords(), api.settings().then(setSettings)]) }, [loadWords])
  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true) } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler) }, [])
  const openWord = (word: Word) => navigate(`/cloud?id=${word.id}`)
  const practiceCloud = (ids: number[], type: SimilarityType) => navigate(`/practice?source=cloud&ids=${ids.join(',')}&similarity=${type}`)
  const cloudId = Number(new URLSearchParams(path.split('?')[1] || '').get('id')) || undefined

  if (loading || !settings) return <div className="app-shell"><div className="app-loader"><LoaderCircle className="spin"/><p>Opening your word collection…</p></div></div>
  const displayName = settings.profile.name || session.username || 'Owner'
  return <SpeechProvider settings={settings.speech}><div className="app-shell"><header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMenu(value => !value)} aria-label="Toggle navigation">{menu ? <X/> : <Menu/>}</button><button className="brand-button" onClick={() => navigate('/')} aria-label="Go to overview"><Brand/></button><nav className={menu ? 'open' : ''}>{NAV.map(item => <button key={item.path} className={pathname === item.path ? 'active' : ''} onClick={() => { navigate(item.path); setMenu(false) }}><item.icon size={17}/><span>{item.label}</span></button>)}</nav><div className="topbar-actions"><button className="search-trigger" onClick={() => setSearchOpen(true)} aria-label="Search your words"><Search size={17}/><span>Search your words</span><kbd>Ctrl K</kbd></button><button className="owner-button" onClick={() => setSettingsOpen(true)} aria-label={`Open settings for ${displayName}`}><span className="owner-dot">{displayName.slice(0, 1).toUpperCase()}</span><span>{displayName}</span><Settings size={15}/></button><button className="icon-button logout-button" onClick={onLogout} aria-label="Sign out"><LogOut size={17}/></button></div></header>
    <main className="app-main"><MotionConfig reducedMotion="user"><AnimatePresence mode="wait"><motion.div key={path} className="route-stage" initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: .2 }}>
      {pathname === '/' && <Dashboard words={words} onNavigate={navigate} onSearch={() => setSearchOpen(true)}/>}
      {pathname === '/practice' && <PracticeStudio settings={settings} onNavigate={navigate}/>}
      {pathname === '/cloud' && <CloudExplorer allWords={words} initialId={cloudId} onPractice={practiceCloud}/>}
      {pathname === '/collection' && <Collection initialWords={words} onOpen={openWord}/>}
      {pathname === '/sync' && <SyncCenter onChanged={loadWords}/>}
      {!NAV.some(item => item.path === pathname) && <div className="page empty-state"><h1>Page not found</h1><button className="primary-button" onClick={() => navigate('/')}>Return home</button></div>}
    </motion.div></AnimatePresence></MotionConfig></main>
    <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} onSelect={openWord}/><PersianPopover/><SettingsDrawer open={settingsOpen} settings={settings} onClose={() => setSettingsOpen(false)} onSave={async value => { const saved = await api.updateSettings(value); setSettings(saved) }}/>
  </div></SpeechProvider>
}

export default function App() {
  const [session, setSession] = useState<SessionState | null>(null)
  useEffect(() => { api.session().then(setSession).catch(() => setSession({ authenticated: false })) }, [])
  if (!session) return <div className="splash"><div className="brand-mark"><BookOpen/><span/></div><LoaderCircle className="spin"/></div>
  if (!session.authenticated) return <Login state={session} onAuthenticated={setSession}/>
  return <AppShell session={session} onLogout={async () => { try { await api.logout() } finally { api.setCsrf(''); setSession({ authenticated: false }) } }}/>
}
