export type Rgb = [number, number, number];
export interface ImageEntry extends Record<string, unknown> {
  text: string;
  style: { bg: Rgb };
  inlineOverlays: {
    start: number;
    end: number;
    unit: "byte";
    style: { fg: Rgb; bg: Rgb };
  }[];
}
export interface RenderedImage {
  entries: ImageEntry[];
  width: number;
  height: number;
  renderer: string;
}
export interface RenderOptions {
  path: string;
  width: number;
  height: number;
  background: Rgb;
  renderer?: "auto" | "chafa" | "imagemagick";
  chafaCommand?: string;
  magickCommand?: string;
}
export interface ProcessResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}
type Spawn = (command: string, args: string[]) => PromiseLike<ProcessResult>;
const WHITE: Rgb = [255, 255, 255];

export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|avif)$/i.test(path);
}

export function absolutePath(path: string, cwd: string, home = ""): string {
  if (path.startsWith("~/") && home) path = home + path.slice(1);
  if (/^(\/|[A-Za-z]:[\\/])/.test(path)) return path;
  return `${cwd.replace(/\/$/, "")}/${path}`;
}

export function rgbHex(color: Rgb): string {
  return "#" +
    color.map((value) => value.toString(16).padStart(2, "0")).join("");
}

function bytes(char: string): number {
  const code = char.codePointAt(0)!;
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
}

function append(entry: ImageEntry, char: string, fg: Rgb, bg: Rgb): void {
  const previous = entry.inlineOverlays.at(-1);
  const start = previous?.end ?? 0;
  const end = start + bytes(char);
  if (
    previous && String(previous.style.fg) === String(fg) &&
    String(previous.style.bg) === String(bg)
  ) {
    previous.end = end;
  } else {
    entry.inlineOverlays.push({ start, end, unit: "byte", style: { fg, bg } });
  }
  entry.text += char;
}

function palette(index: number): Rgb {
  const basic: Rgb[] = [
    [0, 0, 0],
    [128, 0, 0],
    [0, 128, 0],
    [128, 128, 0],
    [0, 0, 128],
    [128, 0, 128],
    [0, 128, 128],
    [192, 192, 192],
    [128, 128, 128],
    [255, 0, 0],
    [0, 255, 0],
    [255, 255, 0],
    [0, 0, 255],
    [255, 0, 255],
    [0, 255, 255],
    [255, 255, 255],
  ];
  if (index < 16) return basic[index] ?? WHITE;
  if (index >= 232) return [1, 1, 1].map(() => 8 + (index - 232) * 10) as Rgb;
  const value = index - 16;
  const level = (part: number) => part === 0 ? 0 : 55 + part * 40;
  return [
    level(Math.floor(value / 36)),
    level(Math.floor(value / 6) % 6),
    level(value % 6),
  ];
}

