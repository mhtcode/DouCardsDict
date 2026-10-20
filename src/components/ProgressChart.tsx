import { useEffect, useMemo, useState } from 'react'
import { BarChart3, LoaderCircle, TrendingUp } from 'lucide-react'
import { api } from '../api'
import type { ProgressReport } from '../types'

const WIDTH = 1000, HEIGHT = 220, TOP = 20, BOTTOM = 184
function shortDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${value}T12:00:00`)) }

export function ProgressChart() {
  const [range, setRange] = useState<7 | 30 | 90>(30), [report, setReport] = useState<ProgressReport | null>(null), [active, setActive] = useState<number | null>(null), [loading, setLoading] = useState(true)
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  useEffect(() => { setLoading(true); api.progress(range, timeZone).then(setReport).finally(() => setLoading(false)) }, [range, timeZone])
  const geometry = useMemo(() => {
    const series = report?.series || [], maxWords = Math.max(1, ...series.map(day => day.uniqueWords)), step = WIDTH / Math.max(1, series.length), barWidth = Math.max(3, Math.min(20, step * .48))
    let path = '', drawing = false
    series.forEach((day, index) => { if (day.successRate == null) { drawing = false; return }; const x = (index + .5) * step, y = BOTTOM - day.successRate / 100 * (BOTTOM - TOP); path += `${drawing ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `; drawing = true })
    return { series, maxWords, step, barWidth, path }
  }, [report])
  const selected = active == null ? null : geometry.series[active]
  return <section className="progress-card glass"><div className="progress-card-heading"><div><span className="eyebrow"><TrendingUp size={15}/> Listening progress</span><h2>Daily practice rhythm</h2><p>All six modes · skipped cards excluded</p></div><div className="range-tabs" aria-label="Progress range">{([7, 30, 90] as const).map(value => <button key={value} className={range === value ? 'active' : ''} onClick={() => setRange(value)}>{value} days</button>)}</div></div>
    {loading ? <div className="chart-loading"><LoaderCircle className="spin"/><span>Reading your practice history…</span></div> : report && report.totals.attempts ? <><div className="chart-summary"><div><strong>{report.totals.uniqueWordDays}</strong><span>words practised</span></div><div><strong>{report.totals.attempts}</strong><span>checked answers</span></div><div><strong>{report.totals.successRate ?? 0}%</strong><span>success rate</span></div><div className="chart-legend"><span><i className="bar-key"/> words</span><span><i className="line-key"/> success</span></div></div><div className="progress-visual" onMouseLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${range}-day practice chart. ${report.totals.attempts} answers at ${report.totals.successRate ?? 0} percent success.`}>
        {[0, 50, 100].map(value => { const y = BOTTOM - value / 100 * (BOTTOM - TOP); return <g key={value}><line x1="0" x2={WIDTH} y1={y} y2={y} className="chart-grid"/><text x="4" y={y - 5} className="chart-axis">{value}%</text></g> })}
        {geometry.series.map((day, index) => { const x = (index + .5) * geometry.step, height = day.uniqueWords / geometry.maxWords * (BOTTOM - TOP); return <rect key={day.date} x={x - geometry.barWidth / 2} y={BOTTOM - height} width={geometry.barWidth} height={height} rx="4" className="word-bar"/> })}
        <path d={geometry.path} className="success-line"/>
        {geometry.series.map((day, index) => day.successRate != null && geometry.series.length <= 30 ? <circle key={day.date} cx={(index + .5) * geometry.step} cy={BOTTOM - day.successRate / 100 * (BOTTOM - TOP)} r="4" className="success-dot"/> : null)}
        {geometry.series.map((day, index) => <rect key={`hit-${day.date}`} x={index * geometry.step} y="0" width={geometry.step} height={HEIGHT} fill="transparent" tabIndex={0} role="button" aria-label={`${shortDate(day.date)}: ${day.uniqueWords} words, ${day.attempts} attempts, ${day.successRate == null ? 'no success rate' : `${day.successRate} percent success`}`} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)}/>) }
        {[0, Math.floor((geometry.series.length - 1) / 2), geometry.series.length - 1].filter((value, index, list) => value >= 0 && list.indexOf(value) === index).map(index => <text key={`date-${index}`} x={(index + .5) * geometry.step} y="211" textAnchor="middle" className="chart-date">{shortDate(geometry.series[index].date)}</text>)}
      </svg>{selected && <div className="chart-tooltip"><strong>{shortDate(selected.date)}</strong><span>{selected.uniqueWords} distinct words</span><span>{selected.attempts} attempts · {selected.successRate == null ? '—' : `${selected.successRate}%`} success</span></div>}
    </div><table className="sr-only"><caption>Daily practice progress</caption><thead><tr><th>Date</th><th>Words</th><th>Attempts</th><th>Success rate</th></tr></thead><tbody>{geometry.series.map(day => <tr key={day.date}><td>{day.date}</td><td>{day.uniqueWords}</td><td>{day.attempts}</td><td>{day.successRate ?? 'No attempts'}</td></tr>)}</tbody></table></> : <div className="chart-empty"><BarChart3 size={28}/><div><strong>Your trend will appear here</strong><p>Complete a checked answer in any practice mode to start the daily chart.</p></div></div>}
  </section>
}
