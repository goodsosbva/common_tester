"""Reject fabricated citations, retry only the failing batch once, preserve rejected output."""
import copy
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
import workflow

folder=workflow.ROOT/'.local/runs/70f5e9aa1507422c87a34e8b3f2ca2b9'
evidence=json.loads((folder/'evidence.json').read_text(encoding='utf-8'))
evidence['requirements']=evidence['requirements'][:1]
evidence['requirement_count']=1
spec=json.loads((folder/'test-spec.json').read_text(encoding='utf-8'))
req=spec['requirements'][0]
good={'requirements':[{'requirement_key':req['requirement_key'],'scenarios':[req['scenarios'][0]],'unresolved':[]}],'unresolved':[]}
bad=copy.deepcopy(good);bad['requirements'][0]['scenarios'][0]['source_refs'][0]['paragraph_no']=999999
usage={'input_tokens':3,'output_tokens':5}
with tempfile.TemporaryDirectory() as temp:
    state={'run_id':'a'*32,'output_dir':temp,'product':'product','version':'v1','target_url':'http://127.0.0.1:8765/product-demo.html','scope':'전체','evidence':evidence}
    with patch.object(workflow,'_progress'),patch.object(workflow,'_openai_spec',side_effect=[(bad,'test','rejected',usage),(good,'test','accepted',usage)]) as model:
        result=workflow.build_handoff(state)['test_spec']
        assert model.call_count==2
        assert 'validation_feedback' in model.call_args_list[1].args[0]
        assert result['requirements'][0]['scenarios'][0]['source_refs']==req['source_refs']
        assert result['response_ids']==['rejected','accepted']
        assert result['usage']=={'input_tokens':6,'output_tokens':10}
        assert (Path(temp)/'revisions/spec-validation/batch-1-attempt-1.json').is_file()
    with patch.object(workflow,'_progress'),patch.object(workflow,'_openai_spec',return_value=(bad,'test','bad',usage)) as model:
        try:workflow.build_handoff(state)
        except RuntimeError as error:assert '재요청 후에도' in str(error)
        else:raise AssertionError('Invalid citations were accepted')
        assert model.call_count==2
    missing=copy.deepcopy(good);missing['requirements']=[]
    try:workflow._validate_spec_batch(missing,[req['requirement_key']],{req['requirement_key']:evidence['requirements'][0]})
    except RuntimeError:pass
    else:raise AssertionError('Missing requirement was accepted')
print('PASS: invalid citation rejected, one retry, bounded failure, rejected response retained')
