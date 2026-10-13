import {
  absolutePath,
  ansiImage,
  isImagePath,
  pixelImage,
  renderImage,
} from "../lib/render.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
  );
}
const background: [number, number, number] = [30, 40, 50];
const pixels = `# ImageMagick pixel enumeration: 2,3,0,255,srgb
0,0: (255,0,0) #FF0000 red
1,0: (0,0,0) #000000 black
0,1: (0,255,0) #00FF00 green
1,1: (255,255,255) #FFFFFF white
0,2: (0,0,255) #0000FF blue
1,2: (0,0,255) #0000FF blue
`;

Deno.test("ANSI colors cover all UTF-8 image cells and preserve resets and black", () => {
  const image = ansiImage(
    "\x1b[38;2;0;0;0;48;2;1;2;3m▀▀\x1b[0m▀\n",
    background,
  );
  equal([image.width, image.height], [3, 1]);
  equal(image.entries[0].text, "▀▀▀\n");
  equal(image.entries[0].inlineOverlays, [
    { start: 0, end: 6, unit: "byte", style: { fg: [0, 0, 0], bg: [1, 2, 3] } },
    {
      start: 6,
      end: 9,
      unit: "byte",
      style: { fg: [255, 255, 255], bg: background },
    },
  ]);
});

Deno.test("ANSI reverse colors and non-color escapes never leak into the buffer", () => {
  const image = ansiImage(
    "\x1b[31;44;7m▀\x1b[27m▀\x1b[2K\x1b]0;title\x07\n",
    background,
  );
  equal(image.entries[0].text, "▀▀\n");
  equal(image.entries[0].inlineOverlays[0].style, {
    fg: [0, 0, 128],
    bg: [128, 0, 0],
  });
  equal(image.entries[0].inlineOverlays[1].style, {
    fg: [128, 0, 0],
    bg: [0, 0, 128],
  });
});

Deno.test("pixel rows retain both colors and use theme background for odd heights", () => {
  const image = pixelImage(pixels, background, 2, 2);
  equal([image.width, image.height], [2, 2]);
  equal(image.entries[0].inlineOverlays[0].style, {
    fg: [255, 0, 0],
    bg: [0, 255, 0],
  });
  equal(image.entries[0].inlineOverlays[1].style, {
    fg: [0, 0, 0],
    bg: [255, 255, 255],
  });
  equal(image.entries[1].inlineOverlays[0], {
    start: 0,
    end: 6,
    unit: "byte",
    style: { fg: [0, 0, 255], bg: background },
  });
});

Deno.test("incomplete or oversized pixel data fails instead of drawing missing colors", () => {
  for (
    const output of [
      pixels.replace("1,1: (255,255,255) #FFFFFF white\n", ""),
      pixels.replace("2,3,", "3,3,"),
    ]
  ) {
    let failed = false;
    try {
      pixelImage(output, background, 2, 2);
    } catch {
      failed = true;
    }
    assert(failed);
  }
});

Deno.test("paths and auto detection handle Unicode, spaces, and mixed-case extensions", () => {
  assert(isImagePath("/tmp/测试 image.JPEG"));
  assert(!isImagePath("script.ts"));
  equal(
    absolutePath("测试 image.png", "/tmp/work"),
    "/tmp/work/测试 image.png",
  );
  equal(
    absolutePath("~/image.png", "/tmp", "/home/test"),
    "/home/test/image.png",
  );
  equal(absolutePath("C:\\images\\file.png", "/tmp"), "C:\\images\\file.png");
});

Deno.test("auto falls back to ImageMagick and passes the file as one argument", async () => {
  const calls: { command: string; args: string[] }[] = [];
  const path = "/tmp/测试 $(no-shell) image.png";
  const image = await renderImage((command, args) => {
    calls.push({ command, args });
    return Promise.resolve(
      command === "chafa"
        ? { exit_code: -1, stdout: "", stderr: "not found" }
        : { exit_code: 0, stdout: pixels, stderr: "" },
    );
  }, { path, width: 2, height: 2, background });
  equal(image.renderer, "ImageMagick");
  equal(calls.map((call) => call.command), ["chafa", "magick"]);
  equal(calls[0].args, ["--version"]);
  equal(calls[1].args[0], path + "[0]");
  assert(calls[1].args.includes("#1e2832"));
});

Deno.test("modern Chafa disables terminal probing and older Chafa keeps compatible arguments", async () => {
  for (const version of ["1.12.0", "1.18.3"]) {
    const calls: string[][] = [];
    const path = "/tmp/测试 image.png";
    const image = await renderImage((_command, args) => {
      calls.push(args);
      return Promise.resolve({
        exit_code: 0,
        stderr: "",
        stdout: args[0] === "--version"
          ? `Chafa version ${version}\n`
          : "\x1b[38;2;255;0;0;48;2;0;0;255m▀\n",
      });
    }, { path, width: 2, height: 2, background, renderer: "chafa" });
    equal(image.renderer, "Chafa");
    equal(calls[1].includes("--probe=off"), version === "1.18.3");
    assert(calls[1].includes("--format=symbols"));
    assert(calls[1].includes("--animate=off"));
    equal(calls[1].at(-1), path);
  }
});

Deno.test("real ImageMagick decodes PNG, JPEG, GIF and theme-colored transparency", async () => {
  const root = Deno.makeTempDirSync({ prefix: "fresh-image-test-" });
  const spawn = async (command: string, args: string[]) => {
    const result = await new Deno.Command(command, {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
    return {
      exit_code: result.code,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    };
  };
  try {
    const source = `${root}/source.ppm`;
    Deno.writeTextFileSync(
      source,
      "P3\n4 2\n255\n255 0 0  0 255 0  0 0 255  0 0 0\n255 0 0  0 255 0  0 0 255  0 0 0\n",
    );
    for (const extension of ["png", "jpg", "gif"]) {
      const path = `${root}/测试 image.${extension}`;
      assert((await spawn("magick", [source, path])).exit_code === 0);
      const image = await renderImage(spawn, {
        path,
        width: 8,
        height: 8,
        background,
        renderer: "imagemagick",
      });
      equal([image.width, image.height], [8, 2]);
      assert(image.entries.every((entry) => !entry.text.includes("\x1b")));
      assert(image.entries[0].inlineOverlays.length > 1);
    }
    const path = `${root}/transparent.png`;
    assert(
      (await spawn("magick", ["-size", "2x2", "xc:none", path])).exit_code ===
        0,
    );
    for (
      const bg of [[250, 250, 250], [20, 30, 40]] as [number, number, number][]
    ) {
      const image = await renderImage(spawn, {
        path,
        width: 2,
        height: 1,
        background: bg,
        renderer: "imagemagick",
      });
      equal(image.entries[0].inlineOverlays[0].style, { fg: bg, bg });
    }
    const chafa = Deno.permissions.querySync({
        name: "env",
        variable: "CHAFA_TEST_COMMAND",
      }).state === "granted"
      ? Deno.env.get("CHAFA_TEST_COMMAND")
      : undefined;
    if (chafa) {
      const image = await renderImage(spawn, {
        path: `${root}/测试 image.png`,
        width: 8,
        height: 8,
        background,
        renderer: "chafa",
        chafaCommand: chafa,
      });
      equal([image.width, image.height], [8, 2]);
      assert(image.entries.every((entry) => !entry.text.includes("\x1b")));
      assert(image.entries[0].inlineOverlays.length > 1);
    }
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});
