"""A stdio DAP fixture with fragmented frames and deferred launch responses."""

import json
import os
from pathlib import Path
import sys
import time

source, log_path, pid_path = sys.argv[1:4]
Path(pid_path).write_text(str(os.getpid()))
launch = None
line = 3
sequence = 100


def send(message):
    global sequence
    sequence += 1
    body = json.dumps({"seq": sequence, **message}, ensure_ascii=False).encode()
    frame = f"Content-Length: {len(body)}\r\n\r\n".encode() + body
    # Split headers and UTF-8 payloads across writes.
    for index in range(0, len(frame), 7):
        sys.stdout.buffer.write(frame[index:index + 7])
        sys.stdout.buffer.flush()


def respond(request, body=None):
    send({"type": "response", "request_seq": request["seq"],
          "command": request["command"], "success": True, "body": body or {}})


def event(name, body=None):
    send({"type": "event", "event": name, "body": body or {}})


while True:
    length = None
    while True:
        header = sys.stdin.buffer.readline()
        if not header:
            raise SystemExit(0)
        if header.lower().startswith(b"content-length:"):
            length = int(header.split(b":")[1])
        if header == b"\r\n":
            break
    request = json.loads(sys.stdin.buffer.read(length))
    with open(log_path, "a", encoding="utf-8") as log:
        log.write(json.dumps(request, ensure_ascii=False) + "\n")
    if request["type"] != "request":
        continue
    command = request["command"]
    if command == "initialize":
        respond(request, {"supportsConfigurationDoneRequest": True})
        event("output", {"output": "输出 café\n", "category": "console"})
        print("adapter diagnostic", file=sys.stderr, flush=True)
        send({"type": "request", "command": "runInTerminal", "arguments": {}})
    elif command in ("launch", "attach"):
        launch = request
        event("initialized")
    elif command == "setBreakpoints":
        respond(request, {"breakpoints": [
            {"verified": True, **point} for point in request["arguments"]["breakpoints"]]})
    elif command == "configurationDone":
        respond(request)
        respond(launch)
        event("stopped", {"reason": "breakpoint"})  # Exercise thread discovery.
    elif command == "threads":
        respond(request, {"threads": [{"id": 1, "name": "main"}]})
    elif command == "stackTrace":
        respond(request, {"stackFrames": [{"id": 1, "name": "测试", "line": line,
                    "column": 1, "source": {"path": source}}]})
    elif command == "continue":
        respond(request)
        event("continued", {"threadId": 1})
    elif command in ("pause", "next", "stepIn", "stepOut"):
        line += 1
        respond(request)
        event("stopped", {"reason": "step", "threadId": 1})
    elif command == "disconnect":
        if len(sys.argv) > 4 and sys.argv[4] == "ignore-disconnect":
            continue
        respond(request)
        event("terminated")
        time.sleep(0.02)
        break
    else:
        send({"type": "response", "command": command, "request_seq": request["seq"],
              "success": False, "message": "Unknown command"})
