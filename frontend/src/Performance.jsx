import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDownRight, ArrowLeft, ArrowRight, Award, BarChart3, BookOpenCheck, BriefcaseBusiness, Check, ChevronDown, Clock3, Code2, FileText, LayoutDashboard, LogOut, Medal, MessageSquareText, RefreshCw, ShieldCheck, Target, TrendingDown, TrendingUp, UserRound, X } from 'lucide-react'
import './performance.css'

const labels = { overall: 'Overall', mcq: 'MCQ', coding: 'Coding', project: 'Project-Based' }
const seriesConfig = [
  { key: 'overall', label: 'Overall', color: '#c5a5ff' },
  { key: 'mcq', label: 'MCQ', color: '#54c8f3' },
  { key: 'coding', label: 'Coding', color: '#8a83ff' },
  { key: 'project', label: 'Project', color: '#63dfbd' },
]
const title = value => String(value || '').replace(/^./, char => char.toUpperCase())
async function get(path) {
  const response = await fetch(path, { credentials: 'include' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Could not load performance data.')
  return data
}
const formatDuration = seconds => {
  if (seconds == null) return 'Not tracked'
  const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60)
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}
const formatDate = date => date ? new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date unavailable'

function TrendChart({ points = [], range, setRange }) {
  const [visible, setVisible] = useState(Object.fromEntries(seriesConfig.map(item => [item.key, true])))
  const [hovered, setHovered] = useState(null)
  const filtered = useMemo(() => {
    if (range === 'all') return points
    const cutoff = Date.now() - (range === 'week' ? 7 : 30) * 86400000
    return points.filter(point => new Date(point.date).getTime() >= cutoff)
  }, [points, range])
  const W = 820; const H = 265; const left = 42; const right = 18; const top = 18; const bottom = 34
  const timestamps = filtered.map(point => new Date(point.date).getTime()).filter(Number.isFinite)
  const first = Math.min(...timestamps); const last = Math.max(...timestamps)
  const x = point => timestamps.length < 2 || first === last ? (left + W - right) / 2 : left + ((new Date(point.date).getTime() - first) / (last - first)) * (W - left - right)
  const y = value => top + (100 - value) / 100 * (H - top - bottom)
  const dateLabels = filtered.length ? [filtered[0], filtered[Math.floor((filtered.length - 1) / 2)], filtered[filtered.length - 1]] : []
  return <section className="improvement-chart-card">
    <div className="section-topline"><div><span className="performance-kicker">PERFORMANCE OVER TIME</span><h2>Your improvement curve</h2><p>Scores are cumulative best results per assessment unit, using saved records.</p></div><div className="range-switch" role="group" aria-label="Filter chart by time range">{[['week','Week'],['month','Month'],['all','All time']].map(([key, text]) => <button key={key} className={range === key ? 'selected' : ''} onClick={() => setRange(key)}>{text}</button>)}</div></div>
    <div className="chart-legend">{seriesConfig.map(item => <button key={item.key} className={!visible[item.key] ? 'muted' : ''} onClick={() => setVisible(prev => ({ ...prev, [item.key]: !prev[item.key] }))}><i style={{ background: item.color }}/>{item.label}</button>)}</div>
    {filtered.length ? <div className="chart-scroll"><svg className="trend-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Assessment performance over time">
      {[0,25,50,75,100].map(tick => <g key={tick}><line x1={left} x2={W-right} y1={y(tick)} y2={y(tick)} className="chart-grid-line"/><text x={left-11} y={y(tick)+3} className="chart-axis-label" textAnchor="end">{tick}</text></g>)}
      {seriesConfig.filter(item => visible[item.key]).map(series => {
        const values = filtered.filter(point => point[series.key] != null)
        const d = values.map((point, index) => `${index ? 'L' : 'M'} ${x(point)} ${y(point[series.key])}`).join(' ')
        return <g key={series.key}><path d={d} fill="none" stroke={series.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>{values.map(point => <circle key={`${series.key}-${point.event_id}`} cx={x(point)} cy={y(point[series.key])} r={hovered === `${series.key}-${point.event_id}` ? 5 : 3.2} fill={series.color} stroke="#141827" strokeWidth="2" onMouseEnter={() => setHovered(`${series.key}-${point.event_id}`)} onMouseLeave={() => setHovered(null)}><title>{`${series.label}: ${point[series.key]}% · ${formatDate(point.date)}`}</title></circle>)}</g>
      })}
      {dateLabels.map((point, index) => <text key={`${point.event_id}-${index}`} x={x(point)} y={H-8} className="chart-axis-label" textAnchor={index === 0 ? 'start' : index === 2 ? 'end' : 'middle'}>{formatDate(point.date)}</text>)}
    </svg></div> : <div className="chart-empty"><Activity size={24}/><b>No results in this period</b><span>Try another range or complete an assessment to add a real data point.</span></div>}
  </section>
}

function PipelineCard({ name, icon, data, description, accent }) {
  const isMcq = name === 'MCQ Assessment'; const isCoding = name === 'Coding Assessment';
  return <article className={`pipeline-card ${accent}`}><div className="pipeline-card-title"><span>{icon}</span><div><small>ASSESSMENT PIPELINE</small><h3>{name}</h3></div><ChevronDown size={15}/></div><p className="pipeline-card-desc">{description}</p>
    {isMcq && <div className="pipeline-metrics"><Metric label="Questions" value={data?.questions_attempted ?? 0}/><Metric label="Correct" value={data?.correct ?? 0}/><Metric label="Accuracy" value={data?.accuracy == null ? '—' : `${data.accuracy}%`}/><Metric label="Change" value={data?.improvement_points == null ? '—' : `${data.improvement_points > 0 ? '+' : ''}${data.improvement_points} pts`}/></div>}
    {isCoding && <div className="pipeline-metrics"><Metric label="Problems" value={data?.problems_attempted ?? 0}/><Metric label="Solved" value={data?.problems_solved ?? 0}/><Metric label="Test cases" value={`${data?.test_cases_passed ?? 0}/${data?.test_cases_total ?? 0}`}/><Metric label="Accuracy" value={data?.accuracy == null ? '—' : `${data.accuracy}%`}/></div>}
    {!isMcq && !isCoding && <div className="pipeline-metrics"><Metric label="Projects" value={data?.projects_assessed ?? 0}/><Metric label="Questions" value={data?.questions_answered ?? 0}/><Metric label="Technical score" value={data?.technical_score == null ? '—' : `${data.technical_score}%`}/><Metric label="Change" value={data?.improvement_points == null ? '—' : `${data.improvement_points > 0 ? '+' : ''}${data.improvement_points} pts`}/></div>}
    <div className="pipeline-card-foot"><span>{name === 'Coding Assessment' ? `Avg runtime ${data?.average_execution_time_ms == null ? '—' : `${data.average_execution_time_ms} ms`}` : name === 'MCQ Assessment' ? `${data?.attempts || 0} completed attempts` : `${data?.interviews_completed || 0} completed interviews`}</span><span className="pipeline-card-status">{(isMcq ? data?.attempts : isCoding ? data?.problems_attempted : data?.interviews_completed) ? 'DATA AVAILABLE' : 'NOT ATTEMPTED'}</span></div>
  </article>
}
function Metric({ label, value }) { return <div className="pipeline-metric"><small>{label}</small><b>{value}</b></div> }

function SkillAnalysis({ categories, strengths, weaknesses }) {
  return <section className="skill-analysis-section"><div className="section-topline"><div><span className="performance-kicker">EVIDENCE-BASED SKILL PROFILE</span><h2>Where your skills stand</h2><p>Only topics found in completed assessments are included.</p></div><ShieldCheck size={20}/></div>
    {!categories?.length ? <div className="dashboard-empty-inline"><Target size={22}/><b>Your skill profile will appear after an assessment.</b><span>We need scored MCQ, coding, or project interview results to identify skill performance.</span></div> : <div className="skill-category-grid">{categories.map(category => <article className="skill-category-card" key={category.name}><div className="skill-category-head"><div><b>{category.name}</b><small>{category.evidence_count} scored evidence points</small></div><strong>{category.score}%</strong></div><div className="skill-progress-track"><i style={{ width: `${category.score}%` }}/></div><div className="skill-category-items">{category.skills.map(skill => <div className="skill-row" key={skill.name}><div><span>{skill.name}</span><small className={`skill-status ${skill.status.toLowerCase().replaceAll(' ', '-')}`}>{skill.status}</small></div><div className="skill-row-score"><b>{skill.score}%</b><div className="skill-progress-track"><i style={{ width: `${skill.score}%` }}/></div></div>{skill.change != null && <small className={`skill-change ${skill.change >= 0 ? 'positive' : 'negative'}`}>{skill.change >= 0 ? '+' : ''}{skill.change} pts across recorded attempts</small>}</div>)}</div></article>)}</div>}
    <div className="strength-weak-grid"><section className="insight-card strength"><div><span><Award size={15}/></span><h3>Strengths</h3></div>{strengths?.length ? strengths.map(row => <article key={row.name}><b>{row.name}</b><strong>{row.score}%</strong><small>{row.evidence_count} scored items · {row.sources.join(', ')}</small></article>) : <p>Strong areas will appear when assessment results reach 80%.</p>}</section><section className="insight-card weakness"><div><span><Target size={15}/></span><h3>Next areas to improve</h3></div>{weaknesses?.length ? weaknesses.map(row => <article key={row.name}><div><b>{row.name}</b><strong>{row.score}%</strong></div><small>{row.recommendation}</small></article>) : <p>No topic currently falls below the improvement threshold in recorded results.</p>}</section></div>
  </section>
}

function AssessmentHistory({ rows, onView }) {
  const [filter, setFilter] = useState('all')
  const filtered = filter === 'all' ? rows : rows.filter(item => item.pipeline === filter)
  return <section className="history-section" id="assessment-history"><div className="section-topline"><div><span className="performance-kicker">YOUR RECENT WORK</span><h2>Assessment history</h2><p>Scores and statuses from saved attempts.</p></div><select value={filter} onChange={event => setFilter(event.target.value)} aria-label="Filter assessment history"><option value="all">All assessments</option><option value="mcq">MCQ</option><option value="coding">Coding</option><option value="project">Project-Based</option></select></div>
    {!filtered.length ? <div className="dashboard-empty-inline"><BookOpenCheck size={22}/><b>No assessment history yet.</b><span>Completed assessments will be listed here with links to their saved reports.</span></div> : <div className="history-table-wrap"><table className="history-table"><thead><tr><th>Assessment</th><th>Type</th><th>Date</th><th>Score</th><th>Duration / runtime</th><th>Status</th><th/></tr></thead><tbody>{filtered.map(row => <tr key={row.id}><td><b>{row.name}</b>{row.topic && <small>{row.topic}</small>}</td><td><span className={`history-type ${row.pipeline}`}>{labels[row.pipeline]}</span></td><td>{formatDate(row.date)}</td><td>{row.score == null ? '—' : `${row.score}%`}</td><td>{row.duration_seconds != null ? formatDuration(row.duration_seconds) : row.execution_time_ms != null ? `${row.execution_time_ms} ms runtime` : 'Not recorded'}</td><td><span className={`history-status ${row.status.toLowerCase().replaceAll(' ', '-')}`}>{row.status}</span></td><td><button className="history-view-button" onClick={() => onView(row)}>View report <ArrowRight size={13}/></button></td></tr>)}</tbody></table></div>}
  </section>
}

function ReportDialog({ row, report, busy, error, onClose }) {
  if (!row) return null
  const printable = report?.result || report?.submission || report?.session || report
  return <div className="report-dialog-backdrop" role="presentation" onClick={onClose}><section className="report-dialog" role="dialog" aria-modal="true" aria-label="Assessment report" onClick={event => event.stopPropagation()}><header><div><span className="performance-kicker">SAVED ASSESSMENT REPORT</span><h2>{row.name}</h2></div><button onClick={onClose} aria-label="Close report"><X size={18}/></button></header>{busy ? <div className="report-dialog-empty"><RefreshCw className="spin"/> Loading saved report…</div> : error ? <div className="dashboard-error">{error}</div> : <><div className="report-dialog-summary"><span>{labels[row.pipeline]}</span><b>{row.score == null ? 'No score recorded' : `${row.score}%`}</b><small>{formatDate(row.date)} · {row.status}</small></div><div className="report-json-summary">{Object.entries(printable || {}).filter(([key, value]) => !['questions','test_results','source_code','project_context'].includes(key) && (typeof value !== 'object' || value == null)).slice(0, 18).map(([key, value]) => <div key={key}><span>{key.replaceAll('_', ' ')}</span><b>{String(value ?? '—')}</b></div>)}{Array.isArray(report?.questions) && <div className="report-question-list"><b>{report.questions.length} MCQ questions reviewed</b>{report.questions.map(question => <article key={question.id}><span>Q{question.question_number} · {question.topic}</span><small>{question.is_correct ? 'Correct' : 'Review needed'}{question.explanation ? ` — ${question.explanation}` : ''}</small></article>)}</div>}{Array.isArray(report?.test_results) && <div className="report-question-list"><b>Code execution test cases</b>{report.test_results.map((result, index) => <article key={index}><span>Case {result.case || index + 1}</span><small>{result.status || (result.passed ? 'Passed' : 'Not passed')}</small></article>)}</div>}{Array.isArray(report?.question_results) && <div className="report-question-list"><b>{report.question_results.length} interview questions</b>{report.question_results.map(question => <article key={question.question_number}><span>Q{question.question_number} · {question.topic} · {question.score}%</span><small>{question.feedback}</small></article>)}</div>}</div></> }</section></div>
}

export default function PerformanceWorkspace({ user, onBack, onMcq, onCoding, onProjectInterview, onLogout }) {
  const [bundle, setBundle] = useState(null)
  const [leaderboard, setLeaderboard] = useState(null)
  const [boardPipeline, setBoardPipeline] = useState('overall')
  const [range, setRange] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reportRow, setReportRow] = useState(null)
  const [report, setReport] = useState(null)
  const [reportBusy, setReportBusy] = useState(false)
  const [reportError, setReportError] = useState('')
  const [view, setView] = useState('Dashboard')
  useEffect(() => { get('/api/performance').then(setBundle).catch(err => setError(err.message)) }, [])
  useEffect(() => { setLeaderboard(null); get(`/api/leaderboard?pipeline=${boardPipeline}`).then(setLeaderboard).catch(err => setError(err.message)) }, [boardPipeline])
  const performance = bundle?.performance || {}; const dashboard = bundle?.dashboard || {}
  const overview = dashboard.overview || {}; const categoryData = dashboard.category_performance || {}
  async function refresh() {
    setBusy(true); setError('')
    try { const data = await get('/api/performance'); setBundle(data); setLeaderboard(await get(`/api/leaderboard?pipeline=${boardPipeline}`)) }
    catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  async function viewReport(row) {
    setReportRow(row); setReport(null); setReportError(''); setReportBusy(true)
    try { setReport(await get(row.details_path)) } catch (err) { setReportError(err.message) } finally { setReportBusy(false) }
  }
  const improvement = overview.improvement_percentage
  const history = dashboard.history || []
  const handleNav = label => {
    setView(label)
    if (label === 'Dashboard') window.scrollTo({ top: 0, behavior: 'smooth' })
    if (label === 'Assessment History') document.getElementById('assessment-history')?.scrollIntoView({ behavior: 'smooth' })
    if (label === 'MCQ Assessment') onMcq?.()
    if (label === 'Coding Assessment') onCoding?.()
    if (label === 'Project Assessment') onProjectInterview?.()
    if (label === 'My Portfolio' || label === 'Profile') onBack?.()
    if (label === 'Logout') onLogout?.()
  }
  const nav = [
    { label: 'Dashboard', icon: <LayoutDashboard size={16}/> }, { label: 'My Portfolio', icon: <FileText size={16}/> },
    { label: 'MCQ Assessment', icon: <MessageSquareText size={16}/> }, { label: 'Coding Assessment', icon: <Code2 size={16}/> },
    { label: 'Project Assessment', icon: <BriefcaseBusiness size={16}/> }, { label: 'Performance & Improvement', icon: <BarChart3 size={16}/> },
    { label: 'Assessment History', icon: <BookOpenCheck size={16}/> }, { label: 'Profile', icon: <UserRound size={16}/> },
  ]
  return <main className="performance-shell">
    <aside className="performance-sidebar"><a className="performance-logo" href="#performance-top" onClick={event => { event.preventDefault(); handleNav('Dashboard') }}><span className="performance-logo-glyph">C</span><span>Code<span>Buzz</span></span></a><div className="performance-nav-label">WORKSPACE</div><nav>{nav.map(item => <button key={item.label} className={view === item.label ? 'active' : ''} onClick={() => handleNav(item.label)}>{item.icon}<span>{item.label}</span>{item.label === 'Performance & Improvement' && <i/>}</button>)}</nav><div className="performance-sidebar-bottom"><div className="performance-user"><span>{(user?.full_name || 'CB').split(/\s+/).slice(0, 2).map(value => value[0]).join('').toUpperCase()}</span><div><b>{user?.full_name || 'Candidate'}</b><small>@{user?.username || 'developer'}</small></div></div><button className="performance-logout" onClick={() => handleNav('Logout')}><LogOut size={15}/> Logout</button></div></aside>
    <section className="performance-main" id="performance-top"><header className="performance-topbar"><div><span>Workspace</span><b>/</b><strong>{view === 'Assessment History' ? 'Assessment History' : 'Performance & Improvement'}</strong></div><div><span className="performance-updated"><i/>{overview.latest_assessment_at ? `Updated ${formatDate(overview.latest_assessment_at)}` : 'Awaiting first assessment'}</span><button className="performance-refresh" onClick={refresh} disabled={busy}><RefreshCw size={14} className={busy ? 'spin' : ''}/> Refresh</button></div></header>
      <div className="performance-content">
        {error && <div className="dashboard-error">{error}<button onClick={refresh}>Retry</button></div>}
        <section className="performance-welcome"><div><span className="performance-eyebrow">YOUR TECHNICAL GROWTH</span><h1>Welcome back, {user?.full_name?.split(' ')[0] || 'developer'}<span>.</span></h1><p>A clear picture of your performance, progress, and next steps.</p></div><div className="welcome-shield"><ShieldCheck size={21}/><span>Personal performance</span></div></section>
        <section className="performance-kpi-grid">
          <article className="kpi-card overall-kpi"><div className="kpi-card-top"><span className="kpi-icon"><Target size={17}/></span><span>{overview.provisional ? 'PROVISIONAL' : 'OVERALL SCORE'}</span></div><b>{overview.overall_score == null ? '—' : `${overview.overall_score}`}<small>{overview.overall_score == null ? '' : '/100'}</small></b><div className="kpi-foot"><span>{overview.performance_level || 'Complete an assessment'}</span><span className="kpi-level-dot"/></div></article>
          <article className="kpi-card"><div className="kpi-card-top"><span className="kpi-icon cyan"><BookOpenCheck size={17}/></span><span>ASSESSMENTS COMPLETED</span></div><b>{overview.assessments_completed ?? '—'}</b><div className="kpi-foot"><span>Saved scored attempts</span><span>All pipelines</span></div></article>
          <article className="kpi-card"><div className="kpi-card-top"><span className="kpi-icon violet"><Clock3 size={17}/></span><span>RECORDED TIME</span></div><b>{overview.time_spent_seconds == null ? '—' : formatDuration(overview.time_spent_seconds)}</b><div className="kpi-foot"><span>{overview.timed_assessment_count || 0} timed sessions</span><span title={overview.time_note}>ⓘ</span></div></article>
          <article className="kpi-card"><div className="kpi-card-top"><span className={`kpi-icon ${improvement != null && improvement >= 0 ? 'green' : 'orange'}`}>{improvement != null && improvement < 0 ? <TrendingDown size={17}/> : <TrendingUp size={17}/>}</span><span>CHANGE VS PREVIOUS</span></div><b className={improvement != null && improvement < 0 ? 'negative-score' : ''}>{improvement == null ? '—' : `${improvement > 0 ? '+' : ''}${improvement}%`}</b><div className="kpi-foot"><span>{overview.improvement_points == null ? 'Need at least two scored results' : `${overview.improvement_points > 0 ? '+' : ''}${overview.improvement_points} score points`}</span><span>{overview.improvement_points != null ? 'recent trend' : 'no comparison yet'}</span></div></article>
        </section>
        {!history.length && <section className="performance-first-assessment"><div className="first-assessment-icon"><Activity size={22}/></div><div><h2>Your dashboard starts with your first result.</h2><p>There are no saved assessment results yet. Choose an assessment to create your first real performance data point.</p></div><div><button onClick={onMcq}>MCQ <ArrowRight size={14}/></button><button onClick={onCoding}>Coding <ArrowRight size={14}/></button><button onClick={onProjectInterview}>Project <ArrowRight size={14}/></button></div></section>}
        <TrendChart points={dashboard.trend || []} range={range} setRange={setRange}/>
        <section className="assessment-performance-section"><div className="section-heading"><div><span className="performance-kicker">PIPELINE BREAKDOWN</span><h2>Performance by assessment</h2></div><span>From persisted candidate results</span></div><div className="pipeline-card-grid">
          <PipelineCard name="MCQ Assessment" icon={<MessageSquareText size={16}/>} data={categoryData.mcq} accent="mcq-accent" description="Knowledge accuracy across completed multiple-choice levels."/>
          <PipelineCard name="Coding Assessment" icon={<Code2 size={16}/>} data={categoryData.coding} accent="coding-accent" description="Submission quality, passed test cases, and recorded execution runtime."/>
          <PipelineCard name="Project Assessment" icon={<BriefcaseBusiness size={16}/>} data={categoryData.project} accent="project-accent" description="Technical explanations and understanding demonstrated in project interviews."/>
        </div><p className="metric-limit-note">{overview.time_note}</p></section>
        <SkillAnalysis categories={dashboard.categories || []} strengths={dashboard.strengths || []} weaknesses={dashboard.weaknesses || []}/>
        <section className="improvement-timeline"><div className="section-topline"><div><span className="performance-kicker">REAL MILESTONES</span><h2>Your improvement timeline</h2><p>Milestones appear only when supported by saved results.</p></div><Activity size={19}/></div>{dashboard.milestones?.length ? <div className="milestone-list">{dashboard.milestones.slice(-8).reverse().map((item, index) => <article key={`${item.title}-${index}`}><span className={`milestone-marker ${item.kind}`}><Check size={13}/></span><div><small>{formatDate(item.date)}</small><b>{item.title}</b><p>{item.detail}</p></div></article>)}</div> : <div className="dashboard-empty-inline"><Activity size={21}/><b>Your timeline is ready for your first result.</b><span>Passed levels and measured improvements will appear here as they happen.</span></div>}</section>
        <AssessmentHistory rows={history} onView={viewReport}/>
        <section className="performance-leaderboard"><div className="performance-board-head"><div><span className="performance-kicker">CODEBUZZ LEADERBOARD</span><h2>Performance rankings</h2></div><select value={boardPipeline} onChange={event => setBoardPipeline(event.target.value)}>{Object.entries(labels).map(([key, value]) => <option key={key} value={key}>{value} leaderboard</option>)}</select></div>{leaderboard?.message ? <div className="performance-board-empty"><Medal size={20}/><b>{leaderboard.message}</b></div> : leaderboard?.ranked_candidates?.length ? <div className="performance-table"><div className="performance-table-header"><span>RANK</span><span>CANDIDATE</span><span>SCORE</span><span>STATUS</span><span>BREAKDOWN</span></div>{leaderboard.ranked_candidates.map(item => <article key={item.username}><span className="performance-rank">{item.rank <= 3 ? <Medal size={15}/> : `#${item.rank}`}</span><b>@{item.username}</b><strong>{item.score}%</strong><span>{item.completion[boardPipeline] || 'ATTEMPTED'}</span><span>MCQ {item.scores.mcq == null ? '—' : `${item.scores.mcq}%`} · Coding {item.scores.coding == null ? '—' : `${item.scores.coding}%`} · Project {item.scores.project == null ? '—' : `${item.scores.project}%`}</span></article>)}</div> : leaderboard && <div className="performance-board-empty"><Medal size={20}/><b>No saved {labels[boardPipeline]} scores yet.</b></div>}</section>
        <footer className="performance-footer"><span>CodeBuzz · Performance & Improvement</span><span>Scores are computed from authenticated assessment records.</span></footer>
      </div>
    </section>
    <ReportDialog row={reportRow} report={report} busy={reportBusy} error={reportError} onClose={() => setReportRow(null)}/>
  </main>
}
