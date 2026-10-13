// Source positions use UTF-8 bytes, as required by the Fresh plugin API.
export interface Decoration {
  start: number;
  end: number;
  replacement?: string | null;
  scopeStart?: number;
  scopeEnd?: number;
  style?: Record<string, unknown>;
}

export interface SourceLine {
  text: string;
  start: number;
  end: number;
  next: number;
  protected: boolean;
  heading: boolean;
}

export interface DocumentPlan {
  lines: SourceLine[];
  decorations: Decoration[];
}

// QuickJS does not provide the browser TextEncoder class.
export function byteLength(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const point = char.codePointAt(0)!;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}
const indent = (text: string): number =>
  text.match(/^[ \t]*/)?.[0].replace(/\t/g, "        ").length ?? 0;
const escaped = (text: string, at: number): boolean => {
  let count = 0;
  while (at > 0 && text[--at] === "\\") count++;
  return count % 2 === 1;
};
const opening = (text: string, at: number): boolean =>
  !escaped(text, at) &&
  (at === 0 || /[\s\p{Ps}\p{Pi}\-/:]/u.test(text[at - 1]));
const closing = (text: string, at: number): boolean =>
  at === text.length || /[\s\p{Pe}\p{Pf}.,;:!?\-/_]/u.test(text[at]);

function sourceLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (const raw of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const content = raw.replace(/\r?\n$/, "");
    const next = start + byteLength(raw);
    lines.push({
      text: content,
      start,
      end: start + byteLength(content),
      next,
      protected: false,
      heading: false,
    });
    start = next;
  }
  return lines;
}

// Keep explicit blocks and their indented bodies unchanged. This includes
// unsupported directives, comments, targets, and substitution definitions.
function protectBlocks(lines: SourceLine[]): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.protected) continue;
    const explicit = /^\s*\.\.(?:\s|$)/.test(line.text);
    const doctest = /^\s*>>>\s/.test(line.text);
    const literal = /(?<!\\)::$/.test(line.text.trimEnd());
    if (!explicit && !literal && !doctest) continue;
    if (explicit || doctest) line.protected = true;
    const base = indent(line.text);
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].text.trim() === "") continue;
      if (
        doctest
          ? indent(lines[j].text) < base ||
            (j > i + 1 && !lines[j - 1].text.trim())
          : indent(lines[j].text) <= base
      ) break;
      lines[j].protected = true;
    }
  }
  // Preserve grid and simple tables. Their punctuation is structural.
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*(?:\+[-=+]+\+|=+\s{2,}=+(?:\s+=+)*)\s*$/.test(lines[i].text)) {
      continue;
    }
    for (let j = i; j < lines.length && lines[j].text.trim(); j++) {
      lines[j].protected = true;
    }
  }
}

function adornment(line: SourceLine): string | undefined {
  if (
    line.protected ||
    !/^[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]{2,}\s*$/.test(line.text)
  ) return;
  const text = line.text.trimEnd();
  return [...text].every((char) => char === text[0]) ? text[0] : undefined;
}

export function parseDocument(
  text: string,
  width: (text: string) => number = (text) => [...text].length,
): DocumentPlan {
  const lines = sourceLines(text);
  const decorations: Decoration[] = [];
  protectBlocks(lines);
  const used = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const title = lines[i];
    const under = lines[i + 1];
    if (
      !under || title.protected || title.heading || !title.text.trim() ||
      indent(title.text) || adornment(title)
    ) continue;
    const marker = adornment(under);
    if (
      !marker || used.has(i + 1) ||
      width(under.text.trimEnd()) < width(title.text.trimEnd())
    ) continue;
    const over = i > 0 && adornment(lines[i - 1]) === marker && !used.has(i - 1)
      ? lines[i - 1]
      : undefined;
    if (over && width(over.text.trimEnd()) !== width(under.text.trimEnd())) {
      continue;
    }
    const first = over ?? title;
    // A section starts after a blank line, or at the start of the file.
    const before = over ? i - 2 : i - 1;
    if (before >= 0 && lines[before].text.trim()) continue;
    title.heading = true;
    under.heading = true;
    used.add(i + 1);
    if (over) {
      over.heading = true;
      used.add(i - 1);
    }
    decorations.push({
      start: title.start,
      end: title.end,
      style: { bold: true, fg: "syntax.keyword" },
    });
    for (const rule of over ? [over, under] : [under]) {
      decorations.push({
        start: rule.start,
        end: rule.end,
        replacement: "",
        scopeStart: first.start,
        scopeEnd: under.next + 1,
      });
    }
  }
  for (const line of lines) {
    if (line.protected) continue;
    if (line.heading && adornment(line)) continue;
    const bullet = line.text.match(/^(\s*)([-+*])(?=\s+\S)/);
    if (bullet) {
      const start = line.start + byteLength(bullet[1]);
      decorations.push({
        start,
        end: start + 1,
        replacement: "•",
        scopeStart: line.start,
        scopeEnd: line.next + 1,
        style: { fg: "syntax.keyword" },
      });
    }
    inline(line.text, line.start, decorations);
  }
  return { lines, decorations };
}

