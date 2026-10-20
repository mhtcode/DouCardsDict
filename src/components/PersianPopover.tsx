import { useEffect, useState } from 'react'
import { BookOpen, Volume2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { api } from '../api'
import { useSpeech } from './SpeechProvider'
import type { Word } from '../types'

type Popover = { word: Word; x: number; y: number }

export function PersianPopover() {
  const [popover, setPopover] = useState<Popover | null>(null), { speak } = useSpeech()
  useEffect(() => {
    const reveal = async (text: string, x: number, y: number) => {
      if (!text || text.length > 240) return
      try { const { match } = await api.translate(text); setPopover({ word: match, x: Math.min(window.innerWidth - 330, Math.max(12, x)), y: Math.min(window.innerHeight - 230, Math.max(12, y)) }) } catch {}
    }
    const pointer = (event: PointerEvent) => {
      const selected = window.getSelection()?.toString().trim()
      if (selected) { const rect = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).getBoundingClientRect() : null; reveal(selected, rect?.left || event.clientX, (rect?.bottom || event.clientY) + 8); return }
      const target = event.target as HTMLElement
      const term = target.closest<HTMLElement>('[data-term]')?.dataset.term
      if (term && !target.closest('input,textarea,select,[data-no-translate]')) reveal(term, event.clientX, event.clientY + 12)
    }
    const key = (event: KeyboardEvent) => event.key === 'Escape' && setPopover(null)
    document.addEventListener('pointerup', pointer)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerup', pointer); document.removeEventListener('keydown', key) }
  }, [])
  return <AnimatePresence>{popover && <motion.aside className="translation-popover" style={{ left: popover.x, top: popover.y }} initial={{ opacity: 0, y: 6, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: .97 }} role="dialog" aria-label={`Meaning of ${popover.word.term}`}>
    <button className="icon-button popover-close" aria-label="Close meaning" onClick={() => setPopover(null)}><X size={16}/></button>
    <div className="popover-heading"><div className="mini-icon"><BookOpen size={17}/></div><div><strong>{popover.word.term}</strong><span>{popover.word.phonetic || 'Saved expression'}</span></div><button className="icon-button" aria-label={`Pronounce ${popover.word.term}`} onClick={() => speak(popover.word.term)}><Volume2 size={18}/></button></div>
    <p className="persian-meaning" lang="fa" dir="rtl">{popover.word.persian}</p>
    {popover.word.definition && <p className="popover-definition">{popover.word.definition}</p>}
  </motion.aside>}</AnimatePresence>
}
