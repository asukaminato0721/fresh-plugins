"""Test framing and adapter cleanup without an editor process."""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

BRIDGE = Path(__file__).resolve().parents[1] / "dap_bridge.py"
spec = importlib.util.spec_from_file_location("dap_bridge", BRIDGE)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BridgeTests(unittest.TestCase):
    def test_utf8_and_multiple_frames(self):
        messages = [{"type": "event", "body": {"output": "输出 café\n"}}, {"seq": 2}]
        frames = b""
        for message in messages:
            body = json.dumps(message, ensure_ascii=False).encode()
            frames += f"Content-Length: {len(body)}\r\n\r\n".encode() + body
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            bridge.read_messages(io.BytesIO(frames))
        self.assertEqual([json.loads(line) for line in output.getvalue().splitlines()], messages)

    def test_invalid_and_incomplete_frames(self):
        for frame, error in [(b"Content-Length: -1\r\n\r\n", ValueError),
                             (b"Content-Length: 5\r\n\r\n{}", EOFError)]:
            with self.assertRaises(error):
                bridge.read_messages(io.BytesIO(frame))

    def test_cleanup_after_stop_and_forced_supervisor_exit(self):
        for forced in (False, True):
            with self.subTest(forced=forced), tempfile.TemporaryDirectory() as root:
                mailbox = Path(subprocess.check_output(
                    [sys.executable, str(BRIDGE), "prepare"], text=True).strip())
                pid = Path(root) / "adapter.pid"
                command = [sys.executable, str(Path(__file__).with_name("fake_adapter.py")),
                           str(Path(root) / "source.py"), str(Path(root) / "log"), str(pid)]
                process = subprocess.Popen([sys.executable, str(BRIDGE), "serve", str(mailbox),
                                            json.dumps(command), root],
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    self.wait_for(pid.exists)
                    adapter_pid = int(pid.read_text())
                    if forced:
                        process.kill()
                    else:
                        (mailbox / "stop").write_text("stop")
                    process.wait(timeout=5)
                    self.wait_for(lambda: not mailbox.exists())
                    self.wait_for(lambda: not self.alive(adapter_pid))
                finally:
                    if process.poll() is None:
                        process.kill()
                        process.wait()
                    process.stdout.close()
                    process.stderr.close()

    def test_stop_when_adapter_does_not_read_input(self):
        with tempfile.TemporaryDirectory() as root:
            mailbox = Path(subprocess.check_output(
                [sys.executable, str(BRIDGE), "prepare"], text=True).strip())
            command = [sys.executable, "-c", "import time; time.sleep(60)"]
            process = subprocess.Popen([sys.executable, str(BRIDGE), "serve", str(mailbox),
                                        json.dumps(command), root],
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                request = mailbox / "request.tmp"
                request.write_text(json.dumps({"arguments": "x" * 1024 * 1024}))
                request.replace(mailbox / "1.json")
                self.wait_for(lambda: not (mailbox / "1.json").exists())
                (mailbox / "stop").write_text("stop")
                process.wait(timeout=5)
                self.assertFalse(mailbox.exists())
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                process.stdout.close()
                process.stderr.close()

    @staticmethod
    def alive(pid):
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False

    @staticmethod
    def wait_for(predicate):
        deadline = time.monotonic() + 5
        while not predicate():
            if time.monotonic() > deadline:
                raise AssertionError("Timed out waiting for bridge cleanup")
            time.sleep(0.02)


if __name__ == "__main__":
    unittest.main()
