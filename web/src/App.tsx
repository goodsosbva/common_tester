import { useEffect, useRef, useState } from 'react';
type Ref = { path: string; paragraph_no: number; chunk_no: number };
type Product = { product: string; version: string; files: string[]; reference_files: string[]; indexed: boolean; chunk_count: number };
type Summary = { planned: number; executed: number; test_passed: number; failed: number; unconfirmed: number; execution_errors: number; unexecuted: number; screenshots: number; capture_errors: number; quadrants: Record<string, number> };
type Execution = { execution_id: string; target_url: string; started_at: string; status: string; counts: { total: number; passed: number; failed: number }; summary: Summary | null };
type Run = { run_id: string; product: string; version: string; scope: string; target_url: string; created_at: string; requirement_count: number; scenario_count: number; status: string; current_node: string | null; error: string | null; executions: Execution[] };
type FileLink = { path: string; url: string };
type Case = { scenario_key: string; title: string; requirement_id: string; requirement_title: string; expected_policy: string; actual_policy: string; expected_observation: string; situation: string; actions: string[]; classification: string | null; verdict: string; test_status: string; observation_reason: string; observation: { text?: string; selector?: string; value?: unknown }; source_text: string; source_refs: Ref[]; errors: string[]; duration_ms: number; capture_error: string | null; screenshot_files: FileLink[]; trace_files: FileLink[] };
type Unsupported = { scenario_key: string; requirement_title: string; reason: string; expected_policy: string; expected_observation: string; source_text: string; source_refs: Ref[] };
type Report = { run_id: string; execution_id: string; product: string; version: string; scope: string; target_url: string; started_at: string; status: string; error: string | null; summary: Summary; cases: Case[]; unexecuted: Unsupported[]; unresolved: { requirement_key: string; requirement_title: string; reason: string }[]; artifacts: Record<string, string>; test_sources: { file: string; url: string; sha256: string }[] };
const nodes = [['retrieve_evidence', '근거 검색'], ['build_handoff', '명세 작성'], ['generate_playwright', '코드 생성'], ['run_playwright', '브라우저 실행'], ['summarize_results', '결과 집계']];
const verdicts: Record<string, string> = { passed: '통과', failed: '실패', unconfirmed: '정책 미확인', execution_error: '실행 오류' };
const policies: Record<string, string> = { allow: '허용', deny: '거부', unknown: '미확인' };
const statusNames: Record<string, string> = { queued: '대기', running: '진행 중', completed: '완료', not_run: '미실행', unsupported: '해당 화면 없음', error: '작업 중단', execution_error: '실행 오류', generated: '코드 준비', handoff: '명세 준비', empty: '자료 없음' };
const quadrants: Record<string, string> = { TP: '허용 기대 → 실제 허용', FN: '허용 기대 → 실제 거부', FP: '거부 기대 → 실제 허용', TN: '거부 기대 → 실제 거부' };
function date(value: string) { return new Date(value).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch('/api' + path, init);
  const data = await response.json();
  if (!response.ok) throw Error(typeof data.detail === 'string' ? data.detail : '요청을 처리하지 못했습니다.');
  return data as T;
}
function post(body?: unknown): RequestInit { return { method: 'POST', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }; }
function Source({ text, refs }: { text: string; refs: Ref[] }) {
  return <details className="source"><summary>기획 원문과 출처</summary><blockquote>{text || '연결된 원문이 없습니다.'}</blockquote><div className="refs">{refs.map(ref => <code key={`${ref.path}:${ref.paragraph_no}:${ref.chunk_no}`}>{ref.path} / 문단 {ref.paragraph_no} / 조각 {ref.chunk_no}</code>)}</div></details>;
}
export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productKey, setProductKey] = useState('');
  const [target, setTarget] = useState('http://127.0.0.1:8765/product-demo.html');
  const [scope, setScope] = useState('전체');
  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState(new URLSearchParams(location.search).get('run') || '');
  const [executionId, setExecutionId] = useState(new URLSearchParams(location.search).get('execution') || '');
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<FileLink | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const current = products.find(row => `${row.product}/${row.version}` === productKey);
  const run = runs.find(row => row.run_id === runId);
  const running = runs.some(row => ['queued', 'running'].includes(row.status));
  async function refresh() {
    const [items, history] = await Promise.all([api<Product[]>('/products'), api<Run[]>('/runs')]);
    setProducts(items); setRuns(history); setError('');
    setProductKey(key => items.some(item => `${item.product}/${item.version}` === key) ? key : items[0] ? `${items[0].product}/${items[0].version}` : '');
    setRunId(id => id || history.find(item => item.executions.some(ex => ex.status === 'completed'))?.run_id || history[0]?.run_id || '');
  }
  useEffect(() => { refresh().catch(reason => setError(message(reason))); }, []);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { refresh().catch(reason => setError(message(reason))); }, 3000);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => {
    if (!run) return;
    setExecutionId(id => run?.executions.some(item => item.execution_id === id) ? id : run?.executions.find(item => item.status === 'completed')?.execution_id || run?.executions[0]?.execution_id || '');
  }, [runId, run?.executions[0]?.execution_id]);
  useEffect(() => {
    let active = true;
    setReport(null); setQuery('');
    if (!run?.executions.some(item => item.execution_id === executionId)) { setLoading(false); return; }
    setLoading(true);
    api<Report>(`/runs/${runId}/executions/${executionId}/report`).then(value => {
      if (!active) return;
      setReport(value); setFilter(value.status === 'not_run' ? 'unexecuted' : value.summary.failed || value.summary.execution_errors ? 'failed' : 'all');
    }).catch(reason => { if (active) setError(message(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [runId, executionId, run?.run_id]);
  useEffect(() => { if (preview && !dialog.current?.open) dialog.current?.showModal(); }, [preview]);
  async function index() {
    if (!current) return;
    setBusy('index'); setError(''); setNotice('');
    try {
      const result = await api<{ chunk_count: number }>(`/products/${encodeURIComponent(current.product)}/${encodeURIComponent(current.version)}/index`, post());
      await refresh(); setNotice(`${result.chunk_count}개 원문 조각의 임베딩을 저장했습니다.`);
    } catch (reason) { setError(message(reason)); } finally { setBusy(''); }
  }
  async function start() {
    if (!current) return;
    setBusy('start'); setError(''); setNotice('');
    try {
      const created = await api<{ run_id: string }>('/runs', post({ product: current.product, version: current.version, target_url: target, scope }));
      setRunId(created.run_id); setExecutionId(''); await refresh();
      setNotice('새 작업을 시작했습니다. 근거 검색부터 결과 집계까지 진행 상태를 확인할 수 있습니다.');
    } catch (reason) { setError(message(reason)); } finally { setBusy(''); }
  }
  async function rerun() {
    if (!report) return;
    setBusy('execute'); setError(''); setNotice('');
    try {
      const result = await api<{ execution_id: string }>(`/runs/${runId}/execute`, post({ target_url: report.target_url }));
      await refresh(); setExecutionId(result.execution_id); setNotice('동일한 코드의 새 실행 기록을 저장했습니다.');
    } catch (reason) { setError(message(reason)); } finally { setBusy(''); }
  }
  useEffect(() => {
    if (runId && executionId) history.replaceState(null, '', `?run=${runId}&execution=${executionId}`);
  }, [runId, executionId]);
  const summary = report?.summary;
  const needle = query.toLocaleLowerCase();
  const visibleCases = report?.cases.filter(item => {
    const matches = filter === 'all' || (filter === 'failed' ? ['failed', 'execution_error'].includes(item.verdict) : filter === 'unconfirmed' ? item.classification === null && item.verdict !== 'execution_error' : filter === item.verdict || filter === item.classification);
    return matches && `${item.title} ${item.requirement_title} ${item.scenario_key} ${item.source_text}`.toLocaleLowerCase().includes(needle);
  }) || [];
  const unsupported = report?.unexecuted.filter(item => `${item.scenario_key} ${item.requirement_title} ${item.reason} ${item.source_text}`.toLocaleLowerCase().includes(needle)) || [];
  const nodeIndex = nodes.findIndex(([id]) => id === run?.current_node);
  return <main className="layout">
    <header className="page-header"><div><p className="eyebrow">COMMON TESTER <span>2.0.1</span></p><h1>기획에서 실행 결과까지</h1><p>요구사항을 근거로 만든 테스트와 실제 화면을 함께 확인합니다.</p></div><button className="secondary" onClick={() => refresh().catch(reason => setError(message(reason)))}>기록 새로고침</button></header>
    {error && <p className="alert danger" role="alert">{error}</p>}
    {notice && <p className="alert notice" role="status">{notice}</p>}
    <details className="panel preparation">
      <summary><strong>새 테스트 준비</strong><span className="hint">제품 문서 선택, 임베딩, 테스트 생성과 실행</span></summary>
      <div className="setup-grid">
        <label>제품과 버전<select value={productKey} onChange={event => setProductKey(event.target.value)}>{!products.length && <option value="">등록된 제품 없음</option>}{products.map(item => <option key={`${item.product}/${item.version}`}>{`${item.product}/${item.version}`}</option>)}</select></label>
        <label className="target">대상 앱 URL<input type="url" value={target} onChange={event => setTarget(event.target.value)} placeholder="https://example.com" /></label>
        <label>검사 범위<input value={scope} onChange={event => setScope(event.target.value)} /></label>
      </div>
      {current && <p className="document-info">documents/{current.product}/{current.version} <strong>{current.indexed ? `${current.chunk_count}개 조각 준비됨` : '임베딩 필요'}</strong><br />검색 원문: {current.files.join(', ')}{current.reference_files.length > 0 && <><br />원본: {current.reference_files.join(', ')}</>}</p>}
      <div className="actions"><button className="secondary" disabled={!current || !!busy || running} onClick={index}>{busy === 'index' ? '임베딩 중...' : '문서 임베딩'}</button><button className="primary" disabled={!current?.indexed || !scope.trim() || !target.trim() || !!busy || running} onClick={start}>{busy === 'start' ? '시작 중...' : '생성부터 실행까지 시작'}</button><span className="hint">요구사항과 URL의 공개 화면 정보를 모델에 전달해 테스트 코드를 만듭니다.</span></div>
    </details>
    <div className="workspace">
      <aside className="panel history"><div className="section-heading"><h2>작업 기록</h2><span className="counter">{runs.length}</span></div><p className="hint">작업을 고른 뒤 개별 실행을 확인하세요.</p><nav aria-label="작업 기록">{runs.map(item => <button key={item.run_id} className={`run-item ${runId === item.run_id ? 'selected' : ''}`} onClick={() => { setRunId(item.run_id); setError(''); }} aria-current={runId === item.run_id ? 'true' : undefined}><span className="run-title">{item.product || '제품 미지정'} <small>{item.version}</small></span><time>{date(item.created_at)}</time><span className="run-meta">{item.scenario_count}개 상황 / {item.executions.length}회 실행</span><span className={`badge ${item.status === 'error' ? 'failed' : ''}`}>{statusNames[item.status] || item.status}</span><code>{item.run_id.slice(0, 8)}</code></button>)}</nav>{!runs.length && <p>아직 작업 기록이 없습니다.</p>}</aside>
      <section className="results-area" aria-label="실행 결과">
        {run && <section className="panel run-progress"><div className="section-heading"><h2>{run.product} / {run.version}</h2><span className={`badge ${run.status === 'error' ? 'failed' : ''}`}>{statusNames[run.status] || run.status}</span></div><ol className="pipeline">{nodes.map(([id, label], index) => <li key={id} className={`${index < nodeIndex || run.status === 'completed' ? 'done' : ''} ${index === nodeIndex && run.status !== 'completed' ? 'active' : ''}`}><span>{index + 1}</span>{label}</li>)}</ol>{run.error && <p className="alert danger">{run.error}</p>}{['running', 'queued'].includes(run.status) && <p className="hint" role="status">진행 중입니다. 3초마다 상태를 갱신합니다.</p>}<code className="run-id">작업 ID {run.run_id}</code></section>}
        {run && !!run.executions.length && <section className="panel execution-picker"><label>실행 기록<select aria-label="실행 기록" value={executionId} onChange={event => setExecutionId(event.target.value)}>{run.executions.map(item => <option key={item.execution_id} value={item.execution_id}>{date(item.started_at)} / {item.target_url} / {item.counts.passed} 통과, {item.counts.failed} 실패 / {item.execution_id.slice(0, 8)}</option>)}</select></label><button className="secondary" onClick={rerun} disabled={!!busy || !report || running}>{busy === 'execute' ? '브라우저 실행 중...' : '같은 코드 다시 실행'}</button></section>}
        {loading && <p className="panel" role="status">실행 결과를 읽고 있습니다...</p>}
        {report && summary && <>
          <section className="panel report-overview"><div className="section-heading"><div><p className="eyebrow">실행 요약</p><h2>{report.status === 'not_run' ? '이 앱에서 실행할 수 있는 상황이 없습니다' : summary.failed ? `${summary.failed}개 점검 실패` : report.status === 'execution_error' || summary.execution_errors ? '실행을 완료하지 못했습니다' : '실행한 점검을 모두 통과했습니다'}</h2></div><span className={`badge ${report.status === 'not_run' ? '' : summary.failed || summary.execution_errors ? 'failed' : 'passed'}`}>{report.status === 'not_run' ? '미실행' : summary.failed || summary.execution_errors ? '확인 필요' : '실행 완료'}</span></div><p className="target-url">{report.target_url}</p><p className="hint">실행 ID <code>{report.execution_id}</code> / {date(report.started_at)}</p>{report.error && <p className="alert danger" role="alert">{report.error}</p>}<div className="metrics">{[['계획 상황', summary.planned], ['실행', summary.executed], ['Playwright 통과', summary.test_passed], ['점검 실패', summary.failed], ['스크린샷', summary.screenshots], ['미실행', summary.unexecuted]].map(([label, count]) => <div key={label} className={label === '점검 실패' && summary.failed ? 'metric-failed' : ''}><strong>{count}</strong><span>{label}</span></div>)}</div><div className="quadrants">{Object.keys(quadrants).map(name => <button key={name} className={`${name} ${filter === name ? 'chosen' : ''}`} aria-pressed={filter === name} onClick={() => setFilter(filter === name ? 'all' : name)}><span>{name}</span><strong>{summary.quadrants[name]}</strong><small>{quadrants[name]}</small></button>)}</div><p className="classification-note">정책 판정과 상세 점검은 별개입니다. TN이어도 문구, 색상, 위치가 다르면 점검 실패로 표시됩니다.</p><div className="subcounts"><button onClick={() => setFilter('unconfirmed')}>정책 미확인 <strong>{summary.unconfirmed}</strong></button><button onClick={() => setFilter('execution_error')}>실행 오류 <strong>{summary.execution_errors}</strong></button><span>캡처 오류 <strong>{summary.capture_errors}</strong></span></div></section>
          <section className="panel case-workspace"><div className="section-heading"><h2>점검 목록</h2><span className="hint">실패 항목 우선 표시</span></div><div className="filters" role="group" aria-label="결과 필터">{[['all', `실행 전체 ${summary.executed}`], ['failed', `실패 ${summary.failed + summary.execution_errors}`], ['passed', '통과'], ['unconfirmed', `정책 미확인 ${summary.unconfirmed}`], ['unexecuted', `미실행 ${summary.unexecuted}`]].map(([id, label]) => <button key={id} className={filter === id ? 'chosen' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div><input className="search" aria-label="점검 검색" placeholder="요구사항 ID, 제목, 원문 검색" value={query} onChange={event => setQuery(event.target.value)} /><p className="hint" aria-live="polite">{filter === 'unexecuted' ? unsupported.length : visibleCases.length}개 항목 표시</p>
          {filter === 'unexecuted' ? unsupported.map(item => <details key={item.scenario_key} className="case-card unsupported"><summary><span className="badge">미실행</span><span className="case-title">{item.requirement_title}<code>{item.scenario_key}</code></span></summary><div className="case-body"><p className="unsupported-reason">{item.reason}</p><p><strong>기대 결과</strong> {item.expected_observation}</p><Source text={item.source_text} refs={item.source_refs} /></div></details>) : visibleCases.map(item => <details key={`${report.execution_id}:${item.scenario_key}`} className={`case-card ${item.verdict}`} open={['failed', 'execution_error'].includes(item.verdict) || undefined}><summary><span className={`badge ${item.verdict}`}>{verdicts[item.verdict]}</span><span className="case-title">{item.title.replace(item.scenario_key, '').trim()}<code>{item.scenario_key}</code></span><span className={`quadrant-label ${item.classification || ''}`}>{item.classification || '미확인'}</span></summary><div className="case-body"><div className="policy-comparison"><div><span>기대 정책</span><strong>{policies[item.expected_policy]}</strong></div><span aria-hidden="true">→</span><div><span>실제 관찰</span><strong>{policies[item.actual_policy]}</strong></div><div><span>Playwright</span><strong>{item.test_status === 'passed' ? '통과' : item.test_status === 'failed' ? '실패' : item.test_status}</strong></div></div><p><strong>기대 결과</strong><br />{item.expected_observation}</p>{item.situation && <p><strong>테스트 상황</strong><br />{item.situation}</p>}{!!item.actions?.length && <details><summary>실행 동작</summary><ol>{item.actions.map((action, index) => <li key={index}>{action}</li>)}</ol></details>}<div className="observed"><strong>실제 화면 신호</strong><p>{item.observation?.text || item.observation_reason}</p>{item.observation?.selector && <code>{item.observation.selector} / {JSON.stringify(item.observation.value)}</code>}</div>{item.actual_policy === 'unknown' && <p className="alert caution">{item.observation_reason}</p>}{item.errors.map((text, index) => <pre className="assertion-error" key={index}>{text}</pre>)}{item.capture_error && <p className="alert danger">{item.capture_error}</p>}<Source text={item.source_text} refs={item.source_refs} /><div className="screenshots">{item.screenshot_files.map((file, index) => <button key={file.path} className="screenshot" onClick={() => setPreview(file)} aria-label={`${item.scenario_key} 스크린샷 ${index + 1} 크게 보기`}><img src={file.url} loading="lazy" alt={`${item.requirement_title} 실행 결과 ${index + 1}`} /><span>스크린샷 크게 보기</span></button>)}</div><div className="artifact-links">{item.trace_files.map(file => <a key={file.path} href={file.url} download>실패 trace 다운로드</a>)}<span>{(item.duration_ms / 1000).toFixed(2)}초</span></div></div></details>)}{!(filter === 'unexecuted' ? unsupported.length : visibleCases.length) && <p className="empty">조건에 맞는 항목이 없습니다.</p>}</section>
          <details className="panel unresolved"><summary>기획 미확정 사항 <strong>{report.unresolved.length}</strong></summary><p className="hint">원문에 없는 기준은 임의로 보충하지 않았습니다.</p><ul>{report.unresolved.map((item, index) => <li key={index}><strong>{item.requirement_title}</strong> <code>{item.requirement_key}</code><p>{item.reason}</p></li>)}</ul></details>
          <details className="panel artifacts"><summary>실행 파일과 코드</summary><p className="hint">이 실행에 사용한 코드 사본과 원본 결과 파일입니다.</p><div className="artifact-links">{Object.entries(report.artifacts).map(([name, url]) => <a key={name} href={url} download>{name}</a>)}</div>{report.test_sources.map(source => <p key={source.file}><a href={source.url} download>{source.file}</a><code className="hash">SHA-256 {source.sha256}</code></p>)}</details>
        </>}
        {!run && <section className="panel empty"><h2>제품 문서를 준비하면 시작할 수 있습니다</h2><p>새 테스트 준비에서 제품과 대상 앱을 선택하세요.</p></section>}
        {run && !loading && !report && !run.executions.length && !['running', 'queued'].includes(run.status) && <p className="panel empty">아직 브라우저 실행 결과가 없습니다. 새 테스트 준비에서 생성과 실행을 시작할 수 있습니다.</p>}
      </section>
    </div>
    <dialog ref={dialog} className="image-dialog" onClose={() => setPreview(null)} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }} aria-label="실행 스크린샷"><div className="dialog-toolbar"><strong>실행 스크린샷</strong><button onClick={() => dialog.current?.close()} autoFocus>닫기</button></div>{preview && <><img src={preview.url} alt="실행 결과 스크린샷 확대" /><a href={preview.url} download>원본 이미지 다운로드</a></>}</dialog>
    <footer>Common Tester 2.0.1 / 근거, 코드, 실행 결과를 작업 ID와 실행 ID별로 보관합니다.</footer>
  </main>;
}
