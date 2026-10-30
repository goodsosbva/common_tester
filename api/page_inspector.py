"""Capture the requested public page using a fresh browser context."""
import json
import os
import shutil
import subprocess
from pathlib import Path

from target_url import validate_target_url

ROOT = Path(__file__).resolve().parents[1]


def inspect_target(target_url: str, output: Path) -> dict:
    target_url = validate_target_url(target_url)
    node = shutil.which('node.exe') or shutil.which('node')
    if not node:
        raise RuntimeError('Node.js 실행 파일이 없습니다.')
    env = os.environ.copy()
    env.pop('OPENAI_API_KEY', None)
    try:
        result = subprocess.run([node, str(ROOT/'scripts/inspect-page.cjs'), target_url, str(output)], cwd=ROOT, env=env, capture_output=True, text=True, encoding='utf-8', timeout=60)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError(f'대상 화면 수집을 완료하지 못했습니다: {error}') from error
    if result.returncode:
        raise RuntimeError('대상 화면을 읽지 못했습니다: ' + result.stderr[-2500:])
    try:
        metadata = json.loads(result.stdout)
        validate_target_url(metadata['final_url'])
        return metadata
    except (KeyError, ValueError) as error:
        raise RuntimeError('대상 화면 수집 결과 형식이 올바르지 않습니다.') from error
