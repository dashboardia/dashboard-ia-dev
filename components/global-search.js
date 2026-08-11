"use client";

import { Activity, Boxes, FileCode2, GitPullRequest, LoaderCircle, Logs, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const groupIcons = {
  PROJECT: Boxes,
  DEMAND: FileCode2,
  EXECUTION: Activity,
  PULL_REQUEST: GitPullRequest,
  LOG: Logs,
};

export default function GlobalSearch({ disabled = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState({ groups: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    function onKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!disabled) setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!open || normalizedQuery.length < 2) {
      setResult({ groups: [], total: 0 });
      setLoading(false);
      setError("");
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(normalizedQuery)}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Não foi possível pesquisar");
        setResult(payload);
      } catch (searchError) {
        if (searchError.name !== "AbortError") setError(searchError.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [open, query]);

  function close() {
    setOpen(false);
    setQuery("");
    setResult({ groups: [], total: 0 });
    setError("");
  }

  return (
    <>
      <button className="search search-trigger" type="button" onClick={() => setOpen(true)} disabled={disabled} aria-label="Abrir busca global">
        <Search size={17} />
        <span>Buscar projetos, demandas ou logs...</span>
        <kbd>⌘ K</kbd>
      </button>

      {open && (
        <div className="search-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
          <section className="search-dialog" role="dialog" aria-modal="true" aria-label="Busca global">
            <div className="search-dialog-input">
              {loading ? <LoaderCircle className="search-spinner" size={19} /> : <Search size={19} />}
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Digite ao menos 2 caracteres..."
                aria-label="Termo de busca"
                autoComplete="off"
              />
              <button type="button" onClick={close} aria-label="Fechar busca"><X size={18} /></button>
            </div>

            <div className="search-results" aria-live="polite">
              {query.trim().length < 2 && <div className="search-empty"><Search size={26} /><strong>Encontre qualquer item</strong><span>Pesquise por nome, descrição, branch, status ou mensagem de log.</span></div>}
              {error && <div className="search-empty search-error"><strong>Busca indisponível</strong><span>{error}</span></div>}
              {!loading && !error && query.trim().length >= 2 && result.total === 0 && <div className="search-empty"><strong>Nenhum resultado</strong><span>Tente outro termo ou confira seu acesso ao projeto.</span></div>}
              {!error && result.groups.map((group) => {
                const Icon = groupIcons[group.type] ?? Search;
                return (
                  <div className="search-group" key={group.type}>
                    <p>{group.label}</p>
                    {group.items.map((item) => (
                      <Link href={item.href} key={`${group.type}-${item.id}`} onClick={close}>
                        <i><Icon size={16} /></i>
                        <span><strong>{item.title}</strong><small>{item.subtitle}</small></span>
                        <em>{item.meta}</em>
                      </Link>
                    ))}
                  </div>
                );
              })}
            </div>
            <footer className="search-footer"><span><kbd>ESC</kbd> fechar</span><strong>{result.total ? `${result.total} resultado${result.total === 1 ? "" : "s"}` : "Busca segura por projeto"}</strong></footer>
          </section>
        </div>
      )}
    </>
  );
}
