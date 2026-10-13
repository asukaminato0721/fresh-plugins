/**
 * Debug Adapter Protocol client.
 *
 * Launch requests come from `.vscode/launch.json` (JSONC is accepted). Adapter
 * executables are intentionally configured separately: launch.json describes
 * the debuggee, while `plugins.dap.settings.adapters` describes how Fresh can
 * start each adapter type.
 */
import { VariablesPanel } from "./lib/variables.ts";

const editor = getEditor();
const variables = new VariablesPanel(editor, request);

interface AdapterConfig {
  type: string;
  command: string;
  args?: string[];
  cwd?: string;
}
interface DapSettings {
  pythonCommand?: string;
  launchJson?: string;
  configuration?: string;
  adapters?: AdapterConfig[];
}
interface LaunchConfig {
  name?: string;
  type: string;
  request: "launch" | "attach";
  [key: string]: unknown;
}
interface DapMessage {
  seq: number;
  type: "request" | "response" | "event";
  command?: string;
  event?: string;
  request_seq?: number;
  success?: boolean;
  message?: string;
  body?: any;
  arguments?: any;
}
interface Session {
  process: ProcessHandle<BackgroundProcessResult>;
  mailbox: string;
  timer: number;
  transportSeq: number;
  nextSeq: number;
  pending: Map<
    number,
    {
      resolve: (body: any) => void;
      reject: (error: Error) => void;
      deadline: number;
    }
  >;
  wire: string;
  initializedEvent: boolean;
  launchSent: boolean;
  configured: boolean;
  capabilities: any;
  stoppedThread: number | null;
}

const BREAKPOINT_NS = "dap-breakpoints";
const EXECUTION_NS = "dap-execution";
let session: Session | null = null;
let starting = false;
let startVersion = 0;
let stopVersion = 0;
let stoppedLocation: { path: string; line: number } | null = null;

function loadBreakpoints(): Record<string, number[]> {
  const value = editor.getGlobalState("breakpoints") as
    | Record<string, number[]>
    | null;
  return value && typeof value === "object" ? value : {};
}
let breakpoints = loadBreakpoints(); // paths -> one-based DAP lines

function persistBreakpoints(): void {
  editor.setGlobalState("breakpoints", breakpoints);
}

function send(message: Omit<DapMessage, "seq">): number {
  if (!session) throw new Error("No active debug session");
  const seq = session.nextSeq++;
  const path = editor.pathJoin(
    session.mailbox,
    `${session.transportSeq++}.json`,
  );
  if (
    !editor.writeFile(
      editor.localPath(path),
      JSON.stringify({ seq, ...message }),
    )
  ) {
    throw new Error("Cannot send request to the DAP bridge");
  }
  return seq;
}

function request(command: string, args: any = {}): Promise<any> {
  if (!session) return Promise.reject(new Error("No active debug session"));
  const current = session;
  const seq = send({ type: "request", command, arguments: args });
  return new Promise((resolve, reject) =>
    current.pending.set(seq, {
      resolve,
      reject,
      deadline: Date.now() + 30000,
    })
  );
}

function acceptOutput(data: string): void {
  if (!session) return;
  session.wire += data;
  const lines = session.wire.split("\n");
  session.wire = lines.pop() ?? "";
  for (const payload of lines) {
    try {
      handleMessage(JSON.parse(payload) as DapMessage);
    } catch (error) {
      editor.debug(`[dap] invalid adapter message: ${String(error)}`);
    }
  }
}

function handleMessage(message: DapMessage): void {
  if (!session) return;
  if (message.type === "response") {
    const pending = session.pending.get(message.request_seq!);
    if (!pending) return;
    session.pending.delete(message.request_seq!);
    if (message.success === false) {
      pending.reject(new Error(message.message || "DAP request failed"));
    } else pending.resolve(message.body);
    return;
  }
  if (message.type === "event") {
    void handleEvent(message.event || "", message.body || {}).catch((error) => {
      editor.setStatus(`Debug event failed: ${String(error)}`);
    });
  }
  if (message.type === "request") {
    // Adapters may ask the client to run something in a terminal. Fresh does
    // not silently execute those requests; answer explicitly so they do not
    // wait forever and can fall back to their internal console.
    send({
      type: "response",
      request_seq: message.seq,
      command: message.command,
      success: false,
      message: `Client request '${message.command}' is not supported`,
    });
  }
}

