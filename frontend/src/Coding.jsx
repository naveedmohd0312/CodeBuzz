import { useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { ArrowLeft, ArrowRight, Check, CircleAlert, Clock3, Code2, Expand, Eye, FileCode2, Lightbulb, LoaderCircle, Play, RotateCcw, Send, ShieldCheck } from 'lucide-react'
import './coding.css'

async function api(path, options = {}, csrf = '') {
  const response = await fetch(path, { credentials: 'include', ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}),
      ...(options.method && options.method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}) } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || data.message || 'The coding request failed.')
  return data
}
const tracks = ['easy', 'medium', 'hard']
const title = value => value ? value[0].toUpperCase() + value.slice(1) : ''
const draftKey = (question, language) => `codebuzz:draft:${question}:${language}`

export default function CodingWorkspace({ csrf, onBack, onProgressChanged }) {
  const [overview, setOverview] = useState(null)
  const [difficulty, setDifficulty] = useState('easy')
  const [topic, setTopic] = useState('')
  const [language, setLanguage] = useState('')
  const [question, setQuestion] = useState(null)
  const [code, setCode] = useState('')
  const [result, setResult] = useState(null)
  const [customInput, setCustomInput] = useState('')
  const [hint, setHint] = useState(null)
  const [hintLevel, setHintLevel] = useState(1)
  const [history, setHistory] = useState([])
  const [view, setView] = useState('overview')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [runnerEnabled, setRunnerEnabled] = useState(false)
  const [draftSaveStatus, setDraftSaveStatus] = useState('')
  const draftVersions = useRef({})
  const draftSequence = useRef(0)

  const refresh = async () => {
    const [summary, attempts] = await Promise.all([api('/api/coding/overview'), api('/api/coding/history')])
    setOverview(summary); setHistory(attempts.history || []); setRunnerEnabled(Boolean(summary.runner_configured))
    if (!topic && summary.portfolio?.topics?.length) setTopic(summary.portfolio.topics[0])
    if (!language && summary.languages?.length) setLanguage(summary.languages[0].id)
  }
  useEffect(() => { refresh().catch(e => setError(e.message)) }, [])
  const progress = overview?.progress?.[difficulty]?.find(row => row.topic === topic)
  const languages = overview?.languages || []
  const availableTopic = useMemo(() => new Set(overview?.portfolio?.topics || []), [overview])

  const saveDraft = async (questionId = question?.id, selectedLanguage = language, source = code) => {
    if (!questionId || !selectedLanguage || typeof source !== 'string') return
    const key = draftKey(questionId, selectedLanguage)
    const revision = (draftVersions.current[key] || 0) + 1
    draftVersions.current[key] = revision
    const sequence = ++draftSequence.current
    localStorage.setItem(key, source)
    try {
      const data = await api(`/api/coding/question/${questionId}/draft`, { method: 'PUT',
        body: JSON.stringify({ source_code: source, language: selectedLanguage, revision }) }, csrf)
      draftVersions.current[key] = Math.max(draftVersions.current[key] || 0, data.revision || revision)
      if (sequence === draftSequence.current) setDraftSaveStatus('All changes saved')
    } catch (e) {
      if (sequence === draftSequence.current) setDraftSaveStatus(`Local copy kept · ${e.message}`)
    }
  }

  useEffect(() => {
    if (view !== 'question' || !question || !language) return undefined
    setDraftSaveStatus('Saving…')
    const timer = window.setTimeout(() => { saveDraft().catch(() => {}) }, 650)
    return () => window.clearTimeout(timer)
  }, [code, language, question?.id, view])

  const openQuestion = async (id, chosenLanguage = language) => {
    setBusy(true); setError(''); setResult(null); setHint(null)
    try {
      const data = id ? await api(`/api/coding/question/${id}`) : await api('/api/coding/start', {
        method: 'POST', body: JSON.stringify({ difficulty, topic, language: chosenLanguage }),
      }, csrf)
      const item = data.question
      const lang = item.supported_languages.some(l => l.id === chosenLanguage) ? chosenLanguage : item.supported_languages[0]?.id
      if (!lang) throw new Error('This question has no programming language enabled.')
      const draft = await api(`/api/coding/question/${item.id}/draft?language=${encodeURIComponent(lang)}`)
      const key = draftKey(item.id, lang)
      draftVersions.current[key] = draft.revision || 0
      setQuestion(item); setLanguage(lang)
      setCode(draft.draft ?? localStorage.getItem(key) ?? item.starter_code[lang] ?? '')
      setDraftSaveStatus(draft.draft != null ? 'Draft restored' : 'Draft not saved yet')
      setHintLevel(1); setView('question')
      refresh().catch(() => {})
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const changeLanguage = async next => {
    if (!question) { setLanguage(next); return }
    await saveDraft(question.id, language, code)
    try {
      const draft = await api(`/api/coding/question/${question.id}/draft?language=${encodeURIComponent(next)}`)
      draftVersions.current[draftKey(question.id, next)] = draft.revision || 0
      setCode(draft.draft ?? localStorage.getItem(draftKey(question.id, next)) ?? question.starter_code[next] ?? '')
      setLanguage(next); setResult(null)
    } catch (e) { setError(e.message) }
  }
  const updateCode = value => {
    const next = value ?? ''
    setCode(next)
    if (question && language) localStorage.setItem(draftKey(question.id, language), next)
  }
  const runCode = async () => {
    if (!question || busy) return
    setBusy(true); setError(''); setResult(null)
    try {
      await saveDraft(question.id, language, code)
      const body = { source_code: code, language }
      if (customInput.trim()) body.custom_input = customInput
      const data = await api(`/api/coding/question/${question.id}/run`, { method: 'POST', body: JSON.stringify(body) }, csrf)
      setResult({ ...data, kind: 'run' })
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const submitCode = async () => {
    if (!question || busy) return
    setBusy(true); setError(''); setResult(null)
    try {
      await saveDraft(question.id, language, code)
      const data = await api(`/api/coding/question/${question.id}/submit`, { method: 'POST',
        body: JSON.stringify({ source_code: code, language, idempotency_key: crypto.randomUUID() }) }, csrf)
      setResult({ ...data, kind: 'submit' }); await refresh(); onProgressChanged?.()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const requestHint = async () => {
    if (!question || busy || hintLevel > 4) return
    setBusy(true); setError('')
    try {
      const data = await api(`/api/coding/question/${question.id}/hint`, { method: 'POST',
        body: JSON.stringify({ language, code, hint_level: hintLevel }) }, csrf)
      setHint(data.hint); setHintLevel(data.hint_level + 1)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  if (view === 'question' && question) {
    const selectedLang = languages.find(item => item.id === language)
    return <main className="coding-page"><header className="coding-header"><button onClick={async () => { await saveDraft(); setView('overview'); refresh().catch(() => {}) }}><ArrowLeft size={15}/> Coding assessment</button><div className="coding-brand">CODEBUZZ <span>CODE WORKSPACE</span></div><div className="coding-trust"><span className="coding-draft-status">{draftSaveStatus}</span><ShieldCheck size={14}/> ISOLATED RUNNER</div></header>
      <div className="coding-workspace"><section className="coding-problem-panel"><div className="coding-problem-top"><span className={`coding-difficulty ${question.difficulty}`}>{title(question.difficulty)}</span><span className="coding-topic">{question.topic}</span><span className="coding-level">LEVEL {question.level}</span></div><h1>{question.title}</h1><div className="coding-statement">{question.problem_statement.split('\n').map((line, i) => <p key={i}>{line || '\u00a0'}</p>)}</div>{question.problem_description && <section><h2>Description</h2><p>{question.problem_description}</p></section>}<section><h2>Input format</h2><p>{question.input_format}</p></section><section><h2>Output format</h2><p>{question.output_format}</p></section><section><h2>Constraints</h2><ul>{question.constraints.map((item, i) => <li key={i}>{item}</li>)}</ul></section><section><h2>Examples</h2>{question.examples.map((example, i) => <article className="coding-example" key={i}><b>Example {i + 1}</b><div><small>Input</small><pre>{example.input || '(empty)'}</pre></div><div><small>Output</small><pre>{example.output || '(empty)'}</pre></div><p>{example.explanation}</p></article>)}</section>{hint && <aside className="coding-hint"><Lightbulb size={16}/><div><b>Hint {hintLevel - 1}</b><p>{hint}</p></div></aside>}<button className="coding-hint-button" disabled={busy || hintLevel > 4} onClick={requestHint}><Lightbulb size={15}/>{hintLevel > 4 ? 'All hints used' : `Request hint ${hintLevel} of 4`}</button></section>
        <section className="coding-editor-panel"><div className="coding-editor-toolbar"><div className="coding-language-control"><FileCode2 size={15}/><select value={language} onChange={e => changeLanguage(e.target.value)}>{question.supported_languages.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div><div className="coding-editor-actions"><button title="Reset starter code" onClick={() => { if (confirm('Reset your code to the starter template?')) updateCode(question.starter_code[language] || '') }}><RotateCcw size={14}/> Reset</button><button title="Fullscreen" onClick={() => document.querySelector('.coding-editor-box')?.requestFullscreen?.()}><Expand size={14}/></button></div></div><div className="coding-editor-box"><Editor height="100%" theme="vs-dark" language={selectedLang?.monaco || language} value={code} onChange={updateCode} options={{ minimap: { enabled: false }, fontSize: 14, lineNumbers: 'on', automaticLayout: true, tabSize: 4, wordWrap: 'on', scrollBeyondLastLine: false, formatOnPaste: true, formatOnType: true, suggestOnTriggerCharacters: true, quickSuggestions: true, readOnly: false, padding: { top: 14 } }} /></div><div className="coding-input-panel"><label>Custom input <small>optional · when provided, Run executes only this input</small><textarea value={customInput} onChange={e => setCustomInput(e.target.value)} placeholder="Paste custom stdin here…" maxLength={10000}/></label></div><div className="coding-run-actions"><span>{runnerEnabled ? <><ShieldCheck size={13}/> Code runs in an isolated Judge0 service</> : <><CircleAlert size={13}/> Execution service not configured</>}</span><div><button className="coding-run-button" onClick={runCode} disabled={busy || !runnerEnabled}>{busy ? <LoaderCircle className="coding-spin" size={15}/> : <Play size={15}/>} Run code</button><button className="coding-submit-button" onClick={submitCode} disabled={busy || !runnerEnabled}>{busy ? 'Working…' : <><Send size={14}/> Submit</>}</button></div></div><div className="coding-feedback">{error && <div className="coding-error"><CircleAlert size={15}/>{error}</div>}{result && <ExecutionResult result={result}/>}</div></section></div>
    </main>
  }

  return <main className="coding-page"><header className="coding-header"><button onClick={onBack}><ArrowLeft size={15}/> Dashboard</button><div className="coding-brand">CODEBUZZ <span>CODING ASSESSMENT</span></div><div/></header><div className="coding-overview"><section className="coding-overview-title"><div><span className="coding-kicker">PORTFOLIO-BASED CODING TRACK</span><h1>Build, run, prove.</h1><p>One coding challenge per level. Topic and difficulty progress independently.</p></div><span className="coding-pass-rule">SCORE MUST BE ABOVE {overview?.pass_threshold_exclusive ?? 70}% TO PASS</span></section>{!runnerEnabled && <div className="coding-config-warning"><CircleAlert size={17}/><span><b>Code runner not configured</b><small>Question generation and execution are disabled until the backend has a private Judge0 endpoint and language IDs.</small></span></div>}<div className="coding-selectors"><label>Difficulty<select value={difficulty} onChange={e => setDifficulty(e.target.value)}>{tracks.map(x => <option key={x} value={x}>{title(x)}</option>)}</select></label><label>Portfolio topic<select value={topic} onChange={e => setTopic(e.target.value)}>{(overview?.portfolio?.topics || []).map(item => <option key={item} value={item}>{item}</option>)}</select></label><label>Programming language<select value={language} onChange={e => setLanguage(e.target.value)}>{languages.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div><div className="coding-progress-card"><div className="coding-progress-head"><div><span className={`coding-difficulty ${difficulty}`}>{title(difficulty)}</span><span className="coding-topic">{topic || 'No topic selected'}</span></div><span className="coding-level">LEVEL {progress?.highest_unlocked_level || 1} AVAILABLE</span></div><div className="coding-progress-stats"><span><small>Completed levels</small><b>{progress?.completed_levels?.length || 0}</b></span><span><small>Latest score</small><b>{progress?.latest_score == null ? '—' : `${progress.latest_score}%`}</b></span><span><small>Best score</small><b>{progress?.best_score == null ? '—' : `${progress.best_score}%`}</b></span><span><small>Attempts</small><b>{progress?.attempts || 0}</b></span></div><button className="coding-start-button" disabled={busy || !topic || !language || !runnerEnabled || !availableTopic.has(topic)} onClick={() => openQuestion(progress?.active_question_id, language)}>{busy ? <LoaderCircle className="coding-spin" size={15}/> : <Code2 size={15}/>} {progress?.active_question_id ? 'Continue / reopen available level' : `Start ${title(difficulty)} Level ${progress?.highest_unlocked_level || 1}`} <ArrowRight size={15}/></button><div className="coding-error">{error}</div></div><section className="coding-level-grid"><h2>Independent difficulty tracks</h2><div>{tracks.map(track => { const row = overview?.progress?.[track]?.find(x => x.topic === topic); return <button key={track} className={`coding-level-card ${track} ${difficulty === track ? 'active' : ''}`} onClick={() => setDifficulty(track)}><span>{title(track)} · {topic || 'Choose topic'}</span><b>Level {row?.highest_unlocked_level || 1} available</b><small>{row?.completed_levels?.length || 0} completed · {row?.attempts || 0} attempts</small></button> })}</div></section><section className="coding-history"><div><span className="coding-kicker">YOUR ATTEMPTS</span><h2>Submission history</h2></div>{history.length ? history.map(row => <article key={row.id}><span className={`coding-history-score ${row.passed ? 'passed' : row.passed === false ? 'failed' : 'pending'}`}>{row.score_percentage == null ? 'ERR' : `${row.score_percentage}%`}</span><span><b>{row.title}</b><small>{title(row.difficulty)} · Level {row.level} · {row.programming_language} · Attempt {row.attempt_number}</small></span><span>{row.status}</span><button onClick={() => openQuestion(row.question_id, row.programming_language)}>Open question <ArrowRight size={13}/></button></article>) : <p className="coding-empty">Your coding submissions will be listed here.</p>}</section></div></main>
}

function ExecutionResult({ result }) {
  if (result.kind === 'run' && result.custom) return <section className="execution-result"><div className="execution-result-title"><b>Custom input result</b><span>{result.status}</span></div>{result.stdout && <pre>{result.stdout}</pre>}{(result.stderr || result.compile_output) && <pre className="execution-error-output">{result.compile_output || result.stderr}</pre>}<small>Runtime {result.time ?? '—'} s · Memory {result.memory ?? '—'} KB</small></section>
  const passed = result.passed_test_cases ?? result.passed
  const total = result.total_test_cases ?? result.total
  return <section className={`execution-result ${result.kind === 'submit' ? (result.passed ? 'passed' : 'failed') : ''}`}><div className="execution-result-title"><b>{result.kind === 'submit' ? (result.passed ? 'Solution accepted' : result.status || 'Submission result') : 'Public test results'}</b><span>{passed}/{total} passed · {result.score_percentage ?? result.score ?? 0}%</span></div><div className="execution-case-list">{(result.test_results || result.results || []).map(item => <article key={item.case}><span className={item.passed ? 'case-pass' : 'case-fail'}>{item.passed ? <Check size={13}/> : <CircleAlert size={13}/>}</span><b>Test {item.case}</b><span>{item.status}</span>{item.error && <pre>{item.error}</pre>}{item.input !== undefined && <details><summary>Output details</summary><small>Input</small><pre>{item.input || '(empty)'}</pre><small>Expected</small><pre>{item.expected_output || '(empty)'}</pre><small>Actual</small><pre>{item.actual_output || '(empty)'}</pre></details>}</article>)}</div>{result.kind === 'submit' && <div className="coding-submission-summary"><span>{result.passed ? 'Next level unlocked' : 'Retry this level'}</span><small>Attempt {result.attempt_number} · {result.execution_time_ms ?? '—'} ms · {result.memory_kb ?? '—'} KB</small></div>}{result.kind === 'run' && <small>Run Code uses public cases only and does not update progression.</small>}</section>
}
