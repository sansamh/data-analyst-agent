import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export interface DatasetInfo {
  id: string
  name: string
  shape: [number, number]
  columns: { name: string; dtype: string; missing: number }[]
  preview_md: string
}

export interface AnalysisSummary {
  id: string
  dataset_name: string
  question: string
  status: string
  created_at: string
}

export interface AnalysisDetail extends AnalysisSummary {
  report_md: string
  charts: string[]
}

export async function uploadDataset(file: File): Promise<DatasetInfo> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post('/datasets', form)
  return data
}

export async function listAnalyses(): Promise<AnalysisSummary[]> {
  const { data } = await api.get('/analyses')
  return data
}

export async function getAnalysis(id: string): Promise<AnalysisDetail> {
  const { data } = await api.get(`/analyses/${id}`)
  return data
}

export async function deleteAnalysis(id: string): Promise<void> {
  await api.delete(`/analyses/${id}`)
}

export function fileUrl(analysisId: string, name: string): string {
  return `/api/analyses/${analysisId}/files/${encodeURIComponent(name)}`
}

export interface StreamHandlers {
  onStreamToken: (token: string) => void
  onTool: (tool: string, input: string) => void
  onReport: (reportMd: string, charts: string[]) => void
  onDone: () => void
  onError: (message: string) => void
}

export async function runAnalysis(
  datasetId: string,
  question: string,
  handlers: StreamHandlers,
): Promise<void> {
  const form = new FormData()
  form.append('dataset_id', datasetId)
  form.append('question', question)

  let res: Response
  try {
    res = await fetch('/api/analyses', { method: 'POST', body: form })
  } catch {
    handlers.onError('Network error — is the backend running?')
    return
  }

  if (!res.ok || !res.body) {
    handlers.onError(`Request failed (${res.status})`)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const dispatch = (eventName: string, data: string) => {
    if (!eventName) return
    switch (eventName) {
      case 'stream-token':
        handlers.onStreamToken(data)
        break
      case 'tool': {
        try {
          const p = JSON.parse(data) as { tool: string; input: string }
          handlers.onTool(p.tool, p.input)
        } catch { /* ignore */ }
        break
      }
      case 'report': {
        try {
          const p = JSON.parse(data) as { reportMd: string; charts: string[] }
          handlers.onReport(p.reportMd, p.charts)
        } catch { /* ignore */ }
        break
      }
      case 'done':
        handlers.onDone()
        break
      case 'error': {
        let message = 'Analysis failed'
        try {
          const parsed = JSON.parse(data)
          if (parsed?.message) message = parsed.message
        } catch { /* keep default */ }
        handlers.onError(message)
        break
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      let eventName = ''
      const dataLines: string[] = []
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5))
        }
      }
      dispatch(eventName, dataLines.join('\n'))
    }
  }
  handlers.onDone()
}