async function handleEvent(event: string, body: any): Promise<void> {
  if (!session) return;
  switch (event) {
    case "initialized":
      session.initializedEvent = true;
      await configureSession();
      break;
    case "stopped":
      const stoppedVersion = ++stopVersion;
      stoppedLocation = null;
      clearExecutionIndicator();
      variables.clear("Loading paused frame...");
      if (body.threadId == null) {
        const current = session;
        const threads = await request("threads");
        if (session !== current || stopVersion !== stoppedVersion) return;
        session.stoppedThread = threads?.threads?.[0]?.id ?? null;
      } else {
        session.stoppedThread = Number(body.threadId);
      }
      editor.setStatus(
        `Debug paused${body.description ? `: ${body.description}` : ""}`,
      );
      if (session.stoppedThread != null) {
        await revealTopFrame(session.stoppedThread);
      }
      break;
    case "continued":
      stopVersion++;
      session.stoppedThread = null;
      stoppedLocation = null;
      variables.clear("Execution is running. Pause to inspect variables.");
      clearExecutionIndicator();
      editor.setStatus("Debug running");
      break;
    case "capabilities":
      session.capabilities = {
        ...session.capabilities,
        ...(body.capabilities || {}),
      };
      break;
    case "output":
      if (body.output) {
        editor.debug(
          `[dap:${body.category || "output"}] ${String(body.output).trimEnd()}`,
        );
      }
      break;
    case "terminated":
    case "exited":
      endSession(
        event === "exited" && body.exitCode != null
          ? `Debuggee exited (${body.exitCode})`
          : "Debug session ended",
      );
      break;
  }
}

async function revealTopFrame(threadId: number): Promise<void> {
  const current = session;
  const version = ++stopVersion;
  try {
    const body = await request("stackTrace", {
      threadId,
      startFrame: 0,
      levels: 1,
    });
    if (session !== current || stopVersion !== version) return;
    const frame = body?.stackFrames?.[0];
    if (!frame) {
      variables.clear("No stack frame available.");
      return;
    }
    if (frame.source?.path && frame.line) {
      stoppedLocation = {
        path: String(frame.source.path),
        line: Number(frame.line),
      };
      if (
        variables.owns(editor.getActiveBufferId()) &&
        variables.sourceSplit != null &&
        editor.listSplits().some((split) =>
          split.splitId === variables.sourceSplit
        )
      ) {
        editor.openFileInSplit(
          variables.sourceSplit,
          stoppedLocation.path,
          stoppedLocation.line,
          frame.column || 1,
        );
      } else {
        editor.openFile(
          stoppedLocation.path,
          stoppedLocation.line,
          frame.column || 1,
        );
      }
      // `openFile` does not emit `buffer_activated` when the frame is already in
      // the active buffer, so render immediately as well as from the hook below.
      for (const buffer of editor.listBuffers()) {
        if (!buffer.is_virtual) renderIndicators(buffer.id);
      }
      editor.setStatus(
        `Paused at ${
          frame.name || "frame"
        } — ${stoppedLocation.path}:${stoppedLocation.line}`,
      );
    }
    await variables.setFrame(Number(frame.id), String(frame.name || "frame"));
  } catch (error) {
    if (session === current && stopVersion === version) {
      editor.setStatus(`Could not load stack frame: ${String(error)}`);
    }
  }
}

function renderIndicators(bufferId = editor.getActiveBufferId()): void {
  const path = editor.getBufferPath(bufferId);
  editor.clearLineIndicators(bufferId, BREAKPOINT_NS);
  const lines = breakpoints[path] || [];
  if (lines.length) {
    editor.setLineIndicators(
      bufferId,
      lines.map((line) => line - 1),
      BREAKPOINT_NS,
      "●",
      255,
      85,
      85,
      50,
    );
  }
  editor.clearLineIndicators(bufferId, EXECUTION_NS);
  if (stoppedLocation?.path === path) {
    editor.setLineIndicator(
      bufferId,
      stoppedLocation.line - 1,
      EXECUTION_NS,
      "▶",
      80,
      250,
      123,
      100,
    );
  }
}

