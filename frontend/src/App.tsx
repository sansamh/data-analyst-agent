import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  deleteAnalysis, fileUrl, getAnalysis, listAnalyses, runAnalysis, uploadDataset,
} from './api'
import type { AnalysisDetail, AnalysisSummary, DatasetInfo } from './api'

const EXAMPLE_QUESTIONS = [
  '哪个区域销售表现最好？各产品退货情况如何？',
  '分析月度销售趋势并预测下个季度',
  '找出收入和退货率的异常点',
]

export default function App() {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [dataset, setDataset] = useState<DatasetInfo | null>(null)
  const [uploading, setUploading] = useState(false)
  const [question, setQuestion] = useState('')
  const [thinking, setThinking] = useState('')
  const [tools, setTools] = useState<string[]>([])
  const [report, setReport] = useState('')
  const [, setCharts] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [history, setHistory] = useState<AnalysisSummary[]>([])
  const [viewing, setViewing] = useState<AnalysisDetail | null>(null)
  const thinkRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listAnalyses().then(setHistory).catch(() => {})
  }, [phase])

  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      const info = await uploadDataset(file)
      setDataset(info)
      setReport('')
      setCharts([])
      setError(null)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      setError(msg || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const start = async (q: string) => {
    if (!dataset || !q.trim() || phase === 'running') return
    setPhase('running')
    setError(null)
    setThinking('')
    setTools([])
    setReport('')
    setCharts([])
    setCurrentId(dataset.id)

    await runAnalysis(dataset.id, q.trim(), {
      onStreamToken: (token) => {
        setThinking((prev) => {
          const next = prev + token
          thinkRef.current?.scrollTo({ top: thinkRef.current.scrollHeight })
          return next
        })
      },
      onTool: (tool, input) => setTools((prev) => [...prev, `${tool}: ${input}`]),
      onReport: (md, ch) => {
        setReport(md)
        setCharts(ch)
        setThinking('')
        setTools([])
      },
      onDone: () => setPhase('done'),
      onError: (message) => {
        setError(message)
        setPhase('error')
      },
    })
  }

  const openAnalysis = async (id: string) => {
    const a = await getAnalysis(id)
    setViewing(a)
  }

  const renderReport = (md: string, id: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        img: ({ src, alt }) =>
          typeof src === 'string' && !src.startsWith('http') ? (
            <figure className="my-4">
              <img src={fileUrl(id, src)} alt={alt} className="rounded-lg border border-stone-200 max-w-full" />
              {alt && <figcaption className="text-xs text-stone-400 text-center mt-1">{alt}</figcaption>}
            </figure>
          ) : (
            <img src={typeof src === 'string' ? src : ''} alt={alt} />
          ),
      }}
    >
      {md}
    </ReactMarkdown>
  )

  return (
    <div className="min-h-full">
      <header className="border-b border-stone-200 bg-white/70 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center text-sm font-bold text-white">S</div>
          <span className="font-semibold">DataSage</span>
          <span className="text-xs text-stone-400 hidden sm:inline">deep agent data analyst</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm">
          <h1 className="text-xl font-semibold mb-1">Upload a dataset, ask a question</h1>
          <p className="text-sm text-stone-500 mb-4">
            A deep agent plans the analysis, writes and executes Python, and delivers a cited report with charts.
          </p>

          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]) }}
            className="block border-2 border-dashed border-stone-300 hover:border-emerald-400 rounded-xl p-6 text-center cursor-pointer transition-colors"
          >
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
            />
            {uploading ? (
              <p className="text-sm text-stone-400 animate-pulse">Uploading…</p>
            ) : dataset ? (
              <div className="text-left">
                <p className="text-sm font-medium">
                  📄 {dataset.name}{' '}
                  <span className="text-stone-400">
                    ({dataset.shape[0]} rows × {dataset.shape[1]} columns)
                  </span>
                </p>
                <div className="mt-2 overflow-x-auto text-xs report">{renderReport(dataset.preview_md, 'preview')}</div>
              </div>
            ) : (
              <p className="text-sm text-stone-400">Drop a CSV / Excel file here, or click to choose</p>
            )}
          </label>

          <form
            onSubmit={(e) => { e.preventDefault(); start(question) }}
            className="flex flex-col sm:flex-row gap-3 mt-4"
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. 哪个区域销售表现最好？"
              disabled={!dataset || phase === 'running'}
              className="flex-1 border border-stone-300 rounded-xl px-4 py-2.5 text-sm placeholder:text-stone-400 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!dataset || phase === 'running' || !question.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl px-6 py-2.5 text-sm font-medium transition-colors"
            >
              {phase === 'running' ? 'Analyzing…' : 'Analyze'}
            </button>
          </form>

          <div className="flex flex-wrap gap-2 mt-3">
            {EXAMPLE_QUESTIONS.map((ex) => (
              <button
                key={ex}
                onClick={() => { setQuestion(ex); start(ex) }}
                disabled={!dataset || phase === 'running'}
                className="text-xs bg-stone-100 hover:bg-stone-200 rounded-full px-3 py-1 text-stone-600 transition-colors disabled:opacity-40"
              >
                {ex}
              </button>
            ))}
          </div>

          {error && (
            <div className="mt-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm fade-up">
              {error}
            </div>
          )}
        </div>

        {/* live agent trace */}
        {phase === 'running' && !viewing && (
          <div className="mt-6 bg-white border border-stone-200 rounded-xl p-5 fade-up">
            <p className="text-xs font-semibold text-stone-400 uppercase mb-2">
              Agent working… {tools.length > 0 && `· ${tools.length} tool calls`}
            </p>
            <div className="space-y-1 mb-3">
              {tools.slice(-6).map((t, i) => (
                <p key={i} className="text-xs text-emerald-700 bg-emerald-50 rounded px-2 py-1 font-mono truncate">
                  🐍 {t}
                </p>
              ))}
            </div>
            <div ref={thinkRef} className="max-h-48 overflow-y-auto text-xs text-stone-500 font-mono whitespace-pre-wrap">
              {thinking || 'Planning…'}
            </div>
          </div>
        )}

        {/* report */}
        {(report && currentId && !viewing) && (
          <div className="mt-6 bg-white border border-stone-200 rounded-xl p-6 shadow-sm report text-sm fade-up">
            {renderReport(report, currentId)}
          </div>
        )}

        {/* past analysis view */}
        {viewing && (
          <div className="mt-6 space-y-4 fade-up">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{viewing.question}</h2>
              <button onClick={() => setViewing(null)} className="text-sm text-stone-400 hover:text-stone-700">
                ← back
              </button>
            </div>
            <div className="bg-white border border-stone-200 rounded-xl p-6 report text-sm">
              {viewing.report_md ? renderReport(viewing.report_md, viewing.id) : <p className="text-stone-400">{viewing.status}</p>}
            </div>
          </div>
        )}

        {/* history */}
        {history.length > 0 && !viewing && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-2">Past analyses</h2>
            <div className="space-y-2">
              {history.map((h) => (
                <div key={h.id} className="bg-white border border-stone-200 rounded-xl px-4 py-3 flex items-center gap-3">
                  <button onClick={() => openAnalysis(h.id)} className="flex-1 text-left min-w-0">
                    <p className="text-sm font-medium truncate hover:text-emerald-700">{h.question}</p>
                    <p className="text-xs text-stone-400 truncate">
                      {h.dataset_name} · {h.status} · {h.created_at}
                    </p>
                  </button>
                  <button
                    onClick={async () => { await deleteAnalysis(h.id); setHistory((p) => p.filter((x) => x.id !== h.id)) }}
                    className="text-xs text-stone-400 hover:text-rose-500"
                  >
                    delete
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
