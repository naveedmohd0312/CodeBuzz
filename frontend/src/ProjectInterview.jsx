import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, BriefcaseBusiness, Check, CircleAlert, Clock3, LoaderCircle, RotateCw, Sparkles } from 'lucide-react'
import './project-interview.css'

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'include', ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) { const error = new Error(data.error || 'The interview request failed.'); error.data = data; throw error }
  return data
}
const titleCase = value => String(value || '').replace(/^./, char => char.toUpperCase())

export default function ProjectInterview({ csrf, onBack, onProgressChanged }) {
  const [projects, setProjects] = useState([])
  const [sessions, setSessions] = useState([])
  const [questionCount, setQuestionCount] = useState(6)
  const [session, setSession] = useState(null)
  const [question, setQuestion] = useState(null)
  const [answer, setAnswer] = useState('')
  const [evaluation, setEvaluation] = useState(null)
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)
  const [nextPending, setNextPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { api('/api/project-interview/projects').then(data => {
    setProjects(data.projects || []); setSessions(data.sessions || []); setQuestionCount(data.question_count || 6)
  }).catch(err => setError(err.message)) }, [])

  function loadSessionPayload(payload) {
    const current = payload.session || payload
    setSession(current); setQuestion(current.question || null); setEvaluation(current.latest_evaluation || null)
    setAnswer(current.saved_answer || '')
    setReport(current.status === 'completed' ? current.report || null : null)
    setNextPending(!current.question && current.status !== 'completed')
  }

  async function openSession(id) {
    setBusy(true); setError('')
    try {
      const data = await api(`/api/project-interview/session/${id}`); loadSessionPayload(data)
      if (data.session?.status === 'completed') {
        const final = await api(`/api/project-interview/session/${id}/report`); setReport(final.report)
      } else if (!data.session?.question) await continueSession(id)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function start(projectIndex) {
    setBusy(true); setError('')
    try { const data = await api('/api/project-interview/start', { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify({ project_index: projectIndex }) }); loadSessionPayload({ session: data.session })
      const refreshed = await api('/api/project-interview/projects'); setSessions(refreshed.sessions || [])
    } catch (err) {
      if (err.data?.session_id) { setSession({ id: err.data.session_id, status: 'in_progress', project_name: projects.find(item => item.project_index === projectIndex)?.name }); setNextPending(true) }
      setError(err.message)
    } finally { setBusy(false) }
  }

  async function continueSession(id = session?.id) {
    if (!id) return
    setBusy(true); setError('')
    try { const data = await api(`/api/project-interview/session/${id}/continue`, { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify({}) }); setQuestion(data.question); setSession(prev => ({ ...prev, question_number: data.question_number, question_count: data.question_count })); setNextPending(false); setAnswer('') }
    catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function submitAnswer(event) {
    event.preventDefault(); if (!question || !answer.trim() || busy) return
    setBusy(true); setError('')
    try {
      const data = await api(`/api/project-interview/session/${session.id}/answer`, { method: 'POST',
        headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify({ question_id: question.id, answer }) })
      setEvaluation(data.evaluation); setAnswer('')
      if (data.completed) { setReport(data.report); setQuestion(null); setSession(prev => ({ ...prev, status: 'completed' })); onProgressChanged?.() }
      else if (data.question) { setQuestion(data.question); setSession(prev => ({ ...prev, question_number: data.question_number, question_count: data.question_count })); setNextPending(false) }
    } catch (err) {
      if (err.data?.evaluation) setEvaluation(err.data.evaluation)
      if (err.data?.next_question_pending) { setAnswer(''); setQuestion(null); setNextPending(true) }
      setError(err.message)
    } finally { setBusy(false) }
  }

  const backToProjects = () => { setSession(null); setQuestion(null); setEvaluation(null); setReport(null); setAnswer(''); setError(''); setNextPending(false); onProgressChanged?.() }
  return <main className="project-interview-page">
    <header className="project-interview-header"><button onClick={session ? backToProjects : onBack}><ArrowLeft size={16}/>{session ? 'Projects' : 'Dashboard'}</button><div className="project-interview-brand">CODEBUZZ <span>PROJECT INTERVIEW</span></div><span className="interview-private"><BriefcaseBusiness size={14}/> Portfolio grounded</span></header>
    <div className="project-interview-content">
      {!session && <>
        <section className="project-interview-intro"><div><span className="project-interview-kicker">PIPELINE 03 · ADAPTIVE TECHNICAL INTERVIEW</span><h1>Walk us through what you built.</h1><p>Choose a project from your portfolio. Each question will follow what you explain and explore how the project works.</p></div><Sparkles size={28}/></section>
        {error && <div className="interview-error"><CircleAlert size={16}/>{error}</div>}
        {!projects.length ? <div className="interview-empty"><BriefcaseBusiness size={26}/><b>No portfolio projects found</b><p>Add projects to your portfolio profile before starting this interview.</p></div> : <div className="interview-project-grid">{projects.map(project => <article key={project.project_index} className="interview-project-card"><span className="project-interview-kicker">{project.domain || 'PORTFOLIO PROJECT'}</span><h2>{project.name}</h2><p>{project.description || 'No project description was extracted.'}</p>{project.technologies?.length > 0 && <div className="interview-tags">{project.technologies.map(item => <span key={item}>{item}</span>)}</div>}{project.features?.length > 0 && <div className="interview-project-meta"><b>Features listed</b><span>{project.features.slice(0, 4).join(' · ')}{project.features.length > 4 ? ' · …' : ''}</span></div>}{project.claimed_contributions?.length > 0 && <div className="interview-project-meta"><b>Contributions claimed</b><span>{project.claimed_contributions.slice(0, 3).join(' · ')}</span></div>}<button onClick={() => start(project.project_index)} disabled={busy}>Start interview <ArrowRight size={15}/></button></article>)}</div>}
        {sessions.length > 0 && <section className="interview-history"><div><span className="project-interview-kicker">YOUR HISTORY</span><h2>Previous interviews</h2></div>{sessions.map(item => <article key={item.id}><div><b>{item.project_name}</b><small>{new Date(item.started_at).toLocaleString()} · {titleCase(item.status)}{item.final_score != null ? ` · ${item.final_score}%` : ''}</small></div><button onClick={() => openSession(item.id)} disabled={busy}>{item.status === 'completed' ? 'View report' : 'Resume'} <ArrowRight size={14}/></button></article>)}</section>}
      </>}
      {session && !report && <>
        <section className="interview-session-top"><div><span className="project-interview-kicker">SELECTED PROJECT</span><h1>{session.project_name}</h1></div><div className="interview-progress"><span>QUESTION {Math.min(session.question_number || 1, questionCount)} OF {questionCount}</span><div><i style={{ width: `${Math.min(100, (((session.question_number || 1) - 1) / questionCount) * 100)}%` }}/></div></div></section>
        <div className="interview-workspace">
          <section className="interview-question-panel">
            {question ? <><div className="interview-question-meta"><span className={`interview-difficulty ${question.difficulty}`}>{titleCase(question.difficulty)}</span><span>{question.topic}</span><span>{question.question_type}</span></div><span className="project-interview-kicker">QUESTION {question.question_number}</span><h2>{question.question}</h2><p>Your answer should describe what you actually implemented. If a detail was not part of your project, say so.</p><div className="interview-context-note"><Sparkles size={15}/><span>Follow-up questions adapt to your previous answer and the selected project.</span></div></> : <div className="interview-waiting"><LoaderCircle className="interview-spinner" size={24}/><b>{busy ? 'Preparing the next question…' : nextPending ? 'Your next question is ready to load.' : 'Waiting for your next question.'}</b></div>}
          </section>
          <section className="interview-answer-panel"><div className="answer-panel-heading"><span className="project-interview-kicker">YOUR IMPLEMENTATION</span><Clock3 size={16}/></div><form onSubmit={submitAnswer}><label htmlFor="project-answer">Explain your approach and the decisions you made</label><textarea id="project-answer" value={answer} onChange={event => setAnswer(event.target.value)} maxLength={10000} placeholder="Describe the flow, key logic, and why you implemented it this way…" disabled={!question || busy} required/><div className="answer-form-foot"><small>{answer.length}/10,000 characters</small><button type="submit" disabled={!question || !answer.trim() || busy}>{busy ? <><LoaderCircle className="interview-spinner" size={15}/> Evaluating…</> : <>Submit answer <ArrowRight size={15}/></>}</button></div></form>{error && <div className="interview-error"><CircleAlert size={15}/>{error}</div>}
            {nextPending && <button className="interview-retry-next" onClick={() => continueSession()} disabled={busy}><RotateCw size={14}/> Retry loading next question</button>}
            {evaluation && <div className="interview-feedback"><div className="interview-feedback-score"><span>ANSWER SCORE</span><b>{evaluation.score}%</b></div><p>{evaluation.feedback}</p>{evaluation.strengths?.length > 0 && <div><b><Check size={13}/> Strengths</b>{evaluation.strengths.map((item, i) => <small key={i}>{item}</small>)}</div>}{evaluation.weaknesses?.length > 0 && <div><b>To explore further</b>{evaluation.weaknesses.map((item, i) => <small key={i}>{item}</small>)}</div>}</div>}
          </section>
        </div>
      </>}
      {report && <ProjectReport report={report} onBack={backToProjects}/>}
    </div>
  </main>
}

function ProjectReport({ report, onBack }) {
  return <section className="project-report"><div className="report-heading"><span className="project-interview-kicker">INTERVIEW COMPLETE · {report.project_name}</span><h1>Your project, explained.</h1><p>{report.summary}</p></div><div className="report-score"><span>OVERALL SCORE</span><b>{report.overall_score}%</b><small>{report.question_count} adaptive questions · score is the average of question scores</small></div><div className="report-topic-grid"><article><h2>Stronger areas</h2>{report.strengths?.length ? report.strengths.map((item, i) => <p key={i}><Check size={14}/>{item}</p>) : <small>No strengths were recorded.</small>}</article><article><h2>Areas to strengthen</h2>{report.weaknesses?.length ? report.weaknesses.map((item, i) => <p key={i}>{item}</p>) : <small>No weaknesses were recorded.</small>}</article><article><h2>Topic performance</h2>{Object.entries(report.topic_performance || {}).map(([topic, data]) => <p key={topic}><span>{topic}</span><b>{data.average_score}%</b></p>)}{!Object.keys(report.topic_performance || {}).length && <small>No topic scores recorded.</small>}</article></div><section className="report-questions"><span className="project-interview-kicker">QUESTION BY QUESTION</span>{report.question_results.map(row => <article key={row.question_number}><div className="report-question-head"><span>QUESTION {row.question_number} · {row.topic}</span><b>{row.score}%</b></div><h3>{row.question}</h3><p className="report-answer"><b>Your answer</b>{row.answer}</p><p>{row.feedback}</p><div className="report-dimensions"><span>Correctness {row.correctness}%</span><span>Depth {row.technical_depth}%</span><span>Relevance {row.relevance}%</span><span>{titleCase(row.difficulty)}</span></div></article>)}</section><section className="report-progression"><span className="project-interview-kicker">ADAPTIVE DIFFICULTY</span>{report.difficulty_progression.map(item => <p key={item.after_question}>After question {item.after_question}: {titleCase(item.previous_difficulty)} → {titleCase(item.next_difficulty)} ({item.score}%) · {item.reason}</p>)}</section><button className="interview-return-button" onClick={onBack}>Back to projects <ArrowLeft size={15}/></button></section>
}
