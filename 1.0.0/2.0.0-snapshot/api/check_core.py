import base64
import tempfile
from pathlib import Path

import core


def main():
    with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
        core.DATA = Path(directory)
        core.DB = core.DATA / "test.sqlite3"
        core.encoder = lambda: FakeEncoder()
        first = base64.b64encode(b"alpha target\n\nshared content").decode()
        second = base64.b64encode(b"beta exclusive\n\nshared content").decode()
        core.register("policy", "v1", "Version 1", "policy.md", first)
        core.register("policy", "v2", "Version 2", "policy.md", second)
        result = core.search("policy", "v1", "exclusive")
        assert result and all(item["source_id"].startswith("policy:v1:") for item in result)
        assert all("beta exclusive" not in item["content"] for item in result)
        try:
            core.register("policy", "v1", "Changed", "policy.md", second)
        except ValueError:
            pass
        else:
            raise AssertionError("Changed contents for existing version were accepted")
    print("document version isolation: PASS")


class FakeEncoder:
    def embed(self, items):
        for item in items:
            yield FakeVector([float("exclusive" in item), float("target" in item)])


class FakeVector(list):
    def tolist(self):
        return list(self)


if __name__ == "__main__":
    main()
