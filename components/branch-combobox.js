"use client";

import { Check, GitBranch, Search } from "lucide-react";
import { useMemo, useState } from "react";

export default function BranchCombobox({ branches, value, onChange, disabled = false }) {
  const [query, setQuery] = useState(value ?? "");
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return branches;
    return branches.filter((branch) => branch.name.toLocaleLowerCase("pt-BR").includes(normalized));
  }, [branches, query]);

  function updateQuery(next) {
    setQuery(next);
    const exact = branches.find((branch) => branch.name.toLocaleLowerCase("pt-BR") === next.trim().toLocaleLowerCase("pt-BR"));
    onChange(exact?.name ?? next);
    setOpen(true);
  }

  function select(branch) {
    setQuery(branch.name);
    onChange(branch.name);
    setOpen(false);
  }

  return <div className={`branch-combobox ${open ? "open" : ""}`}>
    <div className="branch-combobox-input"><Search size={14} /><input type="search" role="combobox" aria-expanded={open} aria-controls="branch-options" aria-autocomplete="list" autoComplete="off" value={query} onChange={(event) => updateQuery(event.target.value)} onFocus={(event) => { event.target.select(); setOpen(true); }} onBlur={() => window.setTimeout(() => setOpen(false), 120)} disabled={disabled} placeholder="Cole ou digite o nome da branch" /></div>
    {open && !disabled && <div className="branch-combobox-options" id="branch-options" role="listbox">
      {filtered.slice(0, 100).map((branch) => <button type="button" role="option" aria-selected={branch.name === value} onMouseDown={(event) => event.preventDefault()} onClick={() => select(branch)} key={branch.name}><GitBranch size={13} /><span>{branch.name}{branch.protected && <small>protegida</small>}</span>{branch.name === value && <Check size={14} />}</button>)}
      {!filtered.length && <p>Nenhuma branch corresponde a “{query}”.</p>}
    </div>}
  </div>;
}
