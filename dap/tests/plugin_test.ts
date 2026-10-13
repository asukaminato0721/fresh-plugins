// Run the actual plugin with existing API methods and a real bridge process.
const pluginDir = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const pluginUrl = new URL("../dap.ts", import.meta.url).href;

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for plugin state");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

Deno.test("DAP commands use the current API and clean up an unresponsive adapter", async () => {
  const root = Deno.makeTempDirSync({ prefix: "fresh-dap-test-" });
  const source = `${root}/测试.py`;
  const logPath = `${root}/requests.jsonl`;
  const pidPath = `${root}/adapter.pid`;
  const handlers = new Map<string, () => unknown>();
  const hooks = new Map<string, (args: any) => void>();
  const commands: string[] = [];
  const diagnostics: string[] = [];
  const timers = new Set<ReturnType<typeof setInterval>>();
  const markers = new Map<string, number[]>();
  let state: unknown;
  let cursorLine = 2;
  let status = "";
  let openedLine = 0;
  let mailbox = "";
  let processResult: Promise<unknown> | null = null;
  let activeBuffer = 1;
  let activeSplit = 1;
  let panelExists = false;
  let panelCreates = 0;
  let panelSplitCloses = 0;
  let panelEntries: any[] = [];
  const panelText = () => panelEntries.map((entry) => entry.text).join("");
  const panelRow = (name: string) =>
    panelText().split("\n").findIndex((line) => line.includes(name));
  const settings = {
    adapters: [{
      type: "fake",
      command: "python3",
      args: [
        `${pluginDir}/tests/fake_adapter.py`,
        source,
        logPath,
        pidPath,
        "ignore-disconnect",
      ],
    }],
  };
  Deno.mkdirSync(`${root}/.vscode`);
  Deno.writeTextFileSync(source, "one\ntwo\nthree\nfour\nfive\nsix\n");
  Deno.writeTextFileSync(
    `${root}/.vscode/launch.json`,
    JSON.stringify({
      configurations: [{
        name: "Fake",
        type: "fake",
        request: "launch",
        program: "${file}",
      }],
    }),
  );
  function write(
    path: string | { value: string },
    text: string,
    replace: boolean,
  ) {
    const file = typeof path === "string" ? path : path.value;
    try {
      if (!replace) {
        try {
          Deno.statSync(file);
          return false;
        } catch { /* new file */ }
      }
      Deno.writeTextFileSync(`${file}.tmp`, text);
      Deno.renameSync(`${file}.tmp`, file);
      return true;
    } catch {
      return false;
    }
  }
  const editor = {
    getPluginConfig: () => settings,
    getPluginDir: () => pluginDir,
    getCwd: () => root,
    pathJoin: (...parts: string[]) => parts.join("/"),
    localPath: (value: string) => ({ kind: "local", value }),
    readFile: (path: string) => Deno.readTextFileSync(path),
    writeFile: (path: any, text: string) => write(path, text, false),
    replaceFile: (path: any, text: string) => write(path, text, true),
    parseJsonc: (text: string) => JSON.parse(text),
    getGlobalState: () => state,
    setGlobalState: (_key: string, value: unknown) => {
      state = value;
      return true;
    },
    getActiveBufferId: () => activeBuffer,
    getActiveSplitId: () => activeSplit,
    getBufferPath: (id: number) => id === 1 ? source : "",
    getPrimaryCursor: () => ({ line: cursorLine }),
    listBuffers: () => [
      { id: 1, path: source, modified: true, is_virtual: false },
      ...(panelExists
        ? [{ id: 2, path: "", modified: false, is_virtual: true }]
        : []),
    ],
    listSplits: () => [
      { splitId: 1, bufferId: 1 },
      ...(panelExists ? [{ splitId: 2, bufferId: 2 }] : []),
    ],
    defineMode: () => true,
    createVirtualBufferInSplit: async (opts: any) => {
      assert(opts.direction === "vertical", "Variables open beside the source");
      assert(opts.readOnly && opts.editingDisabled, "Variables are read-only");
      panelCreates++;
      panelExists = true;
      activeBuffer = 2;
      activeSplit = 2;
      panelEntries = opts.entries;
      return { bufferId: 2, splitId: 2 };
    },
    setVirtualBufferContent: (_id: number, entries: any[]) => {
      panelEntries = entries;
      return true;
    },
    focusSplit: (id: number) => {
      activeSplit = id;
      activeBuffer = id;
      return true;
    },
    showBuffer: (id: number) => {
      activeBuffer = id;
      return true;
    },
    closeSplit: (id: number) => {
      assert(id === 2, "Close only the variables pane");
      panelSplitCloses++;
      activeBuffer = 1;
      activeSplit = 1;
      return true;
    },
    closeBuffer: (id: number) => {
      assert(id === 2, "Close only the variables buffer");
      panelExists = false;
      activeBuffer = 1;
      activeSplit = 1;
      hooks.get("buffer_closed")?.({ buffer_id: id });
      return true;
    },
    clearLineIndicators: (_id: number, ns: string) => markers.delete(ns),
    setLineIndicator: (_id: number, line: number, ns: string) =>
      markers.set(ns, [line]),
    setLineIndicators: (_id: number, lines: number[], ns: string) =>
      markers.set(ns, lines),
    openFile: (_path: string, line: number) => {
      assert(
        activeBuffer !== 2,
        "Source navigation must not replace the variables buffer",
      );
      openedLine = line;
      return true;
    },
    openFileInSplit: (id: number, _path: string, line: number) => {
      assert(id === 1, "Stepping from variables targets the source pane");
      openedLine = line;
      return true;
    },
    debug: (message: string) => diagnostics.push(message),
    setStatus: (message: string) => {
      status = message;
    },
    registerCommand: (name: string) => commands.push(name),
    on: (event: string, handler: (args: any) => void) =>
      hooks.set(event, handler),
    setInterval: (ms: number, name: string) => {
      const id = setInterval(() => handlers.get(name)!(), ms);
      timers.add(id);
      return id;
    },
    clearInterval: (id: ReturnType<typeof setInterval>) => {
      clearInterval(id);
      timers.delete(id);
      return true;
    },
    // The test does not need the three-second fallback delay after normal cleanup.
    delay: (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, Math.min(ms, 100))),
    spawnProcess: (command: string, args: string[], cwd: string) => {
      return new Deno.Command(command, { args, cwd }).output().then(
        (output) => {
          const stdout = new TextDecoder().decode(output.stdout);
          if (args[1] === "prepare") mailbox = stdout.trim();
          return {
            exit_code: output.code,
            stdout,
            stderr: new TextDecoder().decode(output.stderr),
          };
        },
      );
    },
    spawnBackgroundProcess: (command: string, args: string[], cwd: string) => {
      const child = new Deno.Command(command, {
        args,
        cwd,
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      async function pump(stream: ReadableStream<Uint8Array>, event: string) {
        let pending = "";
        for await (const text of stream.pipeThrough(new TextDecoderStream())) {
          pending += text;
          const lines = pending.split("\n");
          pending = lines.pop()!;
          for (const line of lines) {
            hooks.get(event)?.({ process_id: child.pid, data: `${line}\n` });
          }
        }
      }
      const result = Promise.all([
        child.status,
        pump(child.stdout, "onProcessStdout"),
        pump(child.stderr, "onProcessStderr"),
      ]).then(([result]) => ({ exit_code: result.code }));
      processResult = result;
      return {
        processId: child.pid,
        result,
        then: result.then.bind(result),
        kill: async () => {
          try {
            child.kill();
            return true;
          } catch {
            return false;
          }
        },
      };
    },
  };
  (globalThis as any).getEditor = () => editor;
  (globalThis as any).registerHandler = (
    name: string,
    handler: () => unknown,
  ) => handlers.set(name, handler);
  const requests = () =>
    Deno.readTextFileSync(logPath).trim().split("\n").map((line) =>
      JSON.parse(line)
    );
  const run = async (name: string) => await handlers.get(name)!();
  try {
    await import(pluginUrl);
    assert(commands.length === 9, "Register execution and variables commands");
    await run("dap_toggle_breakpoint");
    assert(
      markers.get("dap-breakpoints")?.[0] === 2,
      "Breakpoint indicator is zero-based",
    );
    await Promise.all([run("dap_start"), run("dap_start")]);
    await waitFor(() => openedLine === 3);
    await waitFor(() => panelText().includes("count = 3 : int"));
    assert(
      panelCreates === 1 && activeBuffer === 1,
      "Automatic variables panel preserves source focus",
    );
    assert(
      !requests().some((r) =>
        r.command === "variables" && r.arguments.variablesReference === 32
      ),
      "Expensive scopes stay lazy",
    );
    assert(
      panelEntries.some((entry) => entry.style?.fg === "syntax.type"),
      "Types use theme colors",
    );
    assert(
      markers.get("dap-execution")?.[0] === 2,
      "Stopped frame indicator uses the source line",
    );
    const initial = requests();
    const order = initial.filter((r) => r.type === "request").map((r) =>
      r.command
    );
    assert(
      order.indexOf("setBreakpoints") < order.indexOf("configurationDone"),
      "Send breakpoints before configurationDone",
    );
    assert(
      initial.find((r) => r.command === "launch").arguments.program === source,
      "Expand Unicode source path",
    );
    assert(
      initial.find((r) => r.command === "setBreakpoints").arguments
        .sourceModified,
      "Report unsaved source changes",
    );
    assert(
      diagnostics.some((s) => s.includes("输出 café")),
      "Preserve Unicode adapter output",
    );
    assert(
      initial.some((r) =>
        r.type === "response" && r.command === "runInTerminal" && !r.success
      ),
      "Reject unsupported reverse requests",
    );
    cursorLine = 4;
    await run("dap_toggle_breakpoint");
    assert(
      markers.get("dap-breakpoints")?.join() === "2,4",
      "Update breakpoints during a session",
    );
    await run("dap_variables");
    cursorLine = panelRow("数据");
    await run("dap_variables_toggle");
    assert(
      panelText().includes("café = hello world : list"),
      "Render Unicode names and multiline values on one row",
    );
    cursorLine = panelRow("café");
    await run("dap_variables_expand");
    assert(
      panelText().includes("[0] = 42 : int"),
      "Expand nested array children",
    );
    await run("dap_variables_collapse");
    assert(!panelText().includes("[0] ="), "Collapse removes child rows");
    cursorLine = panelRow("retry");
    await run("dap_variables_toggle");
    assert(
      panelText().includes("Temporary variable error"),
      "Show adapter variable errors",
    );
    await run("dap_variables_toggle");
    assert(panelText().includes("retried = ok"), "Retry a failed expansion");
    hooks.get("mouse_click")!({
      button: "left",
      buffer_id: 2,
      buffer_row: panelRow("Globals"),
    });
    await waitFor(() => panelText().includes("global_value = 99"));
    await run("dap_next");
    await waitFor(() => openedLine === 4);
    await waitFor(() =>
      panelText().includes("count = 4 : int") &&
      panelText().includes("café = hello world")
    );
    assert(
      !panelText().includes("count = 3"),
      "Stepping refreshes values and references",
    );
    await run("dap_step_in");
    await waitFor(() => openedLine === 5);
    await run("dap_step_out");
    await waitFor(() => openedLine === 6);
    await waitFor(() => panelText().includes("count = 6"));
    cursorLine = panelRow("delayed");
    const delayedExpansion = run("dap_variables_toggle");
    await waitFor(() =>
      requests().some((r) =>
        r.command === "variables" && r.arguments.variablesReference === 66
      )
    );
    await run("dap_continue");
    await delayedExpansion;
    await waitFor(() => !markers.has("dap-execution"));
    assert(
      panelText().includes("Execution is running") &&
        !panelText().includes("stale"),
      "A late variables response cannot restore resumed state",
    );
    await run("dap_pause");
    await waitFor(() => openedLine === 7);
    await waitFor(() => panelText().includes("count = 7"));
    await run("dap_variables_close");
    assert(panelSplitCloses === 1, "Closing variables removes its pane");
    await run("dap_next");
    await waitFor(() => openedLine === 8);
    assert(
      !panelExists && panelCreates === 1,
      "A closed panel stays closed on the next stop",
    );
    await run("dap_variables");
    assert(
      panelText().includes("count = 8") && Number(panelCreates) === 2,
      "Reopen variables for the current paused frame",
    );
    await run("dap_next");
    await waitFor(() => panelText().includes("count = 9"));
    assert(
      openedLine === 8 && !markers.has("dap-execution"),
      "A frame without source still has variables and clears the old source marker",
    );
    await run("dap_stop");
    await processResult;
    await waitFor(() => {
      try {
        Deno.statSync(mailbox);
        return false;
      } catch {
        return true;
      }
    });
    assert(timers.size === 0, "Clear session heartbeat timer");
    assert(
      !markers.has("dap-execution"),
      "Clear execution indicators after stop",
    );
    assert(status.includes("stopped"), "Report session stop");
    assert(
      panelText().includes("Debug session ended") &&
        !panelText().includes("count ="),
      "Session end clears variables",
    );
    const adapters = settings.adapters;
    settings.adapters = [];
    await run("dap_start");
    assert(
      status.includes("No DAP adapter command"),
      "Report a missing adapter before starting a process",
    );
    assert(
      timers.size === 0,
      "A failed start does not create a heartbeat timer",
    );
    settings.adapters = adapters;
    const cancelled = run("dap_start");
    await run("dap_stop");
    await cancelled;
    assert(status.includes("cancelled"), "Stop can cancel bridge preparation");
    assert(
      timers.size === 0,
      "Cancelled startup does not create a heartbeat timer",
    );
    try {
      Deno.statSync(mailbox);
      throw new Error("Cancelled startup must remove its mailbox");
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  } finally {
    for (const id of timers) clearInterval(id);
    if (mailbox) write(`${mailbox}/stop`, "stop", false);
    await processResult;
    await new Promise((resolve) => setTimeout(resolve, 150));
    Deno.removeSync(root, { recursive: true });
    delete (globalThis as any).getEditor;
    delete (globalThis as any).registerHandler;
  }
});
