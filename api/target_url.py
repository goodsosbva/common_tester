"""Validate target URL syntax without connecting to the target."""
from urllib.parse import urlsplit


def validate_target_url(value: str) -> str:
    value = value.strip()
    try:
        parsed = urlsplit(value)
        port = parsed.port
        valid = parsed.scheme in {'http', 'https'} and bool(parsed.hostname)
        valid = valid and parsed.username is None and parsed.password is None
        valid = valid and not any(char.isspace() or ord(char) < 32 for char in value) and '\\' not in value
        valid = valid and port != 0
    except ValueError:
        valid = False
    if not valid:
        raise ValueError('테스트 주소는 호스트가 있는 HTTP 또는 HTTPS URL이어야 합니다. 주소에 계정 정보는 넣을 수 없습니다.')
    return value
