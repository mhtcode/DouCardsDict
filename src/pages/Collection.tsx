import { useEffect, useRef, useState } from 'react'
import { Search, Volume2 } from 'lucide-react'
import { motion } from 'motion/react'
import { api } from '../api'
import { useSpeech } from '../components/SpeechProvider'
import type { Word } from '../types'

function Highlight({ value, query }: { value: string; query: string }) { const i = value.toLowerCase().indexOf(query.toLowerCase()); return i < 0 || !query ? value : <>{value.slice(0, i)}<mark>{value.slice(i, i + query.length)}</mark>{value.slice(i + query.length)}</> }

export function Collection({ initialWords, onOpen }: { initialWords: Word[]; onOpen: (word: Word) => void }) {
  const [query, setQuery] = useState(''), [words, setWords] = useState(initialWords.slice(0, 120)), [active, setActive] = useState(-1), sequence = useRef(0), { speak } = useSpeech()
  useEffect(() => {
    if (!query.trim()) { setWords(initialWords.slice(0, 120)); setActive(-1); return }
    const current = ++sequence.current, timer = window.setTimeout(() => api.search(query, 120).then(data => { if (current === sequence.current) { setWords(data.results); setActive(0) } }), 70)
    return () => clearTimeout(timer)
  }, [query, initialWords])
  return <div className="page"><header className="page-title"><div><span className="eyebrow">Your living vocabulary</span><h1>Collection</h1><p>{initialWords.length.toLocaleString()} words and phrases, searchable as you type.</p></div></header>
    <div className="collection-search glass"><Search size={19}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search term, sentence or definition…" aria-label="Search collection" onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setActive(x => Math.min(words.length - 1, x + 1)) } if (event.key === 'ArrowUp') { event.preventDefault(); setActive(x => Math.max(0, x - 1)) } if (event.key === 'Enter' && words[active]) onOpen(words[active]) }}/><kbd>{words.length} results</kbd></div>
    <div className="collection-grid">{words.map((word, index) => <motion.article className={`collection-card glass ${active === index ? 'active' : ''}`} key={word.id} data-term={word.term} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 12) * .025 }}>
      <div className="collection-card-top"><span>{word.part_of_speech || (word.term.includes(' ') ? 'phrase' : 'word')}</span><button className="icon-button" data-no-translate onClick={() => speak(word.term)} aria-label={`Pronounce ${word.term}`}><Volume2 size={17}/></button></div>
      <button className="collection-word" onClick={() => onOpen(word)}><strong><Highlight value={word.term} query={query}/></strong><b lang="fa" dir="rtl">{word.persian}</b></button>
      <p><Highlight value={word.sentence || word.definition || 'No example saved yet.'} query={query}/></p>
      <footer><span>{word.attempts ? `${word.correct || 0}/${word.attempts} correct` : 'New'}</span><button className="text-button" onClick={() => onOpen(word)}>Explore →</button></footer>
    </motion.article>)}</div>
  </div>
}
