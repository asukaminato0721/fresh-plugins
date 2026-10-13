export interface Commit {
  hash: string;
  subject: string;
}

export interface ChangedFile {
  status: string;
  path: string;
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
