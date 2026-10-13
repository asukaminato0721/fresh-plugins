export interface Commit {
  hash: string;
  subject: string;
}

export interface ChangedFile {
  status: string;
  path: string;
}

export interface FileRevisions {
  oldRevision: string | null;
  newRevision: string | null;
}

/** Parse `git log -z --format=%H%x00%s`. */
export function parseCommits(output: string): Commit[] {
  const fields = output.split("\0");
  const commits: Commit[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const hash = fields[index].trim();
    if (!/^[0-9a-f]{40,64}$/.test(hash)) continue;
    commits.push({ hash, subject: fields[index + 1].trim() });
  }
  return commits;
}

/** Parse `git show --name-status -z --no-renames`. */
export function parseChangedFiles(output: string): ChangedFile[] {
  const fields = output.split("\0");
  const files: ChangedFile[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const status = fields[index].trim();
    const path = fields[index + 1];
    if (!/^[A-Z]$/.test(status) || !path) continue;
    files.push({ status, path });
  }
  return files;
}

/** Parse a NUL-separated path list, such as `git ls-files -z`. */
export function parsePaths(output: string, status = "A"): ChangedFile[] {
  return output.split("\0")
    .filter((path) => path.length > 0)
    .map((path) => ({ status, path }));
}

/** Combine file lists and keep the first status reported for each path. */
export function mergeChangedFiles(...groups: ChangedFile[][]): ChangedFile[] {
  const files = new Map<string, ChangedFile>();
  for (const group of groups) {
    for (const file of group) {
      if (!files.has(file.path)) files.set(file.path, file);
    }
  }
  return Array.from(files.values()).sort((left, right) =>
    left.path.localeCompare(right.path)
  );
}

/** Return the two Git revisions that form a commit file diff. */
export function fileRevisions(
  commitHash: string,
  file: ChangedFile,
): FileRevisions {
  return {
    oldRevision: file.status === "A" ? null : `${commitHash}^:${file.path}`,
    newRevision: file.status === "D" ? null : `${commitHash}:${file.path}`,
  };
}
