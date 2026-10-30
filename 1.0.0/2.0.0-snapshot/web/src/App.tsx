import { useEffect, useState } from 'react';

type Document = { id: string; version: string; title: string; chunk_count: number };
type Locator = { kind: string; name: string };
type Step = { action: string; locator: Locator; value: string };
type Assertion = { check: string; locator: Locator; value: string };
type Case = { id: string; title: string; kind: string; source_ids: string[]; steps: Step[]; assertions: Assertion[] };
type Result = { case_id: string; title: string; kind: string; status: string; error: string; screenshot: string; trace: string };
type Control = { tag: string; id: string; label: string; text: string; test_id: string };
type Run = { id: string; document_id: string; version: string; url: string; objective: string; case_count: number;
  status: string; stage: string; plan: { cases: Case[] } | null; evidence: { source_id: string; content: string; score: number }[] | null;
  controls: Control[] | null; result: Result[] | null; error: string | null };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '요청을 처리하지 못했습니다.');
  return data as T;
}

const post = <T,>(path: string, value?: unknown) => request<T>(path, { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value ?? {}) });

function statusName(status: string) {
  return ({ generating: '생성 중', awaiting_review: '검토 대기', running: '실행 중', passed: '통과',
    failed: '실패', rejected: '거절', error: '오류' } as Record<string, string>)[status] ?? status;
}

function formatLocator(item: Locator) { return `${item.kind}: ${item.name}`; }

