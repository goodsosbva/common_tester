"""Run two fresh full pipelines, then verify their provenance and output isolation."""
import argparse
import hashlib
import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import core
from results import save_json
from workflow import _requirements

ROOT = core.ROOT
MANIFEST = ROOT / '.local/stage6-latest.json'
API = 'http://127.0.0.1:8000/api'
NODES = ['retrieve_evidence', 'build_handoff', 'generate_playwright', 'run_playwright', 'summarize_results']


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def request(path, payload=None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(API + path, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.status, json.loads(response.read())


def record_progress(manifest, item):
    _, row = request('/runs/' + item['run_id'])
    value = {'status': row['status'], 'node': row['current_node'], 'at': datetime.now(timezone.utc).isoformat()}
    if not item['events'] or any(item['events'][-1][key] != value[key] for key in ('status', 'node')):
        item['events'].append(value)
        save_json(MANIFEST, manifest)
        print(item['label'], item['run_id'], value['status'], value['node'], flush=True)
    return row


def run_twice():
    request('/health')
    with urllib.request.urlopen('http://127.0.0.1:8765/product-demo.html', timeout=10) as response:
        assert response.status == 200
    # Freeze earlier results and source files before starting either job.
    files = [file for file in (ROOT / '.local/runs').rglob('*') if file.is_file() and not file.name.endswith('.tmp')]
    files += [file for file in (ROOT / 'documents/product/v1').rglob('*') if file.is_file()]
    files += [ROOT / 'examples/product-demo.html', ROOT / 'playwright-observations.ts']
    manifest = {'started_at': datetime.now(timezone.utc).isoformat(), 'input': {'product':'product','version':'v1','target_url':'http://127.0.0.1:8765/product-demo.html','scope':'전체'}, 'baseline': {file.relative_to(ROOT).as_posix():digest(file) for file in files}, 'runs': []}
    save_json(MANIFEST, manifest)
    for label in ('A', 'B'):
        status, created = request('/runs', manifest['input'])
        assert status == 202 and created['status'] == 'queued'
        manifest['runs'].append({'label':label,'run_id':created['run_id'],'events':[]})
        save_json(MANIFEST, manifest)
        print('START',label,created['run_id'],flush=True)
    pending = list(manifest['runs'])
    deadline = time.monotonic() + 2400
    while pending:
        for item in list(pending):
            row = record_progress(manifest, item)
            if row['status'] not in {'queued','running'}:
                item['final_status'] = row['status']
                if row['executions']:
                    item['execution_id'] = row['executions'][0]['execution_id']
                pending.remove(item)
                save_json(MANIFEST, manifest)
        if not pending:
            break
        if time.monotonic() >= deadline:
            raise RuntimeError('전체 실행 제한 시간 초과. 진행 자료는 stage6-latest.json에 보관했습니다.')
        time.sleep(3)
    manifest['finished_at'] = datetime.now(timezone.utc).isoformat()
    save_json(MANIFEST, manifest)


def verify():
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    runs = manifest['runs']
    assert len(runs) == len({item['run_id'] for item in runs}) == 2
    for relative, sha in manifest['baseline'].items():
        assert digest(ROOT / relative) == sha, '이전 파일이 변경됐습니다: ' + relative
    for relative, sha in manifest.get('peer_after_completion', {}).items():
        assert digest(ROOT / relative) == sha, 'A 재실행이 B 자료를 바꿨습니다: ' + relative
    expected = {req['requirement_key']:req for req in _requirements('product','v1')}
    assert len(expected) == 75
    assert sum(req['requirement_id'] == 'BE_RECOMMEND_001' for req in expected.values()) == 2
    response_ids = set()
    thread_ids = set()
    summaries = []
    for item in runs:
        folder = ROOT / '.local/runs' / item['run_id']
        pipeline = json.loads((folder/'pipeline.json').read_text(encoding='utf-8'))
        assert pipeline['status'] == 'completed', item['label'] + ' pipeline.json 확인 필요'
        evidence = json.loads((folder/'evidence.json').read_text(encoding='utf-8'))
        spec = json.loads((folder/'test-spec.json').read_text(encoding='utf-8'))
        generation = json.loads((folder/'generation.json').read_text(encoding='utf-8'))
        assert pipeline['current_node'] == NODES[-1]
        assert evidence['requirement_count'] == 75
        assert {req['requirement_key'] for req in evidence['requirements']} == set(expected)
        assert {req['requirement_key'] for req in spec['requirements']} == set(expected)
        assert spec['run_id'] == generation['run_id'] == item['run_id']
        assert spec['response_ids'] and not response_ids.intersection(spec['response_ids'])
        response_ids.update(spec['response_ids'])
        assert generation['thread_id'] not in thread_ids
        thread_ids.add(generation['thread_id'])
        scenarios = {}
        for req in spec['requirements']:
            reference = expected[req['requirement_key']]
            assert req['source_text'] == reference['source_text'] and req['source_refs'] == reference['source_refs']
            for scenario in req['scenarios']:
                assert scenario['source_refs'] == req['source_refs']
                assert scenario['scenario_key'] not in scenarios
                assert scenario['expected_policy'] in {'allow','deny'}
                scenarios[scenario['scenario_key']] = scenario
        coverage = json.loads((folder/'generated-tests/coverage.json').read_text(encoding='utf-8'))['scenarios']
        assert len(coverage) == len({case['scenario_key'] for case in coverage}) == len(scenarios)
        assert {case['scenario_key'] for case in coverage} == set(scenarios)
        generated = {case['scenario_key'] for case in coverage if case['status'] == 'generated'}
        unsupported = {case['scenario_key'] for case in coverage if case['status'] == 'unsupported'}
        assert len(generated) == generation['discovered_test_count'] > 0
        assert all(case.get('reason') for case in coverage if case['status'] == 'unsupported')
        contracts = json.loads((folder/'generated-tests/observations.json').read_text(encoding='utf-8'))['scenarios']
        assert len(contracts) == len(generated) and {case['scenario_key'] for case in contracts} == generated
        eid = item['execution_id']
        execution_dir = folder/'executions'/eid
        raw = json.loads((execution_dir/'execution.json').read_text(encoding='utf-8'))
        report = request(f"/runs/{item['run_id']}/executions/{eid}/report")[1]
        assert report['run_id'] == raw['run_id'] == item['run_id']
        assert report['execution_id'] == raw['execution_id'] == eid
        assert raw['test_spec_sha256'] == digest(folder/'test-spec.json')
        assert {case['scenario_key'] for case in raw['cases']} == generated
        assert {case['scenario_key'] for case in raw['unexecuted']} == unsupported
        assert len(raw['cases']) == len(generated)
        assert report['summary']['capture_errors'] == report['summary']['execution_errors'] == 0
        assert report['summary']['executed'] + report['summary']['unexecuted'] == len(scenarios)
        for source in raw['test_sources']:
            snapshot = execution_dir/'test-source'/source['file']
            original = ROOT / source['file'] if source['file'] == 'playwright-observations.ts' else folder/'generated-tests'/source['file']
            assert digest(snapshot) == source['sha256'] == digest(original)
        for case in report['cases']:
            assert case['screenshot_files'] and case['observation']
            for image in case['screenshot_files']:
                file = (execution_dir/image['path']).resolve()
                assert file.is_relative_to(execution_dir.resolve())
                assert file.read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
                assert f"/runs/{item['run_id']}/executions/{eid}/files/" in image['url']
            if case['test_status'] in {'failed','timedOut'}:
                assert case['trace_files'] and case['errors']
        if item.get('initial_execution_id'):
            initial = folder/'executions'/item['initial_execution_id']
            initial_raw = json.loads((initial/'execution.json').read_text(encoding='utf-8'))
            for source in initial_raw['test_sources']:
                assert digest(initial/'test-source'/source['file']) == source['sha256']
        other = next(row for row in runs if row['run_id'] != item['run_id'])
        try:
            request(f"/runs/{other['run_id']}/executions/{eid}/report")
        except urllib.error.HTTPError as error:
            assert error.code == 404
        else:
            raise AssertionError('다른 작업의 실행 결과가 노출됐습니다.')
        summaries.append({'label':item['label'],'run_id':item['run_id'],'execution_id':eid,'requirements':75,'responses':len(spec['response_ids']),'spec_model':spec['model'],'codex_model':generation['model'],'summary':report['summary']})
    result = {'source_and_prior_runs_unchanged':True,'baseline_files':len(manifest['baseline']),'peer_unchanged_after_rerun':True if manifest.get('peer_after_completion') else None,'reviewed_generated_cases':sum(bool(item.get('review')) for item in runs),'duplicate_id_preserved':True,'fresh_api_calls':len(response_ids),'separate_codex_threads':len(thread_ids),'cross_run_access_rejected':True,'runs':summaries}
    save_json(ROOT/'.local/stage6-check.json',result)
    print('PASS: '+json.dumps(result,ensure_ascii=False),flush=True)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run',action='store_true',help='Start two real API/Codex pipelines before checking their results')
    args = parser.parse_args()
    if args.run:
        run_twice()
    verify()
