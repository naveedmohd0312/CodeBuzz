import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CircleAlert, Clock3, LoaderCircle, RotateCcw, ShieldCheck, Trophy } from 'lucide-react'
import './mcq.css'

async function mcqApi(path, options = {}, csrf = '') {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  if (options.method && options.method !== 'GET') headers['X-CSRF-Token'] = csrf
  const response = await fetch(path, { credentials: 'include', ...options, headers })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || data.message || 'The assessment request failed.')
  return data
}

const labels = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

export default function MCQWorkspace({ csrf, onBack, onProgressChanged }) {
  const [overview, setOverview] = useState(null)
  const [topics, setTopics] = useState([])
  const [difficulty, setDifficulty] = useState('easy')
  const [selectedTopics, setSelectedTopics] = useState([])
  const [assessment, setAssessment] = useState(null)
  const [review, setReview] = useState(null)
  const [view, setView] = useState('overview')
  const [questionIndex, setQuestionIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [savingAnswer, setSavingAnswer] = useState(false)
  const [error, setError] = useState('')

  const refresh = async () => {
    const [overviewData, skillsData] = await Promise.all([
      mcqApi('/api/mcq/overview'), mcqApi('/api/mcq/skills'),
    ])
    setOverview(overviewData)
    setTopics(skillsData.topics || [])
    setSelectedTopics(current => current.length ? current.filter(topic => skillsData.topics.includes(topic)) : (skillsData.topics || []).slice(0, 12))
  }
  useEffect(() => { refresh().catch(e => setError(e.message)) }, [])

  const startAssessment = async (track = difficulty) => {
    setBusy(true); setError('')
    try {
      const data = await mcqApi('/api/mcq/start', { method: 'POST', body: JSON.stringify({ difficulty: track, topics: selectedTopics }) }, csrf)
      setAssessment(data.assessment); setQuestionIndex(0); setView('assessment')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const continueAssessment = async id => {
    setBusy(true); setError('')
    try {
      const data = await mcqApi(`/api/mcq/assessment/${id}`)
      setAssessment(data.assessment); setQuestionIndex(0); setView('assessment')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const saveAnswer = async (question, selected_answer) => {
    if (savingAnswer || !assessment) return
    setSavingAnswer(true); setError('')
    try {
      await mcqApi(`/api/mcq/assessment/${assessment.id}/answer`, {
        method: 'POST', body: JSON.stringify({ question_id: question.id, selected_answer }),
      }, csrf)
      setAssessment(current => ({ ...current, questions: current.questions.map(q => q.id === question.id ? { ...q, selected_answer } : q) }))
    } catch (e) { setError(e.message) } finally { setSavingAnswer(false) }
  }

  const submit = async () => {
    if (!assessment || busy || savingAnswer) return
    setBusy(true); setError('')
    try {
      const data = await mcqApi(`/api/mcq/assessment/${assessment.id}/submit`, { method: 'POST', body: JSON.stringify({}) }, csrf)
      setReview(data); setView('result'); await refresh().catch(() => {}); onProgressChanged?.()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const openReview = async assessmentId => {
    setBusy(true); setError('')
    try { const data = await mcqApi(`/api/mcq/review/${assessmentId}`); setReview(data); setView('result') }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const question = assessment?.questions?.[questionIndex]
  const answeredCount = assessment?.questions?.filter(q => q.selected_answer !== null && q.selected_answer !== undefined).length || 0
  const tracks = overview?.progress || {}

  if (view === 'assessment' && assessment) return <main className="mcq-page">
    <header className="mcq-header"><button className="mcq-back" onClick={() => { setView('overview'); refresh().catch(() => {}) }}><ArrowLeft size={16}/> Exit assessment</button><div className="mcq-brand">CODEBUZZ <span>ASSESSMENT</span></div><div className="mcq-secure"><ShieldCheck size={14}/> ANSWERS SAVED</div></header>
    <div className="mcq-assess-layout"><aside className="mcq-question-nav"><span className="mcq-kicker">{labels[assessment.difficulty].toUpperCase()} · LEVEL {assessment.level}</span><h2>Question map</h2><p>{answeredCount} of {assessment.total_questions} answered</p><div className="mcq-question-grid">{assessment.questions.map((q, i) => <button key={q.id} className={`${i === questionIndex ? 'current ' : ''}${q.selected_answer !== null && q.selected_answer !== undefined ? 'answered' : ''}`} onClick={() => setQuestionIndex(i)}>{i + 1}</button>)}</div><div className="mcq-legend"><span><i className="legend-current"/>Current</span><span><i className="legend-answered"/>Answered</span><span><i/>Unanswered</span></div><div className="mcq-saved-note"><Check size={14}/> Your answers save automatically.</div></aside>
      <section className="mcq-question-panel"><div className="mcq-question-meta"><span>QUESTION {String(questionIndex + 1).padStart(2, '0')} <i>/ {String(assessment.total_questions).padStart(2, '0')}</i></span><span className="mcq-topic">{question.topic}</span></div><div className="mcq-progress-track"><i style={{ width: `${((questionIndex + 1) / assessment.total_questions) * 100}%` }}/></div><h1>{question.question}</h1><p className="mcq-prompt">Choose one answer.</p><div className="mcq-options">{question.options.map((option, i) => <button key={i} disabled={savingAnswer} className={`mcq-option ${question.selected_answer === i ? 'selected' : ''}`} onClick={() => saveAnswer(question, i)}><span className="mcq-option-letter">{String.fromCharCode(65 + i)}</span><span>{option}</span>{question.selected_answer === i && <Check size={17}/>}</button>)}</div><div className="mcq-question-actions"><button className="mcq-secondary" disabled={questionIndex === 0 || busy} onClick={() => setQuestionIndex(i => i - 1)}><ArrowLeft size={15}/> Previous</button>{questionIndex < assessment.questions.length - 1 ? <button className="mcq-primary" disabled={busy} onClick={() => setQuestionIndex(i => i + 1)}>Next question <ArrowRight size={15}/></button> : <button className="mcq-submit" disabled={busy} onClick={submit}>{busy ? <LoaderCircle className="mcq-spin" size={15}/> : <Check size={15}/>} Submit assessment</button>}</div><div className="mcq-submit-hint">{assessment.total_questions - answeredCount ? `${assessment.total_questions - answeredCount} unanswered` : 'All questions answered'} · You may review your answers before submitting.</div><div className="mcq-error">{error}</div></section></div>
  </main>

  if (view === 'result' && review) {
    const result = review.result
    const passed = result.passed
    return <main className="mcq-page"><header className="mcq-header"><button className="mcq-back" onClick={() => { setView('overview'); refresh().catch(() => {}) }}><ArrowLeft size={16}/> Assessment overview</button><div className="mcq-brand">CODEBUZZ <span>RESULT REVIEW</span></div><div/></header><div className="mcq-result-wrap"><section className={`mcq-result-hero ${passed ? 'passed' : 'failed'}`}><div className="result-icon">{passed ? <Trophy/> : <CircleAlert/>}</div><div><span className="mcq-kicker">{labels[result.difficulty].toUpperCase()} · LEVEL {result.level} · ATTEMPT {result.attempt_number}</span><h1>{passed ? 'Level passed' : 'Keep building your signal'}</h1><p>{passed ? `You scored ${result.score_percentage}%. The next ${labels[result.difficulty]} level is unlocked.` : `You scored ${result.score_percentage}%. Review the answers and retry ${labels[result.difficulty]} Level ${result.level}.`}</p></div><div className="mcq-score-circle"><b>{result.score_percentage}%</b><small>SCORE</small></div></section><div className="mcq-result-stats"><ResultStat label="Correct" value={result.correct_answers} tone="good"/><ResultStat label="Incorrect" value={result.incorrect_answers} tone="bad"/><ResultStat label="Unanswered" value={result.unanswered_questions}/><ResultStat label="Total" value={result.total_questions}/></div><div className="mcq-result-actions"><button className="mcq-secondary" onClick={() => { setView('overview'); refresh().catch(() => {}) }}>Back to progress</button>{!passed && <button className="mcq-primary" disabled={busy} onClick={() => startAssessment(result.difficulty)}><RotateCcw size={15}/> Retry same level</button>}{passed && <button className="mcq-primary" disabled={busy} onClick={() => startAssessment(result.difficulty)}>Start Level {result.level + 1} <ArrowRight size={15}/></button>}</div><div className="mcq-review-heading"><span className="mcq-kicker">ANSWER REVIEW</span><h2>Review every question</h2><p>Use the topic tags to focus your next practice round.</p></div><div className="mcq-review-list">{review.questions.map(item => <article className={`mcq-review-card ${item.is_correct ? 'correct' : 'incorrect'}`} key={item.id}><div className="review-title"><span className={`review-mark ${item.is_correct ? 'correct' : 'incorrect'}`}>{item.is_correct ? <Check size={15}/> : <CircleAlert size={15}/>}</span><div><span className="mcq-topic">{item.topic}</span><h3>{item.question}</h3></div></div><div className="review-options">{item.options.map((option, i) => <div key={i} className={`review-option ${i === item.correct_answer ? 'correct-answer' : ''} ${i === item.selected_answer && !item.is_correct ? 'wrong-answer' : ''}`}><span>{String.fromCharCode(65 + i)}</span>{option}{i === item.correct_answer && <b>Correct answer</b>}{i === item.selected_answer && <small>Your answer</small>}</div>)}</div><div className="review-explanation"><b>Why</b><p>{item.explanation}</p></div></article>)}</div></div></main>
  }

  return <main className="mcq-page"><header className="mcq-header"><button className="mcq-back" onClick={onBack}><ArrowLeft size={16}/> Dashboard</button><div className="mcq-brand">CODEBUZZ <span>MCQ ASSESSMENT</span></div><div/></header><div className="mcq-overview-wrap"><section className="mcq-overview-intro"><div><span className="mcq-kicker">PORTFOLIO-BASED KNOWLEDGE CHECK</span><h1>Show what you know.</h1><p>Choose a track and practice from topics in your stored portfolio. Each track advances independently.</p></div><span className="mcq-pass-badge"><ShieldCheck size={15}/> 70% TO PASS</span></section><div className="mcq-track-cards">{['easy', 'medium', 'hard'].map(track => <TrackCard key={track} difficulty={track} progress={tracks[track]} active={difficulty === track} onChoose={() => setDifficulty(track)} onContinue={continueAssessment} />)}</div><section className="mcq-config-card"><div className="mcq-config-heading"><div><span className="mcq-kicker">YOUR PORTFOLIO TOPICS</span><h2>Choose what to practice</h2><p>Questions are restricted to the skills and topics on your profile.</p></div><span>{selectedTopics.length} selected</span></div><div className="mcq-domain-row">Portfolio domain <b>{overview?.portfolio?.domain || 'Not specified'}</b></div>{topics.length ? <div className="mcq-topic-picker">{topics.map(topic => <label key={topic} className={selectedTopics.includes(topic) ? 'checked' : ''}><input type="checkbox" checked={selectedTopics.includes(topic)} onChange={e => setSelectedTopics(current => e.target.checked ? [...current, topic] : current.filter(t => t !== topic))}/><span>{topic}</span></label>)}</div> : <div className="mcq-no-topics">No portfolio skills are stored yet. Add skills, technologies, programming languages, or DSA topics to your profile first.</div>}<button className="mcq-primary mcq-start-button" disabled={busy || !selectedTopics.length || !overview} onClick={() => startAssessment()}>{busy ? <><LoaderCircle className="mcq-spin" size={15}/> Preparing your questions…</> : <>Start {labels[difficulty]} Level {tracks[difficulty]?.highest_unlocked_level || 1} <ArrowRight size={16}/></>}</button><div className="mcq-error">{error}</div></section><section className="mcq-history-section"><div className="mcq-review-heading"><span className="mcq-kicker">YOUR ATTEMPTS</span><h2>Assessment history</h2></div>{overview?.history?.length ? <div className="mcq-history-list">{overview.history.map(item => <button key={item.id} onClick={() => openReview(item.assessment_id)}><span className={`history-score ${item.passed ? 'passed' : 'failed'}`}>{item.score_percentage}%</span><span><b>{labels[item.difficulty]} · Level {item.level}</b><small>Attempt {item.attempt_number} · {new Date(item.completed_at).toLocaleString()}</small></span><span className={item.passed ? 'history-pass' : 'history-fail'}>{item.passed ? 'PASSED' : 'RETRY'} <ArrowRight size={14}/></span></button>)}</div> : <div className="mcq-empty-history"><Clock3 size={17}/> Your completed attempts will appear here.</div>}</section></div></main>
}

function TrackCard({ difficulty, progress = {}, active, onChoose, onContinue }) {
  const unlocked = progress.highest_unlocked_level || 1
  return <article className={`mcq-track-card ${difficulty} ${active ? 'active' : ''}`}><button className="track-select" onClick={onChoose}><span className="mcq-kicker">{labels[difficulty].toUpperCase()} TRACK</span><b>Level {unlocked} available</b><small>{(progress.completed_levels || []).length} levels completed</small><span className="track-latest">{progress.latest_score == null ? 'No attempt yet' : `Latest ${progress.latest_score}% · Best ${progress.best_score}%`}</span></button>{progress.active_assessment_id && <button className="track-continue" onClick={() => onContinue(progress.active_assessment_id)}>Continue open assessment <ArrowRight size={13}/></button>}</article>
}
function ResultStat({ label, value, tone }) { return <div className={`mcq-result-stat ${tone || ''}`}><b>{value}</b><small>{label}</small></div> }
