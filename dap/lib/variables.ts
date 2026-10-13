/** Read-only scope tree. DAP references are valid only while execution stops. */
interface VariableNode {
  key: string;
  name: string;
  value?: string;
  type?: string;
  reference: number;
  expanded: boolean;
  loading: boolean;
  children?: VariableNode[];
  error?: string;
}

export class VariablesPanel {
  private panel: { bufferId: number; splitId: number | null } | null = null;
  private opening: Promise<void> | null = null;
  private frame: { id: number; name: string } | null = null;
  private version = 0;
  private suppressed = false;
  private message = "Pause execution to inspect variables.";
  private nodes: VariableNode[] = [];
  private rows = new Map<number, VariableNode>();
  private expanded = new Set<string>();
  private collapsed = new Set<string>();
  sourceSplit: number | null = null;

  constructor(
    private editor: EditorAPI,
    private request: (
      command: string,
      args: Record<string, unknown>,
    ) => Promise<any>,
  ) {
    // Virtual buffers can survive a plugin reload.
    const existing = editor.listBuffers().find((buffer) =>
      buffer.is_virtual && buffer.name === "*Debug Variables*"
    );
    if (existing) {
      const splits = editor.listSplits();
      this.panel = {
        bufferId: existing.id,
        splitId: splits.find((split) =>
          split.bufferId === existing.id
        )?.splitId ?? null,
      };
      this.sourceSplit = splits.find((split) =>
        split.bufferId !== existing.id
      )?.splitId ?? null;
      editor.setBufferMode(existing.id, "dap-variables");
      this.render();
    }
  }

  beginSession(): void {
    this.suppressed = false;
    this.expanded.clear();
    this.collapsed.clear();
    this.clear("Pause execution to inspect variables.");
  }

  clear(message: string): void {
    this.version++;
    this.frame = null;
    this.nodes = [];
    this.message = message;
    this.render();
  }

  private async ensureOpen(): Promise<void> {
    if (this.panel) return;
    if (this.opening) return this.opening;
    this.opening = (async () => {
      this.sourceSplit = this.editor.getActiveSplitId();
      const result = await this.editor.createVirtualBufferInSplit({
        name: "*Debug Variables*",
        mode: "dap-variables",
        direction: "vertical",
        ratio: 0.7,
        readOnly: true,
        editingDisabled: true,
        showLineNumbers: false,
        lineWrap: false,
        entries: [{ text: "Loading variables...\n" }],
      });
      this.panel = result;
      if (this.editor.getActiveSplitId() === result.splitId) {
        this.editor.focusSplit(this.sourceSplit);
      }
      this.render();
    })();
    try {
      await this.opening;
    } finally {
      this.opening = null;
    }
  }

  async setFrame(id: number, name: string): Promise<void> {
    const version = ++this.version;
    this.frame = { id, name };
    this.nodes = [];
    this.message = "Loading scopes...";
    this.render();
    if (this.suppressed) return;
    await this.ensureOpen();
    if (this.version !== version) return;
    try {
      const body = await this.request("scopes", { frameId: id });
      if (this.version !== version) return;
      this.nodes = (body?.scopes || []).map((scope: any, index: number) => {
        const key = JSON.stringify([scope.name, index]);
        return {
          key,
          name: String(scope.name),
          reference: Number(scope.variablesReference) || 0,
          expanded: this.expanded.has(key) ||
            (!scope.expensive && !this.collapsed.has(key)),
          loading: false,
        };
      });
      this.message = this.nodes.length ? "" : "No variables in this frame.";
      this.render();
      await Promise.all(
        this.nodes.filter((node) => node.expanded && node.reference > 0)
          .map((node) => this.loadChildren(node, version)),
      );
    } catch (error) {
      if (this.version === version) {
        this.message = `Cannot load scopes: ${
          String(error)
        }. Press r to retry.`;
        this.render();
      }
    }
  }

  private async loadChildren(
    node: VariableNode,
    version: number,
  ): Promise<void> {
    if (node.loading || node.reference <= 0 || version !== this.version) return;
    node.loading = true;
    node.error = undefined;
    this.render();
    try {
      const body = await this.request("variables", {
        variablesReference: node.reference,
      });
      if (version !== this.version) return;
      node.children = (body?.variables || []).map(
        (variable: any, index: number) => {
          const key = `${node.key}/${JSON.stringify([variable.name, index])}`;
          return {
            key,
            name: String(variable.name),
            value: String(variable.value ?? ""),
            type: variable.type ? String(variable.type) : undefined,
            reference: Number(variable.variablesReference) || 0,
            expanded: this.expanded.has(key),
            loading: false,
          };
        },
      );
      node.loading = false;
      this.render();
      await Promise.all(
        (node.children || []).filter((child) => child.expanded)
          .map((child) => this.loadChildren(child, version)),
      );
    } catch (error) {
      if (version === this.version) {
        node.loading = false;
        node.error = String(error);
        this.render();
      }
    }
  }

