function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("async reads do not repaint after edits, source toggle, or buffer close", async () => {
  const handlers: Record<string, (...args: any[]) => any> = {};
  const hooks: Record<string, (...args: any[]) => any> = {};
  let mode = "source", exists = true, length = 20;
  let read: Promise<string> = Promise.resolve("Text *styled*.\n");
  const calls: string[] = [];
  const api = {
    getActiveBufferId: () => 1,
    getActiveSplitId: () => 0,
    getBufferInfo: () =>
      exists
        ? {
          path: "test.rst",
          is_virtual: false,
          view_mode: mode,
          is_composing_in_any_split: mode === "compose",
          length,
          language: "rst",
        }
        : null,
    getPluginConfig: () => ({}),
    getConfig: () => ({}),
    getBufferText: () => read,
    stringWidth: (text: string) => [...text].length,
    setViewMode: (_: number, value: string) => {
      mode = value;
    },
    setLineNumbersDefault() {},
    setFoldIndicators() {},
    setIndentationGuide() {},
    setLineWrap() {},
    setLayoutHints() {},
    flush: () => Promise.resolve(),
    setTimeout: () => 1,
    clearInterval() {},
    clearNamespace: (_: number, ns: string) => calls.push(`clear-style:${ns}`),
    clearConcealNamespace: (_: number, ns: string) =>
      calls.push(`clear-conceal:${ns}`),
    clearSoftBreakNamespace() {},
    clearVirtualTextNamespace() {},
    removeVirtualTextsByPrefix() {},
    clearScrollbarMarkers() {},
    addOverlay: () => calls.push("style"),
    addConceal: () => calls.push("conceal"),
    registerCommand() {},
    setStatus: (text: string) => calls.push(text),
    on: (name: string, fn: (...args: any[]) => any) => {
      hooks[name] = fn;
    },
  };
  (globalThis as any).getEditor = () => api;
  (globalThis as any).registerHandler = (
    name: string,
    fn: (...args: any[]) => any,
  ) => {
    handlers[name] = fn;
  };
  await import("../rst-compose.ts");
  await handlers.rstComposeToggle();
  await handlers.rstComposeRefresh();
  assert(calls.includes("style") && calls.includes("conceal"));
  calls.length = 0;
  hooks.lines_changed({ buffer_id: 1, is_composing_in_any_split: true });
  assert(
    calls.includes("clear-style:md-emphasis") &&
      calls.includes("clear-conceal:md-syntax"),
  );
  calls.length = 0;
  hooks.lines_changed({ buffer_id: 1, is_composing_in_any_split: false });
  assert(calls.length === 0);

  let resolve!: (text: string) => void;
  read = new Promise((done) => {
    resolve = done;
  });
  hooks.buffer_modified({ buffer_id: 1 });
  const first = handlers.rstComposeRefresh();
  hooks.buffer_modified({ buffer_id: 1 });
  calls.length = 0;
  resolve("Stale *text*.\n");
  await first;
  assert(
    !calls.includes("conceal"),
    "An obsolete buffer snapshot was painted.",
  );

  read = new Promise((done) => {
    resolve = done;
  });
  const second = handlers.rstComposeRefresh();
  await handlers.rstComposeToggle();
  calls.length = 0;
  resolve("Stale *text*.\n");
  await second;
  assert(
    !calls.includes("conceal"),
    "Source mode received stale compose decorations.",
  );

  await handlers.rstComposeToggle();
  read = new Promise((done) => {
    resolve = done;
  });
  const third = handlers.rstComposeRefresh();
  exists = false;
  hooks.buffer_closed({ buffer_id: 1 });
  calls.length = 0;
  resolve("Closed *text*.\n");
  await third;
  assert(!calls.includes("conceal"), "A closed buffer was painted.");

  exists = true;
  length = 1024 * 1024 + 1;
  await hooks.buffer_activated({ buffer_id: 1 });
  await handlers.rstComposeRefresh();
  assert(calls.some((text) => text.includes("1 MiB")));
  assert(!calls.includes("conceal"));
  delete (globalThis as any).getEditor;
  delete (globalThis as any).registerHandler;
});
