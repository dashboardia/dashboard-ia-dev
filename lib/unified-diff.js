function filePath(header, fallback = "arquivo") {
  const value = header?.trim().split(/\s+/)[0] ?? fallback;
  return value.replace(/^[ab]\//, "");
}

function parseHunkHeader(line) {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
  if (!match) return null;
  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] ?? 1),
    newStart: Number(match[3]),
    newCount: Number(match[4] ?? 1),
    heading: match[5].trim(),
  };
}

export function parseUnifiedDiff(content) {
  if (!content?.trim()) return { files: [], additions: 0, deletions: 0 };
  const files = [];
  let currentFile = null;
  let currentHunk = null;
  let oldLine = null;
  let newLine = null;

  const ensureFile = () => {
    if (!currentFile) {
      currentFile = { oldPath: "arquivo", newPath: "arquivo", path: "arquivo", additions: 0, deletions: 0, binary: false, hunks: [] };
      files.push(currentFile);
    }
    return currentFile;
  };

  for (const line of content.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      currentFile = {
        oldPath: match?.[1] ?? "arquivo",
        newPath: match?.[2] ?? match?.[1] ?? "arquivo",
        path: match?.[2] ?? match?.[1] ?? "arquivo",
        additions: 0,
        deletions: 0,
        binary: false,
        hunks: [],
      };
      files.push(currentFile);
      currentHunk = null;
      continue;
    }
    if (line.startsWith("--- ")) {
      const file = ensureFile();
      file.oldPath = filePath(line.slice(4), file.oldPath);
      continue;
    }
    if (line.startsWith("+++ ")) {
      const file = ensureFile();
      file.newPath = filePath(line.slice(4), file.newPath);
      file.path = file.newPath === "/dev/null" ? file.oldPath : file.newPath;
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      ensureFile().binary = true;
      continue;
    }
    if (line.startsWith("@@ ")) {
      const parsed = parseHunkHeader(line);
      if (!parsed) continue;
      currentHunk = { ...parsed, header: line, lines: [] };
      ensureFile().hunks.push(currentHunk);
      oldLine = parsed.oldStart;
      newLine = parsed.newStart;
      continue;
    }
    if (!currentHunk) continue;

    let type = "context";
    let oldNumber = oldLine;
    let newNumber = newLine;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      type = "addition";
      oldNumber = null;
      currentFile.additions += 1;
      newLine += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      type = "deletion";
      newNumber = null;
      currentFile.deletions += 1;
      oldLine += 1;
    } else if (line.startsWith("\\ No newline")) {
      type = "meta";
      oldNumber = null;
      newNumber = null;
    } else {
      oldLine += 1;
      newLine += 1;
    }
    currentHunk.lines.push({ type, content: line, oldNumber, newNumber });
  }

  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}
