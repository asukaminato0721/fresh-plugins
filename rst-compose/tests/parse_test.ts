import { byteLength, parseDocument } from "../lib/parse.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const decode = (text: string, start: number, end: number) =>
  new TextDecoder().decode(new TextEncoder().encode(text).slice(start, end));
function rendered(text: string): string {
  const hides = parseDocument(text).decorations.filter((d) =>
    d.replacement !== undefined
  ).sort((a, b) => b.start - a.start);
  let bytes = new TextEncoder().encode(text);
  for (const hide of hides) {
    const replacement = new TextEncoder().encode(hide.replacement ?? "");
    const next = new Uint8Array(
      hide.start + replacement.length + bytes.length - hide.end,
    );
    next.set(bytes.slice(0, hide.start));
    next.set(replacement, hide.start);
    next.set(bytes.slice(hide.end), hide.start + replacement.length);
    bytes = next;
  }
  return new TextDecoder().decode(bytes);
}

Deno.test("issue 2625: headings, emphasis, literals, and bullets", () => {
  const source =
    "Title\n=====\n\n*emphasis* and **strong** and ``literal``.\n\n- first\n+ second\n* third\n";
  assert(
    rendered(source) ===
      "Title\n\n\nemphasis and strong and literal.\n\n• first\n• second\n• third\n",
  );
  const styles = parseDocument(source).decorations.filter((d) => d.style);
  assert(
    styles.some((d) =>
      d.style?.italic && decode(source, d.start, d.end) === "emphasis"
    ),
  );
  assert(
    styles.some((d) =>
      d.style?.bold && decode(source, d.start, d.end) === "strong"
    ),
  );
});

Deno.test("UTF-8 offsets preserve CJK, emoji, and CRLF", () => {
  const source = "中文🙂 *强调* 和 ``代码``\r\n";
  assert(rendered(source) === "中文🙂 强调 和 代码\r\n");
  const plan = parseDocument(source);
  assert(plan.lines[0].next === byteLength(source));
  for (const d of plan.decorations) {
    assert(!decode(source, d.start, d.end).includes("�"));
  }
});

Deno.test("title overlines and terminal widths", () => {
  const source = "========\n中文标题\n========\n\nSection\n-------\n";
  const plan = parseDocument(
    source,
    (text) =>
      [...text].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 2 : 1), 0),
  );
  assert(plan.decorations.filter((d) => d.style?.bold).length === 2);
  assert(plan.decorations.filter((d) => d.replacement === "").length === 3);
  assert(parseDocument("Long title\n===\n").decorations.length === 0);
  assert(parseDocument("====\nTitle\n=====\n").decorations.length === 0);
});

Deno.test("literal, directive, and doctest bodies keep raw markup", () => {
  const source =
    "Example::\n\n    *raw*\n    ``raw``\n\nNormal *styled*.\n\n.. code-block:: python\n   :linenos:\n\n   **raw**\n\n>>> print('*raw*')\n*output*\n\nEnd *styled*.\n";
  const output = rendered(source);
  assert(output.includes("    *raw*\n    ``raw``"));
  assert(output.includes("   **raw**"));
  assert(output.includes("*output*"));
  assert(output.includes("Normal styled."));
  assert(output.includes("End styled."));
});

Deno.test("comments, unknown directives, targets, and tables remain readable", () => {
  const source =
    ".. *comment*\n\n   **comment**\n\n.. unknown:: *argument*\n\n   *body*\n\n.. _target: https://example.org/*raw*\n\n+-------+\n| *raw* |\n+-------+\n\n===  ===\n*x*  *y*\n===  ===\n";
  assert(rendered(source) === source);
});

Deno.test("escaped, incomplete, and intraword markup stays literal", () => {
  const source = "\\*escaped* word*part* * unspaced* *unclosed ** unclosed\n";
  assert(rendered(source) === source);
  assert(rendered("``*literal* **literal**``") === "*literal* **literal**");
});

Deno.test("links retain URLs for the editor and reveal their full source", () => {
  const source = "See `Fresh <https://example.org/docs>`_ and `Named link`_.";
  assert(rendered(source) === "See Fresh and Named link.");
  const plan = parseDocument(source);
  assert(
    plan.decorations.some((d) => d.style?.url === "https://example.org/docs"),
  );
  const hides = plan.decorations.filter((d) => d.replacement !== undefined);
  assert(hides.every((d) => d.scopeStart !== undefined && d.scopeEnd! > d.end));
});

Deno.test("unknown interpreted roles retain their original spelling", () => {
  assert(rendered("Use `thing`:custom:.") === "Use `thing`:custom:.");
  assert(rendered("Use :custom:`thing`.") === "Use :custom:`thing`.");
});
