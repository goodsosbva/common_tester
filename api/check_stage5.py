"""Verify real result classification, history APIs and background-job errors without model calls."""
import copy
import json
import tempfile
import uuid
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import core
import main
import results
import playwright_runner
import workflow

root = core.ROOT
latest = json.loads((root / '.local/stage5-latest.json').read_text(encoding='utf-8'))
run_id = latest['run_id']
folder = root / '.local/runs' / run_id
reports = {}
expected = {
    'normal': {'TP': 11, 'FN': 0, 'FP': 0, 'TN': 7},
    'email': {'TP': 10, 'FN': 1, 'FP': 0, 'TN': 7},
    'blank-accepted': {'TP': 11, 'FN': 0, 'FP': 1, 'TN': 6},
    'warning-color': {'TP': 11, 'FN': 0, 'FP': 0, 'TN': 7},
    'warning-position': {'TP': 11, 'FN': 0, 'FP': 0, 'TN': 7},
}
assert set(expected) == set(latest['executions'])
assert {node for node, _ in [('retrieve_evidence', 0), ('build_handoff', 0), ('generate_playwright', 0), ('run_playwright', 0), ('summarize_results', 0)]} <= set(workflow.WORKFLOW_GRAPH.get_graph().nodes)
for mode, quadrants in expected.items():
    report = results.summarize_results(run_id, latest['executions'][mode]['execution_id'])
    reports[mode] = report
    summary = report['summary']
    assert summary['quadrants'] == quadrants, (mode, summary)
    assert summary['executed'] == 20 and summary['unexecuted'] == 170 and summary['planned'] == 190
    assert summary['screenshots'] == 20 and summary['unconfirmed'] == 2
    assert summary['failed'] == (0 if mode == 'normal' else 1)
    assert summary['capture_errors'] == summary['execution_errors'] == 0
    assert len(report['unresolved']) == 113
    assert all(case['source_text'] and case['source_refs'] and case['situation'] and case['actions'] for case in report['cases'])
    assert all(item['reason'] and item['source_text'] for item in report['unexecuted'])
    if mode != 'normal':
        assert report['cases'][0]['verdict'] == 'failed'
        assert len(report['failures']) == 1 and report['failures'][0]['trace_files']
    for case in report['cases']:
        assert case['screenshot_files']
        for image in case['screenshot_files']:
            assert (folder / 'executions' / report['execution_id'] / image['path']).read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
    if mode.startswith('warning-'):
        assert report['failures'][0]['classification'] == 'TN'
        assert report['failures'][0]['actual_policy'] == 'deny'
assert len({json.dumps(report['test_sources'], sort_keys=True).replace(report['execution_id'], 'ID') for report in reports.values()}) == 1
for expected_policy, actual, quadrant in [('allow','allow','TP'), ('allow','deny','FN'), ('deny','allow','FP'), ('deny','deny','TN')]:
    assert results.classify(expected_policy, actual) == quadrant
    assert results.classify(expected_policy, actual, True) is None
assert results.classify('deny', 'unknown') is None

# An old execution without observations must stay unconfirmed even when assertions passed or failed.
stage4 = json.loads((root / '.local/stage4-latest.json').read_text(encoding='utf-8'))
legacy = results.summarize_results(run_id, stage4['executions']['warning-color']['execution_id'], publish=False)
assert legacy['summary']['quadrants'] == dict.fromkeys(['TP','FN','FP','TN'], 0)
assert legacy['summary']['unconfirmed'] == 20 and legacy['summary']['failed'] == 1

with TestClient(main.app) as client:
    history = client.get('/api/runs').json()
    assert any(item['run_id'] == run_id for item in history)
    detail = client.get(f'/api/runs/{run_id}').json()
    assert len(detail['executions']) >= 5 and detail['scenario_count'] == 190
    for mode, report in reports.items():
        prefix = f"/api/runs/{run_id}/executions/{report['execution_id']}"
        assert client.get(prefix + '/report').json()['summary'] == report['summary']
        assert client.get(report['cases'][0]['screenshot_files'][0]['url']).content.startswith(b'\x89PNG')
        assert client.get(prefix + '/files/..%5c..%5c..%5c..%5c.env').status_code == 404
        assert client.get(report['test_sources'][0]['url']).status_code == 200
    assert client.get('/api/runs/not-a-run').status_code == 404
    assert client.post(f'/api/runs/{run_id}/execute', json={'target_url':'file:///C:/invalid-target.html'}).status_code == 400
    assert client.post('/api/runs', json={'product':'product','version':'v1','target_url':'file:///C:/invalid-target.html','scope':'전체'}).status_code == 400
    assert client.post('/api/runs', json={'product':'../escape','version':'v1','target_url':'http://127.0.0.1:8765/','scope':'전체'}).status_code == 400
    with patch.object(main, 'prepare_pipeline', return_value={'run_id':'a'*32}) as prepare, patch.object(main, 'execute_pipeline') as execute:
        response = client.post('/api/runs', json={'product':'product','version':'v1','target_url':'http://127.0.0.1:8765/','scope':'전체'})
        assert response.status_code == 202 and response.json()['status'] == 'queued'
        prepare.assert_called_once(); execute.assert_called_once_with({'run_id':'a'*32})

