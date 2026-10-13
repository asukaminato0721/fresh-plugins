function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for preview.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

Deno.test("plugin opens images, fits resized panes, changes themes, returns to bytes, and cancels closed previews", async () => {
  const root = Deno.makeTempDirSync({ prefix: "fresh-image-plugin-test-" });
  const path = `${root}/测试 image.png`;
  const fixture = await new Deno.Command("magick", {
    args: ["-size", "4x2", "xc:none", path],
  }).output();
  assert(fixture.success);
  const handlers = new Map<string, (...args: any[]) => any>();
  const hooks = new Map<string, (data: any) => any>();
  const timers = new Map<number, string>();
  const entries = new Map<number, any[]>();
  const buffers = new Map<number, any>([[1, { path, is_virtual: false }]]);
  const config = { autoOpen: true, renderer: "imagemagick" };
  let theme = [250, 250, 250];
  let activeBuffer = 1;
  let width = 18;
  let height = 11;
  let nextBuffer = 2;
  let nextTimer = 1;
  let updates = 0;
  let kills = 0;
  let defer = false;
  let release: ((result: any) => void) | null = null;
  const commands: string[] = [];
  const renders: string[][] = [];
  const text = (id: number) =>
    entries.get(id)?.map((entry) => entry.text).join("") ?? "";
  const editor = {
    getPluginConfig: () => config,
    getConfig: () => ({ theme: "test" }),
    getThemeData: () => ({ editor: { bg: theme } }),
    getActiveBufferId: () => activeBuffer,
    getActiveSplitId: () => 1,
    getBufferInfo: (id: number) => buffers.get(id) ?? null,
    getCwd: () => root,
    getEnv: () => null,
    fileExists: (file: string) => {
      try {
        return Deno.statSync(file).isFile;
      } catch {
        return false;
      }
    },
    listSplits: () => [{
      splitId: 1,
      bufferId: activeBuffer,
      viewport: { width, height },
    }],
    createVirtualBuffer: async (options: any) => {
      assert(
        options.readOnly && options.editingDisabled && !options.showCursors,
      );
      const id = nextBuffer++;
      buffers.set(id, { name: options.name, is_virtual: true, path: "" });
      entries.set(id, options.entries);
      activeBuffer = id;
      hooks.get("buffer_activated")?.({ buffer_id: id });
      return { bufferId: id, splitId: 1 };
    },
    setVirtualBufferContent: (id: number, value: any[]) => {
      assert(
        buffers.has(id),
        "Closed previews must not receive render results.",
      );
      updates++;
      entries.set(id, value);
      return true;
    },
    spawnProcess: (command: string, args: string[]) => {
      renders.push(args);
      const delayed = defer;
      const result = delayed
        ? new Promise((resolve) => {
          release = resolve;
        })
        : new Deno.Command(command, { args, stdout: "piped", stderr: "piped" })
          .output().then((output) => ({
            exit_code: output.code,
            stdout: new TextDecoder().decode(output.stdout),
            stderr: new TextDecoder().decode(output.stderr),
          }));
      return {
        then: result.then.bind(result),
        kill: async () => {
          kills++;
          if (delayed) {
            release?.({ exit_code: -1, stdout: "", stderr: "cancelled" });
          }
          return true;
        },
      };
    },
    setSplitBuffer: (_split: number, id: number) => {
      activeBuffer = id;
      hooks.get("buffer_activated")?.({ buffer_id: id });
      return true;
    },
    closeBuffer: (id: number) => {
      buffers.delete(id);
      hooks.get("buffer_closed")?.({ buffer_id: id });
      activeBuffer = 1;
      hooks.get("buffer_activated")?.({ buffer_id: 1 });
      return true;
    },
    flush: () => Promise.resolve(),
    setLineWrap: () => true,
    setContext: () => true,
    setStatus: () => true,
    prompt: () => Promise.resolve(path),
    defineMode: () => true,
    registerCommand: (name: string) => {
      commands.push(name);
      return true;
    },
    on: (name: string, fn: (data: any) => any) => {
      hooks.set(name, fn);
    },
    setTimeout: (_delay: number, name: string) => {
      const id = nextTimer++;
      timers.set(id, name);
      return id;
    },
    clearInterval: (id: number) => {
      timers.delete(id);
    },
  };
  (globalThis as any).getEditor = () => editor;
  (globalThis as any).registerHandler = (
    name: string,
    fn: (...args: any[]) => any,
  ) => handlers.set(name, fn);
  try {
    await import(new URL("../image-preview.ts", import.meta.url).href);
    assert(commands.length === 5);
    handlers.get("imagePreviewInitial")!();
    await waitFor(() => text(2).includes("ImageMagick"));
    assert(activeBuffer === 2);
    assert(renders[0].includes("16x16"));
    assert(renders[0][0] === path + "[0]");
    assert(JSON.stringify(entries.get(2)).includes("[250,250,250]"));

    width = 10;
    hooks.get("viewport_changed")!({ buffer_id: 2 });
    handlers.get("imagePreviewResize")!();
    await waitFor(() =>
      renders.length >= 2 && text(2).includes("ImageMagick") && updates >= 2
    );
    assert(renders.at(-1)!.includes("8x16"));
    const beforeScroll = renders.length;
    hooks.get("viewport_changed")!({ buffer_id: 2, top_line: 2 });
    handlers.get("imagePreviewResize")!();
    assert(
      renders.length === beforeScroll,
      "Scrolling must not restart conversion.",
    );

    theme = [20, 30, 40];
    hooks.get("config_changed")!({});
    await waitFor(() => JSON.stringify(entries.get(2)).includes("[20,30,40]"));
    assert(renders.at(-1)!.includes("#141e28"));

    await handlers.get("imagePreviewBytes")!();
    assert(activeBuffer === 1);
    assert(nextBuffer === 3, "Viewing bytes must not reopen the preview.");
    handlers.get("imagePreviewShow")!();
    await waitFor(() => activeBuffer === 2 && text(2).includes("ImageMagick"));
    assert(nextBuffer === 3, "Show must reuse an existing preview.");
    // Wait for the reused tab's render before starting the cancellation case.
    await waitFor(() => updates >= 4);

    defer = true;
    handlers.get("imagePreviewRefresh")!();
    await waitFor(() => release !== null);
    const beforeClose = updates;
    handlers.get("imagePreviewClose")!();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert(kills >= 1);
    assert(updates === beforeClose);
    assert(!buffers.has(2));

    config.autoOpen = false;
    hooks.get("after_file_open")!({ buffer_id: 1 });
    assert(nextBuffer === 3);
    defer = false;
    await handlers.get("imagePreviewOpen")!();
    await waitFor(() => text(3).includes("ImageMagick"));
    assert(
      activeBuffer === 3,
      "Explicit Open must work when autoOpen is disabled.",
    );
    handlers.get("imagePreviewClose")!();
  } finally {
    delete (globalThis as any).getEditor;
    delete (globalThis as any).registerHandler;
    Deno.removeSync(root, { recursive: true });
  }
});
