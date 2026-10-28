"""Verify actual-page references, empty coverage, and generic requirement parsing."""
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import codex_generator
import playwright_runner
import results
import workflow
from page_inspector import inspect_target

rows=workflow._requirements('portfolio','v1')
assert len(rows)==6 and all('@requirements.md:' in row['requirement_key'] for row in rows)
old=workflow._requirements('product','v1')
assert len(old)==75 and sum(row['requirement_id']=='BE_RECOMMEND_001' for row in old)==2
with tempfile.TemporaryDirectory() as directory:
    with patch.object(workflow,'_progress'):
        evidence=workflow.retrieve_evidence({'run_id':'a'*32,'output_dir':directory,'product':'portfolio','version':'v1','scope':'CONNECT_006'})['evidence']
        assert evidence['requirement_count']==1 and evidence['requirements'][0]['requirement_id']=='CONNECT_006'
    captured=inspect_target('http://127.0.0.1:8765/product-demo.html',Path(directory)/'capture')
    reference=json.loads((Path(directory)/'capture/target-page.json').read_text(encoding='utf-8'))
    html=(Path(directory)/'capture/target-page.html').read_text(encoding='utf-8')
    assert captured['http_status']==200 and reference['elements'] and reference['accessibility']
    assert '<script' not in html and '<style' not in html

class FakeServer:
    def __init__(self,cwd):pass
    def generate(self,prompt,cwd):
        assert '.page-reference.json' in prompt
        assert (cwd/'.app-reference.html').read_text(encoding='utf-8')=='<main><h1>Actual target fixture</h1></main>'
        assert json.loads((cwd/'.page-reference.json').read_text())['final_url']=='https://example.com/'
        (cwd/'coverage.json').write_text(json.dumps({'scenarios':[{'scenario_key':'CASE-1','status':'unsupported','reason':'Required form is not present on captured page'}]}),encoding='utf-8')
        (cwd/'observations.json').write_text('{"scenarios":[]}',encoding='utf-8')
        return 'fixture-thread','fixture summary','fixture-model'
    def close(self):pass

def fake_capture(url,folder):
    metadata={'requested_url':url,'final_url':url,'title':'Actual target fixture','http_status':200}
    (folder/'target-page.html').write_text('<main><h1>Actual target fixture</h1></main>',encoding='utf-8')
    (folder/'target-page.json').write_text(json.dumps(metadata),encoding='utf-8')
    return metadata

with tempfile.TemporaryDirectory() as directory:
    root=Path(directory);rid='a'*32;folder=root/'.local/runs'/rid;folder.mkdir(parents=True)
    spec={'run_id':rid,'product':'test','version':'v1','scope':'all','target_url':'https://example.com/','requirements':[{'requirement_key':'REQ','requirement_id':'REQ','title':'Required form','source_text':'A form is required.','source_refs':[{'path':'requirements.md','paragraph_no':1,'chunk_no':1}],'scenarios':[{'scenario_key':'CASE-1','expected_policy':'allow','expected_observation':'Form is available.','situation':'Form access','actions':['Open form'],'source_refs':[{'path':'requirements.md','paragraph_no':1,'chunk_no':1}]}]}],'unresolved':[]}
    (folder/'test-spec.json').write_text(json.dumps(spec),encoding='utf-8')
    with patch.object(codex_generator,'ROOT',root),patch.object(codex_generator,'inspect_target',side_effect=fake_capture),patch.object(codex_generator,'CodexAppServer',FakeServer):
        generation=codex_generator.generate_playwright(rid)
    assert generation['status']=='unsupported' and generation['discovered_test_count']==0
    assert generation['target_snapshot']['final_url']==spec['target_url']
    assert not list((folder/'generated-tests').glob('.*input*'))
    assert not (folder/'generated-tests/.app-reference.html').exists()
    with patch.object(playwright_runner,'ROOT',root),patch.object(results,'ROOT',root),patch.object(playwright_runner,'urlopen') as access:
        execution=playwright_runner.run_playwright(rid)
        assert execution['status']=='not_run' and execution['counts']['total']==0
        assert execution['counts']['unexecuted']==1
        access.assert_not_called()
        report=results.summarize_results(rid,execution['execution_id'])
        assert report['status']=='not_run' and report['summary']['test_passed']==0 and not any(report['summary']['quadrants'].values())
    (folder/'generated-tests/coverage.json').write_text('{"scenarios":[]}',encoding='utf-8')
    with patch.object(playwright_runner,'ROOT',root):
        try:playwright_runner.run_playwright(rid)
        except ValueError:pass
        else:raise AssertionError('Missing coverage accepted without tests')
print('PASS: live reference, generic text IDs, old PDF IDs, unsupported-only generation and report, no target access for zero tests')