  private render(): void {
    this.rows.clear();
    if (!this.panel) return;
    const clean = (text: string) => text.replace(/[\r\n\t\x00-\x1f\x7f]/g, " ");
    const entries: TextPropertyEntry[] = [
      { text: "Variables\n", style: { fg: "syntax.keyword", bold: true } },
      {
        text: this.frame ? `${clean(this.frame.name)}\n` : "No paused frame\n",
      },
      {
        text: "Click/Enter: expand\nr: refresh  q: close\n\n",
        style: { fg: "ui.menu_disabled_fg" },
      },
    ];
    let row = 5;
    const addNode = (node: VariableNode, depth: number) => {
      this.rows.set(row++, node);
      const properties = { variableKey: node.key };
      const arrow = node.reference > 0 ? (node.expanded ? "▾" : "▸") : " ";
      entries.push({
        text: `${"  ".repeat(depth)}${arrow} ${clean(node.name)}`,
        properties,
        style: {
          fg: node.value === undefined ? "syntax.keyword" : "editor.fg",
        },
      });
      if (node.value !== undefined) {
        entries.push({
          text: ` = ${clean(node.value)}`,
          properties,
          style: { fg: "syntax.string" },
        });
      }
      if (node.type) {
        entries.push({
          text: ` : ${clean(node.type)}`,
          properties,
          style: { fg: "syntax.type" },
        });
      }
      entries.push({ text: "\n", properties });
      if (!node.expanded) return;
      if (node.loading || node.error || node.children?.length === 0) {
        row++;
        entries.push({
          text: `${"  ".repeat(depth + 1)}${
            node.loading
              ? "Loading..."
              : node.error
              ? `Cannot load variables: ${
                clean(node.error)
              }. Select the parent to retry.`
              : "(empty)"
          }\n`,
          style: { fg: "ui.menu_disabled_fg" },
        });
      }
      for (const child of node.children || []) addNode(child, depth + 1);
    };
    for (const node of this.nodes) addNode(node, 0);
    if (this.message) entries.push({ text: `${this.message}\n` });
    this.editor.setVirtualBufferContent(this.panel.bufferId, entries);
  }

  async activate(row: number, expand?: boolean): Promise<void> {
    const node = this.rows.get(row);
    if (!this.frame || !node || node.reference <= 0) return;
    node.expanded = expand ?? (!!node.error || !node.expanded);
    if (node.expanded) {
      this.expanded.add(node.key);
      this.collapsed.delete(node.key);
    } else {
      this.expanded.delete(node.key);
      this.collapsed.add(node.key);
    }
    this.render();
    if (node.expanded && !node.children) {
      await this.loadChildren(node, this.version);
    }
  }

  async atCursor(expand?: boolean): Promise<void> {
    if (this.editor.getActiveBufferId() !== this.panel?.bufferId) return;
    const row = this.editor.getPrimaryCursor()?.line;
    if (row != null) await this.activate(row, expand);
  }

  async show(): Promise<void> {
    this.suppressed = false;
    await this.ensureOpen();
    await this.refresh();
    if (this.panel?.splitId != null) this.editor.focusSplit(this.panel.splitId);
    if (this.panel) this.editor.showBuffer(this.panel.bufferId);
  }

  async refresh(): Promise<void> {
    if (this.frame) await this.setFrame(this.frame.id, this.frame.name);
  }

  close(): void {
    if (!this.panel) return;
    const { bufferId: id, splitId } = this.panel;
    const splits = this.editor.listSplits();
    this.closed(id);
    if (
      splitId != null && splits.length > 1 &&
      splits.some((split) => split.splitId === splitId && split.bufferId === id)
    ) {
      this.editor.closeSplit(splitId);
    }
    this.editor.closeBuffer(id, true);
  }

  closed(bufferId: number): void {
    if (this.panel?.bufferId !== bufferId) return;
    this.panel = null;
    this.suppressed = true;
    this.version++;
    this.rows.clear();
  }

  owns(bufferId: number | null): boolean {
    return bufferId != null && bufferId === this.panel?.bufferId;
  }
}