function clearExecutionIndicator(): void {
  for (const buffer of editor.listBuffers()) {
    if (!buffer.is_virtual) {
      editor.clearLineIndicators(buffer.id, EXECUTION_NS);
    }
  }
}

async function syncBreakpoints(path: string): Promise<void> {
  if (!session) return;
  const lines = breakpoints[path] || [];
  await request("setBreakpoints", {
    source: { path, name: path.replace(/\\/g, "/").split("/").pop() },
    breakpoints: lines.map((line) => ({ line })),
    sourceModified: editor.listBuffers().some((buffer) =>
      buffer.path === path && buffer.modified
    ),
  });
}

async function configureSession(): Promise<void> {
  if (
    !session || session.configured || !session.initializedEvent ||
    !session.launchSent
  ) return;
  session.configured = true;
  const current = session;
  try {
    for (const path of Object.keys(breakpoints)) {
      if (session !== current) return;
      await syncBreakpoints(path);
    }
    if (session !== current) return;
    if (current.capabilities?.supportsConfigurationDoneRequest === true) {
      await request("configurationDone", {});
    }
  } catch (error) {
    if (session === current) {
      endSession(`Debug configuration failed: ${String(error)}`);
    }
  }
}

function expand(value: any, variables: Record<string, string>): any {
  if (typeof value === "string") {
    return value.replace(
      /\$\{(file|workspaceFolder)\}/g,
      (_, key: string) => variables[key] || "",
    );
  }
  if (Array.isArray(value)) return value.map((item) => expand(item, variables));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = expand(item, variables);
    }
    return out;
  }
  return value;
}

function readLaunchConfiguration(): {
  adapter: AdapterConfig;
  launch: LaunchConfig;
  root: string;
} {
  const settings = (editor.getPluginConfig() || {}) as DapSettings;
  const root = editor.getCwd();
  const launchPath = settings.launchJson || ".vscode/launch.json";
  const absolute = /^(?:[A-Za-z]:[\\/]|\/)/.test(launchPath)
    ? launchPath
    : `${root.replace(/[\\/]$/, "")}/${launchPath}`;
  const text = editor.readFile(absolute);
  if (!text) throw new Error(`No launch configuration at ${absolute}`);
  const document = editor.parseJsonc(text) as {
    configurations?: LaunchConfig[];
  };
  const configs = document?.configurations || [];
  const launch = settings.configuration
    ? configs.find((item) => item.name === settings.configuration)
    : configs[0];
  if (!launch) throw new Error("launch.json has no matching configuration");
  if (launch.request !== "launch" && launch.request !== "attach") {
    throw new Error("The debug configuration request must be launch or attach");
  }
  const adapter = (settings.adapters || []).find((item) =>
    item.type === launch.type
  );
  if (!adapter?.command) {
    throw new Error(
      `No DAP adapter command configured for type '${launch.type}'`,
    );
  }
  const file = editor.getBufferPath(editor.getActiveBufferId());
  return {
    adapter: expand(adapter, { file, workspaceFolder: root }),
    launch: expand(launch, { file, workspaceFolder: root }),
    root,
  };
}