# Isolate worker error/restart and infrastructure-error tests from real history.
with tempfile.TemporaryDirectory() as temporary:
    isolated = Path(temporary)
    fake_run = uuid.uuid4().hex
    fake_execution = uuid.uuid4().hex
    output = isolated / '.local/runs' / fake_run / 'executions' / fake_execution
    output.mkdir(parents=True)
    raw = json.loads((folder / 'executions' / latest['executions']['normal']['execution_id'] / 'execution.json').read_text(encoding='utf-8'))
    spec = json.loads((folder / 'test-spec.json').read_text(encoding='utf-8'))
    (output.parent.parent / 'test-spec.json').write_text(json.dumps(spec), encoding='utf-8')
    with patch.object(playwright_runner, 'ROOT', isolated), patch.object(results, 'ROOT', isolated), patch.object(workflow, 'ROOT', isolated):
        raw['status'] = 'execution_error'; raw['cases'] = []; raw['error'] = 'Connection refused'
        raw['counts']['screenshots'] = 0
        results.save_json(output / 'execution.json', raw)
        report = results.summarize_results(fake_run, fake_execution)
        assert report['summary']['execution_errors'] == 1 and not any(report['summary']['quadrants'].values())
        raw = json.loads((folder / 'executions' / latest['executions']['normal']['execution_id'] / 'execution.json').read_text(encoding='utf-8'))
        raw['cases'] = [copy.deepcopy(raw['cases'][0])]
        raw['cases'][0]['status'] = 'failed'
        raw['cases'][0]['errors'] = [{'message':'browserType.launch: browser not installed'}]
        results.save_json(output / 'execution.json', raw)
        report = results.summarize_results(fake_run, fake_execution)
        assert report['cases'][0]['classification'] is None and report['cases'][0]['verdict'] == 'execution_error'
        raw['cases'][0]['status'] = 'timedOut'
        raw['cases'][0]['errors'] = [{'message':'locator.selectOption: Test timeout of 30000ms exceeded'}]
        results.save_json(output / 'execution.json', raw)
        report = results.summarize_results(fake_run, fake_execution)
        assert report['cases'][0]['classification'] is None and report['cases'][0]['verdict'] == 'execution_error'
        pipeline_file = output.parent.parent / 'pipeline.json'
        results.save_json(pipeline_file, {'run_id':fake_run,'status':'queued'})
        workflow.interrupt_pending_runs()
        assert json.loads(pipeline_file.read_text())['status'] == 'error'
        with patch.object(workflow.WORKFLOW_GRAPH, 'invoke', side_effect=RuntimeError('worker fixture failure')):
            record = workflow.execute_pipeline({'run_id':fake_run})
            assert record['status'] == 'error' and record['error'] == 'worker fixture failure'
smoke = json.loads((root / '.local/stage5-generation-smoke.json').read_text(encoding='utf-8'))
smoke_folder = root / smoke['archive_path']
contracts = json.loads((smoke_folder / 'generated-tests/observations.json').read_text(encoding='utf-8'))['scenarios']
assert len(contracts) == smoke['generation']['discovered_test_count'] == 1
assert contracts[0]['kind'] == 'class' and contracts[0]['allow_class'] != contracts[0]['deny_class']
assert smoke['executions']['normal']['summary']['quadrants']['TN'] == 1
assert smoke['executions']['normal']['summary']['failed'] == 0
assert smoke['executions']['warning-color']['summary']['quadrants']['TN'] == 1
assert smoke['executions']['warning-color']['summary']['failed'] == 1
summary = {'graph_nodes':5,'real_browser_executions':5,'screenshots':100,'quadrants':True,'visual_failure_stays_TN':True,'legacy_not_guessed':True,'background_api':True,'worker_errors':True,'artifact_api':True,'codex_observation_generation':True}
results.save_json(root / '.local/stage5-check.json',summary)
print('PASS: ' + json.dumps(summary))
