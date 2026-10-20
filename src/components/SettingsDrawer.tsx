import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Mail, RotateCcw, Save, SlidersHorizontal, UserRound, Volume2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useSpeech } from './SpeechProvider'
import type { AppSettings } from '../types'

const DEFAULTS: AppSettings = {
  profile: { name: 'Masih', email: '' },
  speech: { accent: 'en-GB', voiceName: '', rate: .86, pitch: 1, autoPlayPrompt: true },
  practice: { autoAdvanceCorrect: true, correctDelayMs: 1500, autoAdvanceIncorrect: false, incorrectDelayMs: 8000 },
}
const ACCENTS = [
  { id: 'en-GB', label: 'British English' },
  { id: 'en-US', label: 'American English' },
  { id: 'en-CA', label: 'Canadian English' },
  { id: 'en-AU', label: 'Australian English' },
] as const

export function SettingsDrawer({ open, settings, onClose, onSave }: { open: boolean; settings: AppSettings; onClose: () => void; onSave: (settings: AppSettings) => Promise<void> }) {
  const [draft, setDraft] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const drawer = useRef<HTMLElement>(null)
  const { voices, speak } = useSpeech()

  useEffect(() => {
    if (open) { setDraft(settings); setSaved(false) }
  }, [open, settings])

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const frame = window.requestAnimationFrame(() => drawer.current?.querySelector<HTMLElement>('button, input, select')?.focus())
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return }
      if (event.key !== 'Tab' || !drawer.current) return
      const focusable = [...drawer.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) return
      const first = focusable[0], last = focusable.at(-1)!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener('keydown', handleKey); previous?.focus() }
  }, [open, onClose])

  const matchingVoices = useMemo(() => voices
    .filter(voice => voice.lang.toLowerCase().startsWith(draft.speech.accent.slice(0, 2).toLowerCase()))
    .sort((a, b) => Number(b.lang.toLowerCase() === draft.speech.accent.toLowerCase()) - Number(a.lang.toLowerCase() === draft.speech.accent.toLowerCase())), [voices, draft.speech.accent])

  const save = async () => {
    setSaving(true); setSaved(false)
    try { await onSave(draft); setSaved(true); window.setTimeout(() => setSaved(false), 1800) }
    finally { setSaving(false) }
  }

  return <AnimatePresence>{open && <motion.div className="settings-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <motion.aside ref={drawer} className="settings-drawer" role="dialog" aria-modal="true" aria-label="Studio settings" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 35, opacity: 0 }}>
      <header><div><span className="eyebrow">Personal workspace</span><h2>Studio settings</h2></div><button className="icon-button" onClick={onClose} aria-label="Close settings"><X size={19}/></button></header>
      <div className="settings-scroll">
        <section className="settings-section">
          <div className="settings-section-title"><UserRound size={18}/><div><h3>Profile</h3><p>Shown only inside your private studio.</p></div></div>
          <label>Display name<input value={draft.profile.name} maxLength={80} onChange={event => setDraft(value => ({ ...value, profile: { ...value.profile, name: event.target.value } }))}/></label>
          <label>Email <span>Profile only</span><div className="input-with-icon"><Mail size={16}/><input type="email" value={draft.profile.email} maxLength={254} placeholder="you@example.com" onChange={event => setDraft(value => ({ ...value, profile: { ...value.profile, email: event.target.value } }))}/></div></label>
        </section>
        <section className="settings-section">
          <div className="settings-section-title"><Volume2 size={18}/><div><h3>Voice & accent</h3><p>Uses English voices installed in this browser.</p></div></div>
          <label>Accent<select value={draft.speech.accent} onChange={event => setDraft(value => ({ ...value, speech: { ...value.speech, accent: event.target.value as AppSettings['speech']['accent'], voiceName: '' } }))}>{ACCENTS.map(accent => <option key={accent.id} value={accent.id}>{accent.label}</option>)}</select></label>
          <label>Voice<select value={draft.speech.voiceName} onChange={event => setDraft(value => ({ ...value, speech: { ...value.speech, voiceName: event.target.value } }))}><option value="">Best available {draft.speech.accent} voice</option>{matchingVoices.map(voice => <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name} · {voice.lang}</option>)}</select></label>
          <div className="range-grid">
            <label>Speed <output>{draft.speech.rate.toFixed(2)}×</output><input type="range" aria-label="Speech speed" min="0.65" max="1.35" step="0.05" value={draft.speech.rate} onChange={event => setDraft(value => ({ ...value, speech: { ...value.speech, rate: Number(event.target.value) } }))}/></label>
            <label>Pitch <output>{draft.speech.pitch.toFixed(2)}</output><input type="range" aria-label="Speech pitch" min="0.7" max="1.3" step="0.05" value={draft.speech.pitch} onChange={event => setDraft(value => ({ ...value, speech: { ...value.speech, pitch: Number(event.target.value) } }))}/></label>
          </div>
          <button className="secondary-button" onClick={() => speak('Listen closely, notice the difference, and remember the word.', draft.speech)}><Volume2 size={16}/> Preview voice</button>
        </section>
        <section className="settings-section">
          <div className="settings-section-title"><SlidersHorizontal size={18}/><div><h3>Practice flow</h3><p>Control listening and the time spent with corrections.</p></div></div>
          <label className="setting-toggle"><span><b>Play each new prompt</b><small>Hear the word or sentence automatically.</small></span><input type="checkbox" checked={draft.speech.autoPlayPrompt} onChange={event => setDraft(value => ({ ...value, speech: { ...value.speech, autoPlayPrompt: event.target.checked } }))}/><i/></label>
          <label className="setting-toggle"><span><b>Advance correct answers</b><small>Move on after the correction is confirmed.</small></span><input type="checkbox" checked={draft.practice.autoAdvanceCorrect} onChange={event => setDraft(value => ({ ...value, practice: { ...value.practice, autoAdvanceCorrect: event.target.checked } }))}/><i/></label>
          {draft.practice.autoAdvanceCorrect && <label>Correct-answer delay <output>{(draft.practice.correctDelayMs / 1000).toFixed(1)} s</output><input type="range" aria-label="Correct-answer delay" min="500" max="5000" step="250" value={draft.practice.correctDelayMs} onChange={event => setDraft(value => ({ ...value, practice: { ...value.practice, correctDelayMs: Number(event.target.value) } }))}/></label>}
          <label className="setting-toggle"><span><b>Advance incorrect answers</b><small>Keep the correction visible for your chosen time.</small></span><input type="checkbox" checked={draft.practice.autoAdvanceIncorrect} onChange={event => setDraft(value => ({ ...value, practice: { ...value.practice, autoAdvanceIncorrect: event.target.checked } }))}/><i/></label>
          {draft.practice.autoAdvanceIncorrect && <label>Incorrect-answer delay <output>{(draft.practice.incorrectDelayMs / 1000).toFixed(0)} s</output><input type="range" aria-label="Incorrect-answer delay" min="3000" max="20000" step="1000" value={draft.practice.incorrectDelayMs} onChange={event => setDraft(value => ({ ...value, practice: { ...value.practice, incorrectDelayMs: Number(event.target.value) } }))}/></label>}
        </section>
      </div>
      <footer><button className="text-button" onClick={() => setDraft(DEFAULTS)}><RotateCcw size={16}/> Reset defaults</button><button className="primary-button" disabled={saving || !draft.profile.name.trim()} onClick={save}>{saved ? <Check size={17}/> : <Save size={17}/>} {saved ? 'Saved' : saving ? 'Saving…' : 'Save changes'}</button></footer>
    </motion.aside>
  </motion.div>}</AnimatePresence>
}
