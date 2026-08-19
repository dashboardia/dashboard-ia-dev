"use client";

import { ChevronDown, FileCode2, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { parseUnifiedDiff } from "../../../lib/unified-diff";

export default function DiffViewer({ content }) {
  const diff = useMemo(() => parseUnifiedDiff(content), [content]);
  const [query, setQuery] = useState("");
  const visibleFiles = diff.files.filter((file) => file.path.toLowerCase().includes(query.trim().toLowerCase()));

  return <div className="diff-viewer">
    <div className="diff-summary">
      <span><strong>{diff.files.length}</strong><small>arquivos alterados</small></span>
      <span className="diff-added"><strong>+{diff.additions}</strong><small>adições</small></span>
      <span className="diff-deleted"><strong>−{diff.deletions}</strong><small>remoções</small></span>
      <label><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar arquivo..." aria-label="Filtrar arquivos do diff" /></label>
    </div>
    <nav className="diff-file-nav" aria-label="Arquivos alterados">
      {visibleFiles.map((file, index) => <a href={`#diff-file-${index}`} key={`${file.path}:${index}`}><FileCode2 size={13} /><span>{file.path}</span><em className="diff-added">+{file.additions}</em><em className="diff-deleted">−{file.deletions}</em></a>)}
    </nav>
    <div className="diff-files">
      {visibleFiles.map((file, index) => <details id={`diff-file-${index}`} open={index === 0} key={`${file.path}:${index}`}>
        <summary><FileCode2 size={15} /><strong>{file.path}</strong><span className="diff-added">+{file.additions}</span><span className="diff-deleted">−{file.deletions}</span><ChevronDown size={15} /></summary>
        {file.binary ? <div className="diff-binary">Arquivo binário alterado; não há linhas de texto para exibir.</div> : file.hunks.map((hunk, hunkIndex) => <div className="diff-hunk" key={`${hunk.header}:${hunkIndex}`}>
          <div className="diff-hunk-header">{hunk.header}</div>
          <pre>{hunk.lines.map((line, lineIndex) => <span className={`diff-line ${line.type}`} key={lineIndex}><i>{line.oldNumber ?? ""}</i><i>{line.newNumber ?? ""}</i><code>{line.content || " "}</code></span>)}</pre>
        </div>)}
      </details>)}
      {!visibleFiles.length && <div className="list-empty">Nenhum arquivo corresponde ao filtro.</div>}
    </div>
  </div>;
}
