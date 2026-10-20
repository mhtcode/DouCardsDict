import { BookOpenCheck, BrainCircuit, Cloud, Flame, Headphones, Search } from 'lucide-react'
import { motion } from 'motion/react'
import { ProgressChart } from '../components/ProgressChart'
import type { Word } from '../types'

export function Dashboard({ words, onNavigate, onSearch }: { words: Word[]; onNavigate: (path: string) => void; onSearch: () => void }) {
  const reviewed = words.filter(word => word.attempts).length
  const correct = words.reduce((sum, word) => sum + Number(word.correct || 0), 0), attempts = words.reduce((sum, word) => sum + Number(word.attempts || 0), 0)
  const due = words.filter(word => !word.due_at || new Date(word.due_at) <= new Date()).length
  const recent = [...words].slice(-6).reverse()
  return <div className="page dashboard-page">
    <motion.section className="hero-panel glass" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div className="hero-copy"><span className="eyebrow"><Flame size={15}/> Your private learning space</span><h1>Make every saved word<br/><em>usable English.</em></h1><p>Listen closely, notice the differences, and let adaptive review bring the right words back at the right time.</p><div className="hero-actions"><button className="primary-button" onClick={() => onNavigate('/practice')}><Headphones size={18}/> Start a practice set</button><button className="secondary-button" onClick={onSearch}><Search size={18}/> Find a word</button></div></div>
      <div className="hero-orbit" aria-hidden="true"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="orbit-center"><BrainCircuit size={34}/><span>{words.length.toLocaleString()}</span><small>connected words</small></div><span className="orbit-word one">context</span><span className="orbit-word two">sound</span><span className="orbit-word three">meaning</span></div>
    </motion.section>
    <section className="stats-grid">{[
      { icon: BookOpenCheck, label: 'Collection', value: words.length.toLocaleString(), detail: 'DuoCards vocabulary' },
      { icon: Headphones, label: 'Ready now', value: due.toLocaleString(), detail: 'available to practise' },
      { icon: BrainCircuit, label: 'Accuracy', value: attempts ? `${Math.round(correct / attempts * 100)}%` : '—', detail: `${reviewed} words reviewed` },
      { icon: Cloud, label: 'Similarity', value: '6 ways', detail: 'meaning, sound & form' },
    ].map((stat, index) => <motion.article className="stat-card glass" key={stat.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .06 * index }}><div className="stat-icon"><stat.icon size={20}/></div><span>{stat.label}</span><strong>{stat.value}</strong><small>{stat.detail}</small></motion.article>)}</section>
    <ProgressChart/>
    <section className="section-block"><div className="section-heading"><div><span className="eyebrow">From your latest cards</span><h2>Words to explore</h2></div><button className="text-button" onClick={() => onNavigate('/collection')}>View collection →</button></div><div className="word-strip">{recent.map((word, index) => <motion.button className="word-preview glass" key={word.id} data-term={word.term} onClick={() => onNavigate(`/cloud?id=${word.id}`)} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 * index }}><span>{word.part_of_speech || 'saved word'}</span><strong>{word.term}</strong><p>{word.sentence || word.definition || 'Explore its relationships.'}</p><b lang="fa" dir="rtl">{word.persian}</b></motion.button>)}</div></section>
  </div>
}
