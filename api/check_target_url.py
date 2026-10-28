"""Check URL validation and callers without accessing an external host or model."""
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
import workflow
import playwright_runner
import codex_generator
from target_url import validate_target_url

valid=['http://localhost:8765/product-demo.html','http://127.0.0.1:8765/','https://example.com','https://shop.example.com/cart?item=1#details','http://192.168.1.5:8080/','http://[::1]:8765/']
invalid=['file:///C:/demo.html','javascript:alert(1)','ftp://example.com','https://','example.com','https://user:password@example.com','https://example.com:bad','http://example.com:0','http://[broken/','https://bad host.example/','https://example.com/\\bad','https://example.com/\npath']
for url in valid:
    assert validate_target_url(url)==url
    assert workflow._safe_target_url(url)==url
assert validate_target_url('  https://example.com/path  ')=='https://example.com/path'
for url in invalid:
    try:validate_target_url(url)
    except ValueError:pass
    else:raise AssertionError('Invalid URL accepted: '+url)

with TestClient(main.app) as client:
    with patch.object(main,'prepare_pipeline',return_value={'run_id':'a'*32}),patch.object(main,'execute_pipeline') as background:
        response=client.post('/api/runs',json={'product':'product','version':'v1','scope':'전체','target_url':'https://example.com'})
        assert response.status_code==202
        background.assert_called_once()
    for url in ['file:///C:/demo.html','https://user:password@example.com']:
        response=client.post('/api/runs',json={'product':'product','version':'v1','scope':'전체','target_url':url})
        assert response.status_code==400

# Reach the runner preflight with an HTTPS target, replacing all target access locally.
with tempfile.TemporaryDirectory() as temporary:
    folder=Path(temporary)
    (folder/'generated-tests').mkdir()
    (folder/'generated-tests/check.spec.ts').write_text('// URL acceptance check',encoding='utf-8')
    (folder/'test-spec.json').write_text(json.dumps({'target_url':'https://example.com','requirements':[]}),encoding='utf-8')
    with patch.object(playwright_runner,'run_folder',return_value=folder),patch.object(playwright_runner,'urlopen',side_effect=RuntimeError('TEST: target access replaced')) as probe:
        result=playwright_runner.run_playwright('a'*32)
        probe.assert_called_once_with('https://example.com',timeout=10)
        assert result['target_url']=='https://example.com' and result['error']=='TEST: target access replaced'
    # Check generation URL acceptance before it stops on an intentionally empty specification.
    nested=folder/'.local/runs'/('b'*32);nested.mkdir(parents=True)
    (nested/'test-spec.json').write_text(json.dumps({'target_url':'https://example.com','requirements':[]}),encoding='utf-8')
    with patch.object(codex_generator,'ROOT',folder):
        try:codex_generator.generate_playwright('b'*32)
        except ValueError as error:assert str(error)=='Playwright 코드로 바꿀 요구사항이 없습니다.'
        else:raise AssertionError('Expected empty-spec validation')
print('PASS: HTTP/HTTPS targets accepted by all three callers; malformed URLs rejected; no external connection or model call')
