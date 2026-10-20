import { useEffect, useMemo, useRef, useState } from 'react'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from 'd3-force'
import { Crosshair, Download, Expand, Headphones, LocateFixed, Minus, Plus, Search, Sparkles, Volume2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { api } from '../api'
import { useSpeech } from '../components/SpeechProvider'
import type { SimilarityType, SimilarWord, Word } from '../types'

type CloudNode = SimulationNodeDatum & { id: number; term: string; score: number; width: number; height: number; lines: string[]; center?: boolean }
const ENGINES: { id: SimilarityType; label: string }[] = [
  { id: 'hybrid', label: 'Calibrated hybrid' }, { id: 'semantic', label: 'Semantic vectors' }, { id: 'context', label: 'Sentence context' },
  { id: 'pronunciation', label: 'Pronunciation' }, { id: 'spelling', label: 'Spelling' }, { id: 'morphology', label: 'Morphology & phrases' },
]

function splitLines(term: string) {
  if (term.length <= 18 || !term.includes(' ')) return [term]
  const words = term.split(' '), midpoint = Math.ceil(words.length / 2)
  return [words.slice(0, midpoint).join(' '), words.slice(midpoint).join(' ')].filter(Boolean)
}

function dimensions(term: string) {
  const lines = splitLines(term), canvas = document.createElement('canvas'), context = canvas.getContext('2d')
  if (context) context.font = '600 14px Inter, sans-serif'
  const measured = Math.max(...lines.map(line => context?.measureText(line).width || line.length * 8))
  return { lines, width: Math.min(196, Math.max(90, measured + 30)), height: lines.length > 1 ? 64 : 48 }
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function CloudExplorer({ allWords, initialId, onPractice }: { allWords: Word[]; initialId?: number; onPractice: (ids: number[], type: SimilarityType, center: Word) => void }) {
  const [centerId, setCenterId] = useState(initialId || allWords[0]?.id), [type, setType] = useState<SimilarityType>('hybrid'), [matches, setMatches] = useState<SimilarWord[]>([]), [selected, setSelected] = useState<SimilarWord | Word | null>(null), [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState(''), [searchResults, setSearchResults] = useState<Word[]>([]), [size, setSize] = useState({ width: 900, height: 520 }), [nodes, setNodes] = useState<CloudNode[]>([]), [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  const container = useRef<HTMLDivElement>(null), svgRef = useRef<SVGSVGElement>(null), drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null), clickTimer = useRef<number | null>(null), { speak } = useSpeech()
  const center = useMemo(() => allWords.find(word => word.id === centerId) || allWords[0], [allWords, centerId])

  useEffect(() => { const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(320, entry.contentRect.width), height: Math.max(400, entry.contentRect.height) })); if (container.current) observer.observe(container.current); return () => observer.disconnect() }, [])
  useEffect(() => { if (!center) return; setSelected(null); api.similar(center.id, type, expanded ? 24 : 10).then(data => setMatches(data.matches)).catch(() => setMatches([])) }, [center, type, expanded])
  useEffect(() => { const timer = window.setTimeout(() => query.trim() ? api.search(query, 8).then(data => setSearchResults(data.results)) : setSearchResults([]), 70); return () => window.clearTimeout(timer) }, [query])
  useEffect(() => {
    if (!center) return
    const source: CloudNode[] = [{ id: center.id, term: center.term, score: 1, ...dimensions(center.term), center: true }, ...matches.map(match => ({ id: match.id, term: match.term, score: match.score, ...dimensions(match.term) }))]
    const links = matches.map(match => ({ source: center.id, target: match.id }))
    const simulation = forceSimulation(source).force('charge', forceManyBody<CloudNode>().strength(node => node.center ? -520 : -210)).force('center', forceCenter(size.width / 2, size.height / 2)).force('link', forceLink<CloudNode, { source: number | CloudNode; target: number | CloudNode }>(links).id(node => node.id).distance(node => 112 + (1 - Number((node.target as CloudNode).score || .5)) * 100).strength(.38)).force('collide', forceCollide<CloudNode>().radius(node => Math.max(node.width, node.height) / 2 + 11).iterations(3)).alphaDecay(.045)
    const update = () => { source.forEach(node => { node.x = Math.max(node.width / 2 + 10, Math.min(size.width - node.width / 2 - 10, node.x || size.width / 2)); node.y = Math.max(node.height / 2 + 10, Math.min(size.height - node.height / 2 - 10, node.y || size.height / 2)) }); setNodes(source.map(node => ({ ...node }))) }
    simulation.on('tick', update); update(); return () => { simulation.stop() }
  }, [center, matches, size.width, size.height])

  const matchMap = useMemo(() => new Map(matches.map(match => [match.id, match])), [matches])
  const wordFor = (node: CloudNode) => node.center ? center : matchMap.get(node.id)
  const focusWord = (word: Word) => { if (clickTimer.current) window.clearTimeout(clickTimer.current); setSelected(null); setCenterId(word.id); setQuery(''); setSearchResults([]); setTransform({ x: 0, y: 0, k: 1 }); window.history.replaceState({}, '', `/cloud?id=${word.id}`) }
  const selectWord = (word: Word) => { if (clickTimer.current) window.clearTimeout(clickTimer.current); clickTimer.current = window.setTimeout(() => { setSelected(word); clickTimer.current = null }, 225) }
  const serialise = () => {
    if (!svgRef.current) return ''
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', String(Math.round(size.width))); clone.setAttribute('height', String(Math.round(size.height)))
    clone.querySelectorAll('.cloud-link').forEach(line => { line.setAttribute('stroke', '#5aaefe'); line.setAttribute('stroke-width', '1.15') })
    clone.querySelectorAll('.cloud-node text').forEach(text => { text.setAttribute('fill', '#dbedfd'); text.setAttribute('font-family', 'Inter, Arial, sans-serif'); text.setAttribute('font-size', text.classList.contains('node-score') ? '8' : '14'); text.setAttribute('font-weight', '650') })
    clone.querySelectorAll('[tabindex]').forEach(node => node.removeAttribute('tabindex'))
    return `<?xml version="1.0" encoding="UTF-8"?>${new XMLSerializer().serializeToString(clone)}`
  }
  const downloadSvg = () => { const value = serialise(); if (value) saveBlob(new Blob([value], { type: 'image/svg+xml;charset=utf-8' }), `${center?.term || 'word'}-${type}-cloud.svg`) }
  const downloadPng = () => {
    const value = serialise(); if (!value) return
    const blob = new Blob([value], { type: 'image/svg+xml;charset=utf-8' }), url = URL.createObjectURL(blob), image = new Image()
    image.onload = () => { const scale = 2, canvas = document.createElement('canvas'); canvas.width = Math.round(size.width * scale); canvas.height = Math.round(size.height * scale); const context = canvas.getContext('2d'); if (context) { context.scale(scale, scale); context.drawImage(image, 0, 0, size.width, size.height); canvas.toBlob(result => result && saveBlob(result, `${center?.term || 'word'}-${type}-cloud.png`), 'image/png') } URL.revokeObjectURL(url) }
    image.src = url
  }

  return <div className="page cloud-page"><header className="page-title cloud-heading"><div><span className="eyebrow"><Sparkles size={15}/> Relationship laboratory</span><h1>Word cloud</h1><p>Single-click to inspect. Double-click to recenter. Pan, zoom or practise the visible set.</p></div><div className="cloud-heading-actions"><button className="primary-button" disabled={!center || !matches.length} onClick={() => center && onPractice([center.id, ...matches.map(match => match.id)], type, center)}><Headphones size={17}/> Practice this cloud</button><button className="secondary-button" onClick={() => setExpanded(value => !value)}><Expand size={17}/>{expanded ? 'Compact cloud' : 'Expand to 24'}</button></div></header>
    <div className="cloud-toolbar glass"><div className="cloud-search"><Search size={18}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Change the centre word…" aria-label="Search cloud center"/>{searchResults.length > 0 && <div className="inline-results">{searchResults.map(word => <button key={word.id} onClick={() => focusWord(word)}><strong>{word.term}</strong><span lang="fa" dir="rtl">{word.persian}</span></button>)}</div>}</div><select value={type} onChange={event => setType(event.target.value as SimilarityType)} aria-label="Similarity engine">{ENGINES.map(engine => <option key={engine.id} value={engine.id}>{engine.label}</option>)}</select><div className="zoom-buttons"><button className="icon-button" onClick={() => setTransform(value => ({ ...value, k: Math.min(2.2, value.k + .2) }))} aria-label="Zoom in"><Plus size={17}/></button><button className="icon-button" onClick={() => setTransform(value => ({ ...value, k: Math.max(.65, value.k - .2) }))} aria-label="Zoom out"><Minus size={17}/></button><button className="icon-button" onClick={() => setTransform({ x: 0, y: 0, k: 1 })} aria-label="Reset view"><LocateFixed size={17}/></button></div><div className="cloud-downloads"><button className="secondary-button compact" onClick={downloadPng}><Download size={15}/> PNG</button><button className="secondary-button compact" onClick={downloadSvg}><Download size={15}/> SVG</button></div></div>
    <div className={`cloud-layout ${selected ? 'with-inspector' : ''}`}><div className="cloud-canvas glass" ref={container}>
      <svg ref={svgRef} viewBox={`0 0 ${size.width} ${size.height}`} role="img" aria-label={`${type} relationships for ${center?.term}`} onWheel={event => { event.preventDefault(); const delta = event.deltaY > 0 ? -.1 : .1; setTransform(value => ({ ...value, k: Math.max(.65, Math.min(2.2, value.k + delta)) })) }} onPointerDown={event => { if ((event.target as Element).closest('.cloud-node')) return; drag.current = { x: event.clientX, y: event.clientY, tx: transform.x, ty: transform.y }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={event => { if (drag.current) setTransform(value => ({ ...value, x: drag.current!.tx + event.clientX - drag.current!.x, y: drag.current!.ty + event.clientY - drag.current!.y })) }} onPointerUp={() => { drag.current = null }}>
        <rect width={size.width} height={size.height} fill="#071526"/><defs><linearGradient id="centerGradient" x1="0" x2="1"><stop stopColor="#2587ff"/><stop offset="1" stopColor="#6e5cff"/></linearGradient></defs>
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
          {nodes.filter(node => !node.center).map(node => { const root = nodes.find(item => item.center); return root && <line key={`line-${node.id}`} x1={root.x} y1={root.y} x2={node.x} y2={node.y} className="cloud-link" style={{ opacity: .16 + node.score * .52 }}/>} )}
          {nodes.map((node, index) => { const word = wordFor(node); return <g key={node.id} className={`cloud-node ${node.center ? 'center' : ''} ${selected?.id === node.id ? 'selected' : ''}`} style={{ animationDelay: `${Math.min(index, 10) * .035}s` }} transform={`translate(${(node.x || 0) - node.width / 2} ${(node.y || 0) - node.height / 2})`} tabIndex={0} role="button" aria-label={`${node.term}${node.center ? ', centre word' : `, ${Math.round(node.score * 100)} percent similar`}`} onClick={() => word && selectWord(word)} onDoubleClick={() => word && focusWord(word)} onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && word) { event.preventDefault(); setSelected(word) } }}>
            <title>{node.term}{node.center ? '' : ` · ${Math.round(node.score * 100)}% ${type}`}</title><rect width={node.width} height={node.height} rx="15" fill={node.center ? 'url(#centerGradient)' : 'rgba(13,36,65,.96)'} stroke={node.center ? '#8fc6ff' : '#275683'}/>{node.lines.map((line, lineIndex) => <text key={`${line}-${lineIndex}`} x={node.width / 2} y={node.height / 2 + (lineIndex - (node.lines.length - 1) / 2) * 17 + 5} textAnchor="middle">{line.length > 24 ? `${line.slice(0, 23)}…` : line}</text>)}{!node.center && <text className="node-score" x={node.width - 9} y={11} textAnchor="end">{Math.round(node.score * 100)}</text>}
          </g>})}
        </g>
      </svg><div className="cloud-help">Drag to pan · scroll to zoom · click to inspect · double-click to recenter</div>
    </div><AnimatePresence>{selected && <motion.aside className="cloud-inspector glass" data-no-translate initial={{ opacity: 0, x: 15 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 15 }}><button className="icon-button inspector-close" onClick={() => setSelected(null)} aria-label="Close selected word"><X size={17}/></button><span className="eyebrow">Selected connection</span><div className="inspector-word"><h2>{selected.term}</h2><button className="icon-button" onClick={() => speak(selected.term)} aria-label="Pronounce selected word"><Volume2 size={18}/></button></div><p>{selected.definition || selected.sentence || 'Definition is being enriched.'}</p><b lang="fa" dir="rtl">{selected.persian}</b>{'score' in selected && <div className="signal-meter"><span><i style={{ width: `${Math.round(Number((selected as SimilarWord).score) * 100)}%` }}/></span><small>{Math.round(Number((selected as SimilarWord).score) * 100)}% {type} match</small></div>}<button className="secondary-button full" onClick={() => focusWord(selected)}><Crosshair size={16}/> Recenter cloud</button></motion.aside>}</AnimatePresence></div>
  </div>
}
