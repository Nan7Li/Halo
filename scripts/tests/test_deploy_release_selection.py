#!/usr/bin/env python3
"""Exercise the deploy script with release fixtures; never install or download binaries."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "deploy-cellbridge-nas.sh"
FORMAL = "halo-1.2.0-cellbridge"
PREVIEW = "halo-1.1.15-cellbridge-preview.20261109165738"


class ReleaseSelectionTest(unittest.TestCase):
    def select(self, releases, preview=False):
        with tempfile.TemporaryDirectory(prefix="halo-deploy-test-", dir=os.environ.get("TMPDIR") or os.environ.get("RUNNER_TEMP")) as tmp:
            root = Path(tmp)
            tools = root / "bin"
            tools.mkdir()
            fixture = root / "releases.json"
            fixture.write_text(json.dumps(releases))
            shim = "#!" + sys.executable + "\n" + '''import json, os, pathlib, sys, tempfile
name = pathlib.Path(sys.argv[0]).name
if name == "id":
    print("0")
elif name == "apt-get":
    pass
elif name == "uname":
    print("Linux" if "-s" in sys.argv else "x86_64")
elif name == "sed":
    # The deployment target is Debian 13; CI itself may run Ubuntu.
    if sys.argv[-1] != "/etc/os-release":
        raise RuntimeError("unexpected sed invocation")
    print("debian" if any("s/^ID=" in arg for arg in sys.argv) else "13")
elif name == "mktemp":
    print(tempfile.mkdtemp(prefix="stage-", dir=os.environ["HALO_TEST_ROOT"]))
elif name == "curl":
    from urllib.parse import urlsplit, parse_qs
    args = sys.argv[1:]
    url = next(a for a in args if a.startswith("https://"))
    if "/releases?" not in url:
        sys.exit(22)  # Stop before any binary download or installer execution.
    query = parse_qs(urlsplit(url).query)
    page = int(query.get("page", ["1"])[0])
    size = int(query["per_page"][0])
    data = json.loads(pathlib.Path(os.environ["HALO_TEST_RELEASES"]).read_text())
    pathlib.Path(args[args.index("--output") + 1]).write_text(json.dumps(data[(page-1)*size:page*size]))
else:
    raise RuntimeError(name)
'''
            for command in ("id", "apt-get", "uname", "sed", "mktemp", "curl"):
                path = tools / command
                path.write_text(shim)
                path.chmod(0o755)
            env = dict(os.environ, PATH=str(tools) + os.pathsep + os.environ["PATH"],
                       HALO_TEST_ROOT=str(root), HALO_TEST_RELEASES=str(fixture))
            result = subprocess.run(["bash", str(SCRIPT)] + (["--preview"] if preview else []),
                                    env=env, text=True, capture_output=True, timeout=20)
            self.assertNotEqual(result.returncode, 0, "fixture must stop before installation")
            return result.stdout + result.stderr

    @staticmethod
    def release(tag, prerelease=False, draft=False):
        return {"tag_name": tag, "prerelease": prerelease, "draft": draft}

    def test_nas_formal_release_preserves_stable_latest(self):
        workflow = (SCRIPT.parents[1] / ".github/workflows/cellbridge-nas.yml").read_text()
        self.assertIn("-F draft=false -F prerelease=false -f make_latest=false", workflow)

    def test_stable_binaries_explicitly_publish_as_latest(self):
        workflow = (SCRIPT.parents[1] / ".github/workflows/release.yml").read_text()
        self.assertIn("--draft=false --prerelease=false --latest=true", workflow)

    def test_default_prefers_formal(self):
        output = self.select([self.release(PREVIEW, True), self.release(FORMAL)])
        self.assertIn("正在下载 " + FORMAL + " 并校验", output)

    def test_preview_flag_excludes_formal(self):
        output = self.select([self.release(FORMAL), self.release(PREVIEW, True)], preview=True)
        self.assertIn("正在下载 " + PREVIEW + " 并校验", output)

    def test_formal_beyond_first_page_is_not_missed(self):
        releases = [self.release(f"halo-1.3.0-cellbridge-preview.{i}", True) for i in range(100)]
        output = self.select(releases + [self.release(FORMAL)])
        self.assertIn("正在下载 " + FORMAL + " 并校验", output)

    def test_default_falls_back_to_preview_only_without_formal(self):
        output = self.select([self.release(PREVIEW, True)])
        self.assertIn("正在下载 " + PREVIEW + " 并校验", output)

    def test_preview_flag_does_not_silently_install_formal(self):
        output = self.select([self.release(FORMAL)], preview=True)
        self.assertNotIn("正在下载 " + FORMAL, output)
        self.assertIn("没有可安装", output)


if __name__ == "__main__":
    unittest.main()