async function startDebugging(): Promise<void> {
  if (session || starting) {
    editor.setStatus("A debug session is already active");
    return;
  }
  starting = true;
  variables.beginSession();
  const version = ++startVersion;
  let cleanup: (() => Promise<void>) | null = null;
  try {
    const { adapter, launch, root } = readLaunchConfiguration();
    const settings = (editor.getPluginConfig() || {}) as DapSettings;
    const python = settings.pythonCommand || "python3";
    const bridge = editor.pathJoin(editor.getPluginDir(), "dap_bridge.py");
    const prepared = await editor.spawnProcess(
      python,
      [bridge, "prepare"],
      root,
    );
    if (prepared.exit_code !== 0 || !prepared.stdout.trim()) {
      throw new Error(
        prepared.stderr.trim() ||
          "Cannot start the DAP bridge. Check Python 3.",
      );
    }
    const mailbox = prepared.stdout.trim();
    cleanup = async () => {
      await editor.spawnProcess(python, [bridge, "cleanup", mailbox], root);
    };
    if (version !== startVersion) {
      await cleanup();
      cleanup = null;
      return;
    }
    const process = editor.spawnBackgroundProcess(
      python,
      [
        bridge,
        "serve",
        mailbox,
        JSON.stringify([adapter.command, ...(adapter.args || [])]),
        adapter.cwd || root,
      ],
      root,
    );
    session = {
      process,
      mailbox,
      timer: editor.setInterval(1000, "dap_tick"),
      transportSeq: 1,
      nextSeq: 1,
      pending: new Map(),
      wire: "",
      initializedEvent: false,
      launchSent: false,
      configured: false,
      capabilities: {},
      stoppedThread: null,
    };
    const current = session;
    cleanup = null; // The running bridge now owns the temporary directory.
    process.result.then((result) => {
      if (session?.process === process) {
        endSession(`Debug adapter exited (${result.exit_code})`);
      }
    }).catch((error) => {
      if (session === current) {
        endSession(`Debug adapter failed: ${String(error)}`);
      }
    });

    current.capabilities = await request("initialize", {
      clientID: "fresh",
      clientName: "Fresh Editor",
      adapterID: launch.type,
      pathFormat: "path",
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsRunInTerminalRequest: false,
    });
    if (session !== current) return;
    const args: Record<string, unknown> = { ...launch };
    delete args.name;
    delete args.type;
    delete args.request;
    const launchResponse = request(launch.request, args);
    current.launchSent = true;
    await Promise.all([configureSession(), launchResponse]);
    if (session === current && !stoppedLocation) {
      editor.setStatus(`Debugging: ${launch.name || launch.type}`);
    }
  } catch (error) {
    if (cleanup) {
      try {
        await cleanup();
      } catch (_) { /* report the original failure */ }
    }
    if (version === startVersion) {
      endSession(`Could not start debugger: ${String(error)}`);
    }
  } finally {
    starting = false;
  }
}

function endSession(status: string): void {
  const old = session;
  session = null;
  stoppedLocation = null;
  stopVersion++;
  variables.clear("Debug session ended. Start a session to inspect variables.");
  if (old) {
    editor.clearInterval(old.timer);
    editor.writeFile(
      editor.localPath(editor.pathJoin(old.mailbox, "stop")),
      "stop",
    );
    for (const pending of old.pending.values()) {
      pending.reject(new Error(status));
    }
    old.pending.clear();
    // Give the bridge time to terminate the adapter and remove its mailbox.
    void editor.delay(3000).then(() => old.process.kill()).catch(() => {});
  }
  clearExecutionIndicator();
  editor.setStatus(status);
}

async function stopDebugging(): Promise<void> {
  startVersion++;
  if (!session) {
    editor.setStatus(
      starting ? "Debug startup cancelled" : "No active debug session",
    );
    return;
  }
  const current = session;
  // Cleanup must also complete when the adapter does not answer disconnect.
  await Promise.race([
    request("disconnect", { restart: false, terminateDebuggee: true }).catch(
      () => {},
    ),
    editor.delay(2000),
  ]);
  if (session === current) endSession("Debug session stopped");
}

async function toggleBreakpoint(): Promise<void> {
  const bufferId = editor.getActiveBufferId();
  const path = editor.getBufferPath(bufferId);
  const cursor = editor.getPrimaryCursor();
  if (!path || cursor?.line == null) {
    editor.setStatus("Breakpoints require a file-backed buffer");
    return;
  }
  const line = cursor.line + 1;
  const lines = breakpoints[path] || [];
  breakpoints[path] = lines.includes(line)
    ? lines.filter((item) => item !== line)
    : [...lines, line].sort((a, b) => a - b);
  if (!breakpoints[path].length) delete breakpoints[path];
  persistBreakpoints();
  renderIndicators(bufferId);
  try {
    await syncBreakpoints(path);
  } catch (error) {
    editor.setStatus(`Could not update breakpoints: ${String(error)}`);
  }
}

async function control(command: string): Promise<void> {
  if (!session) {
    editor.setStatus("No active debug session");
    return;
  }
  try {
    let threadId = session.stoppedThread;
    if (command === "pause" && threadId == null) {
      const body = await request("threads", {});
      threadId = body?.threads?.[0]?.id ?? null;
    }
    if (threadId == null) {
      throw new Error("The adapter has not reported a thread");
    }
    const args = command === "pause"
      ? { threadId }
      : { threadId, singleThread: false };
    await request(command, args);
  } catch (error) {
    editor.setStatus(`Debug ${command} failed: ${String(error)}`);
  }
}