/** Convert Chafa's SGR output into Fresh overlays. Never emit terminal escapes. */
export function ansiImage(output: string, background: Rgb): RenderedImage {
  let fg = WHITE;
  let bg = background;
  let reverse = false;
  const entries: ImageEntry[] = [];
  const clean = output.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
  const lines = clean.split(/\r?\n/);
  while (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    const entry: ImageEntry = {
      text: "",
      style: { bg: background },
      inlineOverlays: [],
    };
    const tokens = line.match(/\x1b\[[0-?]*[ -/]*[@-~]|[^\x1b]+/g) ?? [];
    for (const token of tokens) {
      if (token.startsWith("\x1b[")) {
        if (!token.endsWith("m")) continue;
        const codes = token.slice(2, -1).split(";").map(Number);
        for (let i = 0; i < codes.length; i++) {
          const code = codes[i];
          if (code === 0) {
            fg = WHITE;
            bg = background;
            reverse = false;
          } else if (code === 7) reverse = true;
          else if (code === 27) reverse = false;
          else if (code === 39) fg = WHITE;
          else if (code === 49) bg = background;
          else if (code >= 30 && code <= 37) fg = palette(code - 30);
          else if (code >= 40 && code <= 47) bg = palette(code - 40);
          else if (code >= 90 && code <= 97) fg = palette(code - 90 + 8);
          else if (code >= 100 && code <= 107) bg = palette(code - 100 + 8);
          else if (code === 38 || code === 48) {
            let color: Rgb | null = null;
            if (codes[i + 1] === 2 && codes.length > i + 4) {
              color = codes.slice(i + 2, i + 5) as Rgb;
              i += 4;
            } else if (codes[i + 1] === 5 && codes.length > i + 2) {
              color = palette(codes[i + 2]);
              i += 2;
            }
            if (color) {
              if (code === 38) fg = color;
              else bg = color;
            }
          }
        }
      } else {
        for (const char of token) {
          if (char >= " " && char !== "\x7f") {
            append(entry, char, reverse ? bg : fg, reverse ? fg : bg);
          }
        }
      }
    }
    entry.text += "\n";
    entries.push(entry);
  }
  if (
    !entries.length || !entries.some((entry) => entry.inlineOverlays.length)
  ) {
    throw new Error("Chafa produced no image cells.");
  }
  return {
    entries,
    width: Math.max(...entries.map((entry) => [...entry.text].length - 1)),
    height: entries.length,
    renderer: "Chafa",
  };
}

/** Pair two pixel rows in each colored upper-half block. */
export function pixelImage(
  output: string,
  background: Rgb,
  maxWidth: number,
  maxHeight: number,
): RenderedImage {
  const lines = output.trim().split("\n");
  const header = /^# ImageMagick pixel enumeration:\s*(\d+),(\d+),/.exec(
    lines[0] ?? "",
  );
  if (!header) throw new Error("ImageMagick produced no pixel data.");
  const width = Number(header[1]);
  const height = Number(header[2]);
  if (width < 1 || height < 1 || width > maxWidth || height > maxHeight * 2) {
    throw new Error("ImageMagick returned unexpected image dimensions.");
  }
  const pixels: (Rgb | undefined)[] = Array(width * height);
  for (const line of lines.slice(1)) {
    const match = /^(\d+),(\d+):.*?#([a-f\d]{6})\b/i.exec(line);
    if (!match) continue;
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (x >= width || y >= height) {
      throw new Error("ImageMagick returned an invalid pixel position.");
    }
    pixels[y * width + x] = [0, 2, 4].map((start) =>
      parseInt(match[3].slice(start, start + 2), 16)
    ) as Rgb;
  }
  for (let i = 0; i < pixels.length; i++) {
    if (!pixels[i]) {
      throw new Error("ImageMagick returned incomplete pixel data.");
    }
  }
  const entries: ImageEntry[] = [];
  for (let y = 0; y < height; y += 2) {
    const entry: ImageEntry = {
      text: "",
      style: { bg: background },
      inlineOverlays: [],
    };
    for (let x = 0; x < width; x++) {
      append(
        entry,
        "▀",
        pixels[y * width + x]!,
        pixels[(y + 1) * width + x] ?? background,
      );
    }
    entry.text += "\n";
    entries.push(entry);
  }
  return { entries, width, height: entries.length, renderer: "ImageMagick" };
}

export async function renderImage(
  spawn: Spawn,
  options: RenderOptions,
): Promise<RenderedImage> {
  const { path, width, height, background } = options;
  const renderer = options.renderer ?? "auto";
  const failures: string[] = [];
  async function run(command: string, args: string[]): Promise<string> {
    const result = await spawn(command, args);
    if (result.exit_code !== 0) {
      throw new Error(
        `${command}: ${result.stderr.trim() || `exit ${result.exit_code}`}`,
      );
    }
    return result.stdout;
  }
  if (renderer !== "imagemagick") {
    try {
      const command = options.chafaCommand || "chafa";
      // Chafa 1.16 added terminal probing. Newer releases can read /dev/tty
      // even with piped stdio, which would compete with Fresh for input.
      const version = await run(command, ["--version"]);
      const match = /(?:Chafa version|chafa)\s+(\d+)\.(\d+)/i.exec(version);
      const needsProbeFlag = !match || Number(match[1]) > 1 ||
        Number(match[2]) >= 16;
      const output = await run(command, [
        ...(needsProbeFlag ? ["--probe=off"] : []),
        "--format=symbols",
        "--colors=full",
        `--size=${width}x${height}`,
        "--font-ratio=1/2",
        "--scale=max",
        "--animate=off",
        "--duration=0",
        "--optimize=0",
        "--polite=on",
        "--symbols=block",
        `--bg=${rgbHex(background)}`,
        path,
      ]);
      const image = ansiImage(output, background);
      if (image.width > width || image.height > height) {
        throw new Error("Chafa exceeded the preview dimensions.");
      }
      return image;
    } catch (error) {
      failures.push(String(error));
      if (renderer === "chafa") throw error;
    }
  }
  const commands = options.magickCommand
    ? [options.magickCommand]
    : ["magick", "convert"];
  for (const command of commands) {
    try {
      const output = await run(command, [
        `${path}[0]`,
        "-auto-orient",
        "-colorspace",
        "sRGB",
        "-resize",
        `${width}x${height * 2}`,
        "-background",
        rgbHex(background),
        "-alpha",
        "remove",
        "-alpha",
        "off",
        "-depth",
        "8",
        "txt:-",
      ]);
      return pixelImage(output, background, width, height);
    } catch (error) {
      failures.push(String(error));
    }
  }
  throw new Error(
    `Image rendering failed. Install Chafa or ImageMagick if neither is available.\n${
      failures.join("\n")
    }`,
  );
}
