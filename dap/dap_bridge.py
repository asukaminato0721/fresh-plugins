"""DAP stdio transport for Fresh's existing process and file APIs."""

from __future__ import annotations

import json
import os
from pathlib import Path
import queue
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time


def emit(message: dict) -> None:
    # Fresh's background-process API delivers complete output lines.
    print(json.dumps(message, ensure_ascii=True), flush=True)


def read_messages(stream) -> None:
    while True:
        length = None
        while True:
            line = stream.readline()
            if not line:
                return
            if line.lower().startswith(b"content-length:"):
                length = int(line.split(b":", 1)[1].strip())
            if line in (b"\r\n", b"\n"):
                break
        if length is None or not 0 <= length <= 32 * 1024 * 1024:
            raise ValueError("Invalid DAP Content-Length")
        body = bytearray()
        while len(body) < length:
            chunk = stream.read(length - len(body))
            if not chunk:
                raise EOFError("Adapter closed an incomplete DAP message")
            body.extend(chunk)
        emit(json.loads(body))


def worker(mailbox: Path, command: list[str], cwd: str) -> int:
    parent = os.getppid()
    adapter = None
    reader_error: list[Exception] = []
    stopping = threading.Event()

    def stop_signal(_signal, _frame):
        stopping.set()

    signal.signal(signal.SIGTERM, stop_signal)
    signal.signal(signal.SIGINT, stop_signal)
    try:
        adapter = subprocess.Popen(
            command,
            cwd=cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            bufsize=0,
            # Keep diagnostic output separate from protocol messages.
            stderr=sys.stderr,
            # Adapters such as debugpy can change their session's foreground
            # process group through /dev/tty. They must not share Fresh's
            # controlling terminal, even when all standard streams are pipes.
            start_new_session=(os.name == "posix"),
        )

        def read_output():
            try:
                read_messages(adapter.stdout)
            except Exception as error:
                reader_error.append(error)
            finally:
                stopping.set()

        reader = threading.Thread(target=read_output, daemon=True)
        reader.start()
        requests: queue.Queue[bytes] = queue.Queue()

        def write_input():
            try:
                while not stopping.is_set():
                    try:
                        frame = memoryview(requests.get(timeout=0.05))
                    except queue.Empty:
                        continue
                    while frame:
                        written = adapter.stdin.write(frame)
                        if not written:
                            raise EOFError("Adapter closed its input")
                        frame = frame[written:]
            except Exception as error:
                reader_error.append(error)
                stopping.set()

        # A blocked adapter input must not block shutdown supervision.
        writer = threading.Thread(target=write_input, daemon=True)
        writer.start()
        request_index = 1
        started = time.time()
        while adapter.poll() is None and not stopping.is_set():
            # The supervisor can be killed when Fresh unloads the plugin.
            if os.getppid() != parent:
                break
            heartbeat = mailbox / "heartbeat"
            last_alive = heartbeat.stat().st_mtime if heartbeat.exists() else started
            if time.time() - last_alive > 15:
                break
            if (mailbox / "stop").exists():
                break
            path = mailbox / f"{request_index}.json"
            if path.exists():
                message = json.loads(path.read_text(encoding="utf-8"))
                body = json.dumps(message, ensure_ascii=False).encode("utf-8")
                requests.put(f"Content-Length: {len(body)}\r\n\r\n".encode("ascii") + body)
                path.unlink()
                request_index += 1
            else:
                stopping.wait(0.02)
        if adapter.poll() is not None:
            reader.join(timeout=1)
            if reader_error:
                raise reader_error[0]
            return adapter.returncode or 0
        if reader_error:
            raise reader_error[0]
        return 0
    finally:
        if adapter is not None:
            if adapter.poll() is None:
                adapter.terminate()
                try:
                    adapter.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    adapter.kill()
                    adapter.wait()
            adapter.stdin.close()
            adapter.stdout.close()
        shutil.rmtree(mailbox, ignore_errors=True)


def main() -> int:
    if sys.argv[1] == "prepare":
        print(tempfile.mkdtemp(prefix="fresh-dap-"))
        return 0
    mailbox = Path(sys.argv[2])
    if sys.argv[1] == "cleanup":
        shutil.rmtree(mailbox, ignore_errors=True)
        return 0
    if sys.argv[1] == "worker":
        return worker(mailbox, json.loads(sys.argv[3]), sys.argv[4])
    # The worker supervises the adapter. It survives a forced supervisor kill
    # long enough to terminate the adapter and remove the temporary mailbox.
    child = subprocess.Popen(
        [sys.executable, __file__, "worker", *sys.argv[2:]],
        stdin=subprocess.DEVNULL,
    )

    def stop_signal(_signal, _frame):
        child.terminate()

    signal.signal(signal.SIGTERM, stop_signal)
    signal.signal(signal.SIGINT, stop_signal)
    return child.wait()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"DAP bridge: {error}", file=sys.stderr, flush=True)
        raise SystemExit(1)