function inline(text: string, base: number, result: Decoration[]): void {
  const offsets: number[] = [0];
  let bytes = 0, index = 0;
  for (const char of text) {
    offsets[index] = bytes;
    bytes += byteLength(char);
    index += char.length;
    offsets[index] = bytes;
  }
  const byte = (at: number): number => base + offsets[at];
  for (let at = 0; at < text.length; at++) {
    if (!opening(text, at)) continue;
    const delimiter = text.startsWith("``", at)
      ? "``"
      : text.startsWith("**", at)
      ? "**"
      : text[at] === "*"
      ? "*"
      : text[at] === "`"
      ? "`"
      : "";
    if (!delimiter) continue;
    if (delimiter === "`" && /:[\w-]+:$/.test(text.slice(0, at))) continue;
    const contentStart = at + delimiter.length;
    if (!text[contentStart] || /\s/.test(text[contentStart])) continue;
    let end = text.indexOf(delimiter, contentStart);
    let suffix = "";
    for (; end >= 0; end = text.indexOf(delimiter, end + delimiter.length)) {
      if (
        end === contentStart || /\s/.test(text[end - 1]) ||
        (delimiter !== "``" && escaped(text, end))
      ) continue;
      if (
        delimiter === "*" && (text[end - 1] === "*" || text[end + 1] === "*")
      ) continue;
      const after = end + delimiter.length;
      suffix = delimiter === "`"
        ? text.slice(after).match(/^(?:__?|:[\w-]+:)/)?.[0] ?? ""
        : "";
      if (!closing(text, after + suffix.length)) continue;
      break;
    }
    if (end < 0) continue;
    // Unknown interpreted roles remain visible. These may change meaning.
    if (delimiter === "`" && suffix.startsWith(":")) {
      at = end + delimiter.length + suffix.length - 1;
      continue;
    }
    const matchEnd = end + delimiter.length + suffix.length;
    const style: Record<string, unknown> = delimiter === "``"
      ? { fg: "syntax.constant" }
      : delimiter === "**"
      ? { bold: true }
      : delimiter === "*"
      ? { italic: true }
      : { italic: true };
    let visibleEnd = end;
    if (delimiter === "`" && suffix.startsWith("_")) {
      style.fg = "syntax.link";
      style.underline = true;
      const embedded = text.slice(contentStart, end).match(/\s+<([^<>]+)>$/);
      if (embedded) {
        visibleEnd = end - embedded[0].length;
        // Only attach absolute web links. Named references stay styled.
        if (/^https?:\/\//i.test(embedded[1])) style.url = embedded[1];
      }
    }
    const scopeStart = byte(at), scopeEnd = byte(matchEnd) + 1;
    result.push({ start: byte(contentStart), end: byte(visibleEnd), style });
    result.push({
      start: byte(at),
      end: byte(contentStart),
      replacement: "",
      scopeStart,
      scopeEnd,
    });
    result.push({
      start: byte(visibleEnd),
      end: byte(matchEnd),
      replacement: "",
      scopeStart,
      scopeEnd,
    });
    at = matchEnd - 1;
  }
}
