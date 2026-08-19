"use client";

import { Check, ChevronDown, Clipboard, FileCode2, Files, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { usePreferences } from "../../../components/preferences-provider";
import { parseUnifiedDiff } from "../../../lib/unified-diff";

const copyByLocale = {
  "pt-BR": { files: "arquivos alterados", added: "adições", deleted: "remoções", filter: "Filtrar arquivo...", changedFiles: "Arquivos alterados", expand: "Expandir todos", collapse: "Recolher todos", copy: "Copiar caminho", copied: "Copiado", binary: "Arquivo binário alterado; não há linhas de texto para exibir.", empty: "Nenhum arquivo corresponde ao filtro.", addedFile: "Adicionado", deletedFile: "Excluído", renamedFile: "Renomeado", modifiedFile: "Modificado" },
  en: { files: "changed files", added: "additions", deleted: "deletions", filter: "Filter files...", changedFiles: "Changed files", expand: "Expand all", collapse: "Collapse all", copy: "Copy path", copied: "Copied", binary: "Binary file changed; there are no text lines to display.", empty: "No files match the filter.", addedFile: "Added", deletedFile: "Deleted", renamedFile: "Renamed", modifiedFile: "Modified" },
  es: { files: "archivos modificados", added: "adiciones", deleted: "eliminaciones", filter: "Filtrar archivos...", changedFiles: "Archivos modificados", expand: "Expandir todos", collapse: "Contraer todos", copy: "Copiar ruta", copied: "Copiado", binary: "Archivo binario modificado; no hay líneas de texto para mostrar.", empty: "Ningún archivo coincide con el filtro.", addedFile: "Añadido", deletedFile: "Eliminado", renamedFile: "Renombrado", modifiedFile: "Modificado" },
};

function fileStatus(file, copy) {
  if (file.oldPath === "/dev/null") return ["added", "A", copy.addedFile];
  if (file.newPath === "/dev/null") return ["deleted", "D", copy.deletedFile];
  if (file.oldPath !== file.newPath) return ["renamed", "R", copy.renamedFile];
  return ["modified", "M", copy.modifiedFile];
}

function fileAnchor(file, index) {
  return `diff-file-${index}-${file.path.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export default function DiffViewer({ content }) {
  const { locale } = usePreferences();
  const copy = copyByLocale[locale] ?? copyByLocale["pt-BR"];
  const diff = useMemo(() => parseUnifiedDiff(content), [content]);
  const [query, setQuery] = useState("");
  const [openFiles, setOpenFiles] = useState(() => new Set(diff.files.slice(0, 1).map((file) => file.path)));
  const [copiedPath, setCopiedPath] = useState("");
  const visibleFiles = useMemo(() => diff.files
    .map((file, index) => ({ ...file, originalIndex: index }))
    .filter((file) => file.path.toLowerCase().includes(query.trim().toLowerCase())), [diff.files, query]);
  const allExpanded = visibleFiles.length > 0 && visibleFiles.every((file) => openFiles.has(file.path));

  useEffect(() => {
    if (!copiedPath) return undefined;
    const timer = setTimeout(() => setCopiedPath(""), 1600);
    return () => clearTimeout(timer);
  }, [copiedPath]);

  function toggleFile(path) {
    setOpenFiles((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  function toggleAll() {
    setOpenFiles((current) => {
      const next = new Set(current);
      if (allExpanded) visibleFiles.forEach((file) => next.delete(file.path));
      else visibleFiles.forEach((file) => next.add(file.path));
      return next;
    });
  }

  async function copyPath(path) {
    await navigator.clipboard.writeText(path);
    setCopiedPath(path);
  }

  return <div className="diff-viewer">
    <div className="diff-summary">
      <span><strong>{diff.files.length}</strong><small>{copy.files}</small></span>
      <span className="diff-added"><strong>+{diff.additions}</strong><small>{copy.added}</small></span>
      <span className="diff-deleted"><strong>−{diff.deletions}</strong><small>{copy.deleted}</small></span>
      <label><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.filter} aria-label={copy.filter} /></label>
      <button className="diff-expand-button" type="button" onClick={toggleAll}><Files size={14} />{allExpanded ? copy.collapse : copy.expand}</button>
    </div>
    <details className="diff-index">
      <summary><Files size={14} /><strong>{copy.changedFiles}</strong><span>{visibleFiles.length}</span><ChevronDown size={14} /></summary>
      <nav className="diff-file-nav" aria-label={copy.changedFiles}>
        {visibleFiles.map((file) => {
          const [status, letter, label] = fileStatus(file, copy);
          return <a href={`#${fileAnchor(file, file.originalIndex)}`} key={`${file.path}:${file.originalIndex}`}><b className={`diff-file-status ${status}`} title={label}>{letter}</b><span>{file.path}</span><em className="diff-added">+{file.additions}</em><em className="diff-deleted">−{file.deletions}</em></a>;
        })}
      </nav>
    </details>
    <div className="diff-files">
      {visibleFiles.map((file) => {
        const [status, letter, label] = fileStatus(file, copy);
        const open = openFiles.has(file.path);
        return <article className="diff-file" id={fileAnchor(file, file.originalIndex)} key={`${file.path}:${file.originalIndex}`}>
          <header className="diff-file-header">
            <button className="diff-file-toggle" type="button" onClick={() => toggleFile(file.path)} aria-expanded={open}><ChevronDown size={15} /><b className={`diff-file-status ${status}`} title={label}>{letter}</b><FileCode2 size={15} /><strong>{file.path}</strong></button>
            <span className="diff-added">+{file.additions}</span><span className="diff-deleted">−{file.deletions}</span>
            <button className="diff-copy-button" type="button" onClick={() => copyPath(file.path)} title={copy.copy}>{copiedPath === file.path ? <Check size={14} /> : <Clipboard size={14} />}<span>{copiedPath === file.path ? copy.copied : copy.copy}</span></button>
          </header>
          {open && <div className="diff-file-content">{file.binary ? <div className="diff-binary">{copy.binary}</div> : file.hunks.map((hunk, hunkIndex) => <div className="diff-hunk" key={`${hunk.header}:${hunkIndex}`}>
            <div className="diff-hunk-header">{hunk.header}</div>
            <pre>{hunk.lines.map((line, lineIndex) => <span className={`diff-line ${line.type}`} key={lineIndex}><i>{line.oldNumber ?? ""}</i><i>{line.newNumber ?? ""}</i><code>{line.content || " "}</code></span>)}</pre>
          </div>)}</div>}
        </article>;
      })}
      {!visibleFiles.length && <div className="list-empty">{copy.empty}</div>}
    </div>
  </div>;
}
