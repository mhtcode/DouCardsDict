import { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, Search, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { api } from '../api'
import type { Word } from '../types'

function Highlight({ value, query }: { value: string; query: string }) {
  const index = value.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0 || !query) return value
  return <>{value.slice(0, index)}<mark>{value.slice(index, index + query.length)}</mark>{value.slice(index + query.length)}</>
}

export function SearchPalette({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (word: Word) => void }) {
  const [query, setQuery] = useState(''), [results, setResults] = useState<Word[]>([]), [active, setActive] = useState(0)
  const sequence = useRef(0), inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); else { setQuery(''); setResults([]) } }, [open])
  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const current = ++sequence.current
    const timer = window.setTimeout(() => api.search(query).then(data => { if (current === sequence.current) { setResults(data.results); setActive(0) } }).catch(() => {}), 70)
    return () => clearTimeout(timer)
  }, [query])
  const choose = (word: Word) => { onSelect(word); onClose() }
  return <AnimatePresence>{open && <motion.div className="palette-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <motion.div className="search-palette" role="dialog" aria-modal="true" aria-label="Search your collection" initial={{ opacity: 0, y: -18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: .98 }}>
      <div className="palette-input"><Search size={20}/><input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search words, phrases and context…" aria-label="Search" onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(results.length - 1, index + 1)) }
        if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)) }
        if (event.key === 'Enter' && results[active]) choose(results[active])
        if (event.key === 'Escape') onClose()
      }}/><button className="icon-button" onClick={onClose} aria-label="Close search"><X size={18}/></button></div>
      <div className="palette-results" role="listbox">
        {!query && <div className="search-empty"><span>Start typing to search all saved English</span><kbd>↑ ↓ navigate · ↵ open</kbd></div>}
        {query && !results.length && <div className="search-empty">No saved match yet</div>}
        {results.map((word, index) => <button key={word.id} className={`search-result ${index === active ? 'active' : ''}`} role="option" aria-selected={index === active} onMouseEnter={() => setActive(index)} onClick={() => choose(word)}>
          <span><strong><Highlight value={word.term} query={query}/></strong><small><Highlight value={word.sentence || word.definition || 'Saved vocabulary'} query={query}/></small></span>
          <span className="result-meta"><b lang="fa" dir="rtl">{word.persian}</b>{index === active && <CornerDownLeft size={16}/>}</span>
        </button>)}
      </div>
    </motion.div>
  </motion.div>}</AnimatePresence>
}