export default function App() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [docId, setDocId] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [title, setTitle] = useState('');
  const [docKey, setDocKey] = useState('');
  const [url, setUrl] = useState('');
  const [objective, setObjective] = useState('');
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    const [docs, recent] = await Promise.all([request<Document[]>('/documents'), request<Run[]>('/runs')]);
    setDocuments(docs); setRuns(recent);
    setSelected(current => recent.find(run => run.id === current?.id) ?? recent[0] ?? null);
    setDocKey(current => current || (docs[0] ? `${docs[0].id}|${docs[0].version}` : ''));
  }

  useEffect(() => { refresh().catch(err => setError(String(err))); }, []);

  async function perform(action: () => Promise<Run | void>) {
    setBusy(true); setError('');
    try {
      const run = await action();
      await refresh();
      if (run) setSelected(run);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  async function addDocument() {
    if (!file) throw new Error('문서 파일을 선택해 주십시오.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    await post<Document>('/documents', { id: docId, version, title, filename: file.name, content_base64: btoa(binary) });
    setDocKey(`${docId}|${version}`);
  }

  const [documentId, documentVersion] = docKey.split('|');
  const artifact = (name: string) => `/api/runs/${selected?.id}/files/${name}`;

  return <main className="layout">
    <header className="page-header">
      <p className="eyebrow">COMMON TESTER 2.0.0</p>
      <h1>테스트 실행 작업 공간</h1>
      <p>문서 근거로 테스트 계획을 만들고 검토한 뒤 로컬 앱에서 실행합니다.</p>
    </header>
    {error && <p className="error" role="alert">{error}</p>}

    <section className="panel" aria-labelledby="document-title">
      <div className="section-heading"><h2 id="document-title">문서 관리</h2><span className="hint">.docx, .md, .txt / 버전별 저장</span></div>
      <form className="document-form" onSubmit={event => { event.preventDefault(); perform(addDocument); }}>
        <label>문서 ID<input required value={docId} onChange={event => setDocId(event.target.value)} placeholder="service-policy" /></label>
        <label>버전<input required value={version} onChange={event => setVersion(event.target.value)} /></label>
        <label>제목<input required value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label>파일<input required type="file" accept=".docx,.md,.txt" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
        <button className="primary" disabled={busy}>문서 등록</button>
      </form>
      <p className="hint">등록된 문서: {documents.map(doc => `${doc.title} ${doc.version} (${doc.chunk_count}문단)`).join(', ') || '없음'}</p>
    </section>

    <section className="panel new-run" aria-labelledby="create-title">
      <div className="section-heading create-heading"><h2 id="create-title">새 실행</h2><span className="hint">로컬 다국어 임베딩, 코사인 유사도, 상위 5문단</span></div>
      <form className="create-form" onSubmit={event => { event.preventDefault(); perform(() => post<Run>('/runs',
        { document_id: documentId, version: documentVersion, url, objective, case_count: count })); }}>
        <label>문서 버전<select required value={docKey} onChange={event => setDocKey(event.target.value)}>
          {documents.length === 0 && <option value="">문서 등록 필요</option>}
          {documents.map(doc => <option key={`${doc.id}|${doc.version}`} value={`${doc.id}|${doc.version}`}>{doc.title} / {doc.version}</option>)}
        </select></label>
        <label>로컬 앱 URL<input required type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="http://127.0.0.1:8765/signup.html" /></label>
        <label>테스트 수<input required type="number" min="1" max="30" value={count} onChange={event => setCount(Number(event.target.value))} /></label>
        <button disabled={busy || !documents.length}>계획 생성</button>
        <label className="objective-label">검사 목적<textarea required rows={2} value={objective} onChange={event => setObjective(event.target.value)} placeholder="예: 회원가입 입력값과 오류 안내 검증" /></label>
      </form>
      {busy && <p role="status">처리 중입니다. 모델 생성과 브라우저 실행에는 시간이 걸릴 수 있습니다.</p>}
    </section>

    <div className="columns">
      <section className="panel run-panel" aria-labelledby="runs-title"><h2 id="runs-title">최근 실행</h2>
        <ul className="run-list">{runs.map(run => <li key={run.id}><button className="run-button" aria-pressed={selected?.id === run.id}
          onClick={() => setSelected(run)}><strong>{run.objective}</strong><small>{run.document_id} / {run.version}</small>
          <span className={`status status-${run.status}`}>{statusName(run.status)}</span></button></li>)}</ul>
        {!runs.length && <p>실행 기록이 없습니다.</p>}
      </section>
      <section className="panel detail-panel" aria-labelledby="detail-title">
        <div className="section-heading"><h2 id="detail-title">실행 상세</h2>
          {selected && <span className={`status status-${selected.status}`}>{statusName(selected.status)}</span>}</div>
        {!selected ? <p>실행을 만들면 문서 근거와 테스트 계획이 여기에 표시됩니다.</p> : <>
          <dl className="run-meta"><dt>대상</dt><dd>{selected.url}</dd><dt>문서</dt><dd>{selected.document_id} / {selected.version}</dd>
            <dt>요청 수</dt><dd>{selected.case_count}개</dd><dt>현재 단계</dt><dd>{selected.stage}</dd></dl>
          {selected.error && <p className="error">{selected.error}</p>}
          <div className="action-box"><h3>고정 워크플로</h3>
            <p>검색 → 화면 확인 → 명세 생성 → 검증 → 승인 대기 → 실행 → 결과</p>
            {!!selected.controls?.length && <details><summary>확인한 화면 요소 ({selected.controls.length}개)</summary><ul>
              {selected.controls.map((control, index) => <li key={index}>
                {control.tag} {control.label || control.text || control.id || control.test_id}
              </li>)}</ul></details>}</div>
          {!!selected.evidence?.length && <section className="plan-section"><h3>검색된 문서 근거</h3><ul className="evidence-list">
            {selected.evidence.map(item => <li key={item.source_id}><strong>{item.source_id}</strong><p>{item.content}</p></li>)}</ul></section>}
          {!!selected.plan?.cases.length && <section className="plan-section"><h3>테스트 계획 ({selected.plan.cases.length}개)</h3>
            {selected.plan.cases.map(test => <article className="case-card" key={test.id}>
              <h4>{test.title}</h4><p className="case-id">{test.id} / {test.kind === 'normal' ? '정상' : '결함'} / 출처 {test.source_ids.join(', ')}</p>
              <h5>동작</h5><ol>{test.steps.map((step, index) => <li key={index}>{step.action} {formatLocator(step.locator)} {step.value && <code>{step.value}</code>}</li>)}</ol>
              <h5>기대 결과</h5><ol>{test.assertions.map((assertion, index) => <li key={index}>{assertion.check} {formatLocator(assertion.locator)} {assertion.value && <code>{assertion.value}</code>}</li>)}</ol>
            </article>)}</section>}
          {selected.status === 'awaiting_review' && <section className="review-box"><h3>계획 검토</h3><p>승인하면 브라우저 테스트를 실행합니다.</p>
            <div className="review-actions"><button className="primary" disabled={busy} onClick={() => perform(() => post<Run>(`/runs/${selected.id}/approve`))}>승인하고 실행</button>
              <button className="secondary" disabled={busy} onClick={() => perform(() => post<Run>(`/runs/${selected.id}/reject`))}>거절</button></div></section>}
          {!!selected.result && <section className="result-section"><h3>실행 결과</h3>
            <p>통과 {selected.result.filter(item => item.status === 'passed').length}개 / 실패 {selected.result.filter(item => item.status === 'failed').length}개</p>
            <div className="artifact-links"><a href={artifact('generated_test.py')} target="_blank" rel="noreferrer">생성된 Playwright 코드</a></div>
            {selected.result.map(item => <article className="case-card" key={item.case_id}><h4>{item.title}</h4>
              <p>{item.status === 'passed' ? '통과' : '실패'} / {item.kind === 'normal' ? '정상' : '결함'}</p>
              {item.error && <p className="error">{item.error}</p>}
              <div className="artifact-links">{item.screenshot && <a className="screenshot-link" href={artifact(item.screenshot)} target="_blank" rel="noreferrer">
                {item.status === 'passed' ? '완료 캡처' : '실패 캡처'}<img src={artifact(item.screenshot)} alt={`${item.title} 화면 캡처`} /></a>}
                {item.trace && <a href={artifact(item.trace)}>실패 trace</a>}</div></article>)}</section>}
        </>}
      </section>
    </div>
  </main>;
}
