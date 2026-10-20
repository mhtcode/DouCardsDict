import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppSettings } from '../types'

type SpeechOptions = AppSettings['speech']
type SpeechContextValue = { voices: SpeechSynthesisVoice[]; speak: (text: string, overrides?: Partial<SpeechOptions>) => void; stop: () => void }
const SpeechContext = createContext<SpeechContextValue>({ voices: [], speak: () => {}, stop: () => {} })

export function SpeechProvider({ settings, children }: { settings: SpeechOptions; children: ReactNode }) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const refresh = () => setVoices(window.speechSynthesis.getVoices().filter(voice => voice.lang.toLowerCase().startsWith('en')))
    refresh(); window.speechSynthesis.addEventListener('voiceschanged', refresh)
    return () => { window.speechSynthesis.removeEventListener('voiceschanged', refresh); window.speechSynthesis.cancel() }
  }, [])
  const stop = useCallback(() => { if ('speechSynthesis' in window) window.speechSynthesis.cancel() }, [])
  const speak = useCallback((text: string, overrides: Partial<SpeechOptions> = {}) => {
    if (!('speechSynthesis' in window) || !text) return
    const options = { ...settings, ...overrides }; window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = options.accent; utterance.rate = options.rate; utterance.pitch = options.pitch
    const preferred = voices.find(voice => voice.name === options.voiceName)
    const accented = voices.find(voice => voice.lang.toLowerCase() === options.accent.toLowerCase()) || voices.find(voice => voice.lang.toLowerCase().startsWith(options.accent.slice(0, 2).toLowerCase()))
    if (preferred || accented) utterance.voice = preferred || accented || null
    window.speechSynthesis.speak(utterance)
  }, [settings, voices])
  const value = useMemo(() => ({ voices, speak, stop }), [voices, speak, stop])
  return <SpeechContext.Provider value={value}>{children}</SpeechContext.Provider>
}

export const useSpeech = () => useContext(SpeechContext)
