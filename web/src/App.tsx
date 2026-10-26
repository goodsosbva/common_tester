import { useEffect, useState, type FormEvent } from "react";

type RunSummary = {
  id: string; project_id: string; route: string; policy_version: string;
  status: string; created_at: string;
};
type Evidence = { kind: "policy" | "code"; source_id: string; version: string | null };
type TestPlan = {
  fields: { id: string; label: string }[];
  cases: {
    id: string; title: string;
    steps: { action: string; field_id: string; value: string | null }[];
    assertions: { action: string; field_id: string; expected: string | null }[];
    evidence: Evidence[];
  }[];
};
type CaseResult = { id: string; title?: string; status: string; error?: string; screenshot?: string; trace?: string };
type RunDetail = RunSummary & {
  plan: TestPlan | null;
  result: { status: string; total?: number; passed?: number; error?: string; cases: CaseResult[] } | null;
  generation: { objective?: string; case_count?: number; attempts?: unknown[] } | null;
  workflow: { phase?: string; attempts?: number; reason?: string } | null;
};
type PolicySource = { source_id: string; title: string; version: string; content: string };

const statusLabel: Record<string, string> = {
  created: "생성됨", generating: "계획 생성 중", awaiting_review: "검토 대기",
  rejected: "거절됨", running: "실행 중", passed: "통과", failed: "실패", error: "오류",
};
const actionLabel: Record<string, string> = { fill: "입력", click: "클릭", select: "선택", press: "키 입력" };
const assertionLabel: Record<string, string> = { visible: "표시 확인", value: "값 확인", text: "문구 확인" };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    const detail = typeof body?.detail === "string" ? body.detail : `HTTP ${response.status}`;
    if (response.status === 503 && detail.includes("OPENAI_API_KEY")) {
      throw new Error("API 서버에 새 OPENAI_API_KEY를 설정하고 다시 시작하십시오.");
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function jsonPost(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function artifactUrl(runId: string, path: string): string {
  const filename = path.split(/[\\/]/).pop() ?? "";
  return `/api/runs/${runId}/artifacts/${encodeURIComponent(filename)}`;
}

export default function App() {
  const [projectId, setProjectId] = useState("demo-orders");
  const [route, setRoute] = useState("/fixtures/order.html");
  const [policyVersion, setPolicyVersion] = useState("v1");
  const [objective, setObjective] = useState("주문명, 주문 수량, 요청 금액, 주문 메모의 입력 규칙과 저장 결과 검증");
  const [caseCount, setCaseCount] = useState(20);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<RunDetail | null>(null);
  const [sources, setSources] = useState<Record<string, PolicySource>>({});
  const [sourceError, setSourceError] = useState("");
  const [busy, setBusy] = useState<"create" | "start" | "approve" | "reject" | null>(null);
  const [message, setMessage] = useState("");

  async function refreshRuns() {
    setRuns(await request<RunSummary[]>("/api/runs"));
  }

  useEffect(() => {
    void refreshRuns().catch((error: Error) => setMessage(error.message));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const ids = [...new Set(selected?.plan?.cases.flatMap((testCase) =>
      testCase.evidence.filter((evidence) => evidence.kind === "policy").map((evidence) => evidence.source_id)) ?? [])];
    setSources({});
    setSourceError("");
    if (ids.length > 0) {
      void Promise.all(ids.map((id) => request<PolicySource>(
        `/api/policies/sources/${encodeURIComponent(id)}`, { signal: controller.signal },
      ))).then((found) => {
        if (!controller.signal.aborted) setSources(Object.fromEntries(found.map((source) => [source.source_id, source])));
      }).catch((error: Error) => {
        if (!controller.signal.aborted) setSourceError(`정책 원문을 불러오지 못했습니다: ${error.message}`);
      });
    }
    return () => controller.abort();
  }, [selected?.id, selected?.plan]);

  async function createRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    setMessage("");
    try {
      if (projectId === "demo-orders" && route.split("?", 1)[0] === "/fixtures/order.html" && policyVersion === "v1") {
        await request("/api/demo/setup", { method: "POST" });
      }
      const run = await request<RunDetail>("/api/runs", jsonPost({
        project_id: projectId, route, policy_version: policyVersion,
      }));
      setSelected(run);
      await refreshRuns();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "실행을 만들 수 없습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function selectRun(id: string) {
    setMessage("");
    try {
      setSelected(await request<RunDetail>(`/api/runs/${id}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "실행을 읽을 수 없습니다.");
    }
  }

  async function advance(action: "start" | "approve" | "reject") {
    if (!selected) return;
    setBusy(action);
    setMessage("");
    try {
      const url = action === "start"
        ? `/api/runs/${selected.id}/workflow/start`
        : `/api/runs/${selected.id}/workflow/resume`;
      const body = action === "start" ? { objective, case_count: caseCount } : { approved: action === "approve" };
      setSelected(await request<RunDetail>(url, jsonPost(body)));
      await refreshRuns();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "요청을 처리할 수 없습니다.");
      setSelected(await request<RunDetail>(`/api/runs/${selected.id}`).catch(() => selected));
      await refreshRuns().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  const policyIds = [...new Set(selected?.plan?.cases.flatMap((testCase) =>
    testCase.evidence.filter((evidence) => evidence.kind === "policy").map((evidence) => evidence.source_id)) ?? [])];
  const sourcesReady = policyIds.every((id) => sources[id]);
  const canStart = selected?.status === "created" && !selected.plan &&
    selected.project_id === "demo-orders" && selected.route.split("?", 1)[0] === "/fixtures/order.html";

  return (
    <main className="layout">
      <header className="page-header">
        <p className="eyebrow">COMMON TESTER</p>
        <h1>테스트 실행 작업 공간</h1>
        <p>정책 근거를 확인하고 계획을 승인한 뒤 브라우저 검사 결과를 살펴보십시오.</p>
      </header>

      <section className="panel" aria-labelledby="create-title">
        <div className="section-heading create-heading">
          <h2 id="create-title">새 실행</h2>
          <span className="hint">데모 주문 화면과 v1 정책을 바로 사용할 수 있습니다.</span>
        </div>
        <form className="create-form" onSubmit={createRun}>
          <label>프로젝트 ID<input value={projectId} onChange={(event) => setProjectId(event.target.value)} required /></label>
          <label>화면 경로<input value={route} onChange={(event) => setRoute(event.target.value)} pattern="/.*" required /></label>
          <label>정책 버전<input value={policyVersion} onChange={(event) => setPolicyVersion(event.target.value)} required /></label>
          <button disabled={busy !== null} type="submit">{busy === "create" ? "준비 중" : "실행 생성"}</button>
        </form>
      </section>

      {message && <p className="error" role="alert">{message}</p>}

      <div className="columns">
        <section className="panel run-panel" aria-labelledby="runs-title">
          <h2 id="runs-title">최근 실행</h2>
          {runs.length === 0 ? <p>생성한 실행이 없습니다.</p> : (
            <ul className="run-list">
              {runs.map((run) => (
                <li key={run.id}>
                  <button className="run-button" aria-pressed={selected?.id === run.id}
                    disabled={busy !== null} onClick={() => void selectRun(run.id)} type="button">
                    <strong>{run.route}</strong>
                    <span>{run.project_id} / {run.policy_version}</span>
                    <small>{new Date(run.created_at).toLocaleString("ko-KR")}</small>
                    <span className={`status status-${run.status}`}>{statusLabel[run.status] ?? run.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel detail-panel" aria-labelledby="detail-title">
          <div className="section-heading">
            <h2 id="detail-title">실행 상세</h2>
            {selected && <span className={`status status-${selected.status}`} role="status">
              {statusLabel[selected.status] ?? selected.status}
            </span>}
          </div>
          {!selected ? <p>왼쪽에서 실행을 선택하십시오.</p> : <>
            <dl className="run-meta">
              <dt>실행 ID</dt><dd className="mono">{selected.id}</dd>
              <dt>대상</dt><dd>{selected.project_id} / {selected.route}</dd>
              <dt>정책 버전</dt><dd>{selected.policy_version}</dd>
              {selected.workflow?.attempts && <><dt>계획 생성</dt><dd>{selected.workflow.attempts}회 시도</dd></>}
            </dl>

            {canStart && <div className="action-box">
              <label htmlFor="objective">검사 목표</label>
              <textarea id="objective" value={objective} maxLength={300} minLength={3}
                onChange={(event) => setObjective(event.target.value)} rows={3} />
              <label htmlFor="case-count">생성할 테스트 수 (1~30)</label>
              <input id="case-count" type="number" min={1} max={30} required value={caseCount}
                onChange={(event) => setCaseCount(Number(event.target.value))} />
              <button disabled={busy !== null || objective.trim().length < 3 || caseCount < 1 || caseCount > 30}
                onClick={() => void advance("start")} type="button">
                {busy === "start" ? "계획 생성 중" : "계획 생성"}
              </button>
            </div>}
            {selected.status === "created" && !canStart && !selected.plan &&
              <p className="notice">자동 계획 생성은 현재 데모 주문 화면에서 지원합니다.</p>}
            {selected.status === "generating" && <p className="notice">계획을 생성하고 있습니다. 잠시 후 다시 선택해 상태를 확인하십시오.</p>}
            {selected.workflow?.reason && <p className="error">검증 오류: {selected.workflow.reason}</p>}

            {selected.plan && <section className="plan-section" aria-labelledby="plan-title">
              <h3 id="plan-title">실행계획 ({selected.plan.cases.length}개)</h3>
              {selected.generation?.objective && <p className="objective">목표: {selected.generation.objective}</p>}
              {selected.plan.cases.map((testCase, index) => {
                const fields = Object.fromEntries(selected.plan!.fields.map((field) => [field.id, field.label]));
                const outcome = selected.result?.cases.find((item) => item.id === testCase.id);
                return <article className="case-card" key={testCase.id}>
                  <div className="section-heading">
                    <h4>{index + 1}. {testCase.title}</h4>
                    {outcome && <span className={`status status-${outcome.status}`}>
                      {statusLabel[outcome.status] ?? outcome.status}
                    </span>}
                  </div>
                  <p className="case-id mono">{testCase.id}</p>
                  <h5>실행 단계</h5>
                  <ol>{testCase.steps.map((step, stepIndex) => <li key={stepIndex}>
                    {fields[step.field_id] ?? step.field_id} {actionLabel[step.action] ?? step.action}
                    {step.value != null && <>: <code>{step.value}</code></>}
                  </li>)}</ol>
                  <h5>확인 항목</h5>
                  <ul>{testCase.assertions.map((assertion, assertionIndex) => <li key={assertionIndex}>
                    {fields[assertion.field_id] ?? assertion.field_id} {assertionLabel[assertion.action] ?? assertion.action}
                    {assertion.expected != null && <>: <code>{assertion.expected}</code></>}
                  </li>)}</ul>
                  <h5>근거</h5>
                  <ul className="evidence-list">{testCase.evidence.map((evidence) => <li key={evidence.source_id}>
                    {evidence.kind === "policy" && sources[evidence.source_id]
                      ? <><strong>{sources[evidence.source_id].title} ({sources[evidence.source_id].version})</strong>
                          <p>{sources[evidence.source_id].content}</p></>
                      : <span className="mono">{evidence.source_id}</span>}
                  </li>)}</ul>
                  {outcome?.error && <p className="error">{outcome.error}</p>}
                  {outcome && (outcome.screenshot || outcome.trace) && <div className="artifact-links">
                    {outcome.screenshot && <a className="screenshot-link" href={artifactUrl(selected.id, outcome.screenshot)} target="_blank" rel="noreferrer">
                      <img src={artifactUrl(selected.id, outcome.screenshot)} alt={`${outcome.status === "passed" ? "성공" : "실패"} 화면 캡처`} loading="lazy" />
                      <span>{outcome.status === "passed" ? "성공" : "실패"} 화면 캡처</span>
                    </a>}
                    {outcome.trace && <a href={artifactUrl(selected.id, outcome.trace)}>Playwright 추적 파일</a>}
                  </div>}
                </article>;
              })}
            </section>}

            {selected.status === "awaiting_review" && <div className="review-box">
              <h3>계획 검토</h3>
              <p>실행 단계, 기대 결과와 정책 원문을 확인한 뒤 결정하십시오.</p>
              {sourceError && <p className="error" role="alert">{sourceError}</p>}
              {!sourcesReady && !sourceError && <p>정책 원문을 불러오는 중입니다.</p>}
              <div className="review-actions">
                <button className="primary" disabled={busy !== null || !sourcesReady || !!sourceError}
                  onClick={() => void advance("approve")} type="button">
                  {busy === "approve" ? "브라우저 실행 중" : "승인하고 실행"}
                </button>
                <button className="secondary" disabled={busy !== null}
                  onClick={() => void advance("reject")} type="button">계획 거절</button>
              </div>
            </div>}

            {selected.result && <section className="result-section" aria-labelledby="result-title">
              <h3 id="result-title">실행 결과</h3>
              {selected.result.total != null && <p>{selected.result.total}건 중 {selected.result.passed ?? 0}건 통과, {selected.result.total - (selected.result.passed ?? 0)}건 실패</p>}
              {selected.result.error && <p className="error">{selected.result.error}</p>}
            </section>}
            {selected.status === "rejected" && <p className="notice">계획을 거절했습니다. 브라우저 검사는 실행하지 않았습니다.</p>}
          </>}
        </section>
      </div>
    </main>
  );
}
