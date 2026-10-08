'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import styles from '../content/review.module.css'

const sections = [
  { key: 'calendar', title: 'Historical drafts and planning records' },
  { key: 'publishLog', title: 'Historical delivery logs — not verified publication receipts' },
  { key: 'genLog', title: 'Historical generation logs' },
  { key: 'brief', title: 'Historical weekly briefs' },
]
const labels: Record<string, string> = {
  'Scheduled At': 'Proposed date (not a scheduling receipt)',
  'Published At': 'Historically recorded date (not proof of publication)',
  Status: 'Recorded status', 'Publish Status': 'Recorded log status',
}
export default function ArchivePage() {
  const [data, setData] = useState<Record<string, any[]>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    async function load() {
      try {
        const values = await Promise.all(sections.map(async ({ key }) => {
          const response = await fetch(`/api/admin/airtable?table=${key}&params=maxRecords%3D100`, { cache: 'no-store' })
          const body = await response.json()
          if (!response.ok || body.error) throw new Error(body.error?.message || body.error || 'Unable to load historical records')
          return [key, body.records || []] as const
        }))
        setData(Object.fromEntries(values))
      } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load archive') }
      finally { setLoading(false) }
    }
    void load()
  }, [])
  return <main className={styles.page}>
    <Link className={`${styles.button} ${styles.primary}`} href="/admin/content">Open current content review →</Link>
    <h1>Historical content archive</h1>
    <p>Read-only drafts and logs from the earlier content workflow. June 2026 titles retain their original planning dates. October planning records here are also proposals, not confirmed social deliveries.</p>
    <p>There are no approval or publishing actions here. Current media approvals are in Content review; confirmed social scheduling is in Metricool.</p>
    <p>The October 8 Ahnika test approval was returned to pending. The old Laviche “published” record was corrected: its log reports a Buffer draft requiring an image, not a verified live post.</p>
    {loading && <p role="status">Loading historical records…</p>}
    {error && <p role="alert">{error}</p>}
    {sections.map(({ key, title }) => <section key={key} style={{ marginTop: 32 }}>
      <h2>{title}</h2>
      {data[key]?.map(record => <details key={record.id} style={{ padding: 16, border: '1px solid #967346', borderRadius: 8, marginBottom: 12 }}>
        <summary style={{ cursor: 'pointer', minHeight: 44, fontWeight: 700, color: '#f6dba1' }}>View record: {record.fields.Title || record.fields['Content Title'] || record.fields['Run Type'] || record.fields['Week Of'] || record.id}</summary>
        <dl>{Object.entries(record.fields).map(([field, value]) => <div key={field} style={{ marginTop: 12 }}><dt style={{ fontWeight: 700 }}>{labels[field] || field}</dt><dd style={{ margin: '4px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{typeof value === 'string' ? value : JSON.stringify(value)}</dd></div>)}</dl>
      </details>)}
      {!loading && !error && !data[key]?.length && <p>No records.</p>}
    </section>)}
  </main>
}
