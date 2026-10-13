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

    @unittest.skipUnless(os.name == "posix", "Controlling terminals are POSIX-only")
    def test_adapter_cannot_take_editors_controlling_terminal(self):
        import pty

        with tempfile.TemporaryDirectory() as root:
            mailbox = Path(subprocess.check_output(
                [sys.executable, str(BRIDGE), "prepare"], text=True).strip())
            result = Path(root) / "terminal.json"
            adapter = Path(root) / "terminal_adapter.py"
            adapter.write_text('''import json, os, signal, sys, time
from pathlib import Path
has_terminal = False
try:
    tty = os.open("/dev/tty", os.O_RDWR)
except OSError:
    pass
else:
    has_terminal = True
    os.setpgrp()
    signal.signal(signal.SIGTTOU, signal.SIG_IGN)
    os.tcsetpgrp(tty, os.getpgrp())
    os.close(tty)
result = Path(sys.argv[1])
temporary = result.with_suffix(".tmp")
temporary.write_text(json.dumps({"has_terminal": has_terminal, "sid": os.getsid(0)}))
temporary.replace(result)
time.sleep(60)
''')
            controller = Path(root) / "controller.py"
            controller.write_text('''import fcntl, json, os, subprocess, sys, termios, time
tty = int(sys.argv[1])
os.setsid()
fcntl.ioctl(tty, termios.TIOCSCTTY, 0)
foreground = os.tcgetpgrp(tty)
process = subprocess.Popen(sys.argv[3:])
try:
    deadline = time.monotonic() + 5
    while not os.path.exists(sys.argv[2]):
        if time.monotonic() > deadline:
            raise RuntimeError("Adapter did not report its terminal state")
        time.sleep(0.02)
    with open(sys.argv[2]) as source:
        result = json.load(source)
    result["controller_sid"] = os.getsid(0)
    result["foreground_unchanged"] = os.tcgetpgrp(tty) == foreground
    with open(sys.argv[2], "w") as output:
        json.dump(result, output)
finally:
    with open(os.path.join(sys.argv[6], "stop"), "w") as output:
        output.write("stop")
    process.wait(timeout=5)
''')
            master, slave = pty.openpty()
            try:
                subprocess.run(
                    [sys.executable, str(controller), str(slave), str(result),
                     sys.executable, str(BRIDGE), "serve", str(mailbox),
                     json.dumps([sys.executable, str(adapter), str(result)]), root],
                    pass_fds=(slave,), stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE, check=True, timeout=10)
                observed = json.loads(result.read_text())
                self.assertFalse(observed["has_terminal"])
                self.assertTrue(observed["foreground_unchanged"])
                self.assertNotEqual(observed["sid"], observed["controller_sid"])
                self.assertFalse(mailbox.exists())
            finally:
                os.close(master)
                os.close(slave)

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