registerHandler("dap_start", startDebugging);
registerHandler("dap_tick", () => {
  if (!session) return;
  editor.replaceFile(
    editor.localPath(editor.pathJoin(session.mailbox, "heartbeat")),
    "alive",
  );
  const now = Date.now();
  for (const [seq, pending] of session.pending) {
    if (pending.deadline <= now) {
      session.pending.delete(seq);
      pending.reject(
        new Error("The debug adapter did not respond within 30 seconds"),
      );
    }
  }
});
registerHandler("dap_stop", stopDebugging);
registerHandler("dap_toggle_breakpoint", toggleBreakpoint);
registerHandler("dap_continue", () => control("continue"));
registerHandler("dap_next", () => control("next"));
registerHandler("dap_step_in", () => control("stepIn"));
registerHandler("dap_step_out", () => control("stepOut"));
registerHandler("dap_pause", () => control("pause"));
const panelAction = (action: () => Promise<void>) => () =>
  action().catch((error) => {
    editor.setStatus(`Cannot update variables: ${String(error)}`);
  });
registerHandler("dap_variables", panelAction(() => variables.show()));
registerHandler(
  "dap_variables_toggle",
  panelAction(() => variables.atCursor()),
);
registerHandler(
  "dap_variables_expand",
  panelAction(() => variables.atCursor(true)),
);
registerHandler(
  "dap_variables_collapse",
  panelAction(() => variables.atCursor(false)),
);
registerHandler(
  "dap_variables_refresh",
  panelAction(() => variables.refresh()),
);
registerHandler("dap_variables_close", () => variables.close());
editor.defineMode("dap-variables", [
  ["Return", "dap_variables_toggle"],
  ["Space", "dap_variables_toggle"],
  ["Right", "dap_variables_expand"],
  ["Left", "dap_variables_collapse"],
  ["r", "dap_variables_refresh"],
  ["q", "dap_variables_close"],
], true);

editor.registerCommand(
  "Debug: Start",
  "Start the configured debug adapter",
  "dap_start",
  null,
);
editor.registerCommand(
  "Debug: Stop",
  "Terminate the active debug session",
  "dap_stop",
  null,
);
editor.registerCommand(
  "Debug: Toggle Breakpoint",
  "Toggle a breakpoint on the current line",
  "dap_toggle_breakpoint",
  null,
);
editor.registerCommand(
  "Debug: Continue",
  "Continue execution",
  "dap_continue",
  null,
);
editor.registerCommand(
  "Debug: Step Over",
  "Step over the current line",
  "dap_next",
  null,
);
editor.registerCommand(
  "Debug: Step Into",
  "Step into the current call",
  "dap_step_in",
  null,
);
editor.registerCommand(
  "Debug: Step Out",
  "Step out of the current call",
  "dap_step_out",
  null,
);
editor.registerCommand("Debug: Pause", "Pause the debuggee", "dap_pause", null);
editor.registerCommand(
  "Debug: Variables",
  "Show variables for the paused frame",
  "dap_variables",
  null,
);

(editor.on as any)(
  "onProcessStdout",
  (args: { process_id: number; data: string }) => {
    if (session?.process.processId === args.process_id) acceptOutput(args.data);
  },
);
(editor.on as any)(
  "onProcessStderr",
  (args: { process_id: number; data: string }) => {
    if (session?.process.processId === args.process_id) {
      editor.debug(
        `[dap:stderr] ${args.data.trimEnd()}`,
      );
    }
  },
);
editor.on("buffer_activated", (args) => {
  renderIndicators(args.buffer_id);
});
editor.on("after_file_save", (args) => {
  renderIndicators(args.buffer_id);
});
editor.on("after_file_open", (args) => renderIndicators(args.buffer_id));
editor.on("buffer_closed", (args) => variables.closed(args.buffer_id));
editor.on("mouse_click", (args) => {
  if (
    args.button === "left" && variables.owns(args.buffer_id) &&
    args.buffer_row != null
  ) {
    void variables.activate(args.buffer_row).catch((error) =>
      editor.setStatus(`Cannot expand variable: ${String(error)}`)
    );
  }
});

renderIndicators();
