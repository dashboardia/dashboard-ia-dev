"use client";

import { Braces, ExternalLink, LoaderCircle, MonitorPlay, RefreshCw, Server } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const stateLabels = {
  NOT_READY: "Aguardando Pull Request",
  PREPARING: "Preparando",
  AVAILABLE: "Disponível",
  FAILED: "Indisponível",
  UNAVAILABLE: "Não configurado",
};

export default function PreviewCard({ executionId }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/executions/${executionId}/preview`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível consultar o preview");
      setPreview(result.preview);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [executionId]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (preview?.state !== "PREPARING") return undefined;
    const timer = setTimeout(load, 10_000);
    return () => clearTimeout(timer);
  }, [load, preview?.state]);

  const inspection = preview?.inspection;
  const api = preview?.mode === "API";
  return (
    <section className="form-card detail-card full-card interactive-preview-card">
      <div className="card-heading">
        <div><h2>Preview da implementação</h2><p>Visualização real publicada pelo provedor conectado ao repositório.</p></div>
        {api ? <Server size={20} /> : <MonitorPlay size={20} />}
      </div>

      {loading && !preview ? <div className="preview-state"><LoaderCircle className="spin" size={18} /><span><strong>Localizando preview</strong><small>Consultando deployments do commit no GitHub.</small></span></div> : null}
      {error ? <div className="form-error">{error}</div> : null}
      {preview && <div className="preview-content">
        <div className="preview-toolbar">
          <span className={`status-pill preview-${preview.state?.toLowerCase()}`}>{stateLabels[preview.state] ?? preview.state}</span>
          {preview.provider && <small>{preview.environment ?? "Preview"} · {preview.provider}</small>}
          <button className="secondary compact" disabled={loading} onClick={load} type="button">{loading ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}Atualizar</button>
          {preview.url && <a className="primary compact" href={preview.url} target="_blank" rel="noreferrer" referrerPolicy="no-referrer"><ExternalLink size={14} />{api ? "Abrir API" : "Navegar no preview"}</a>}
        </div>

        {preview.state === "NOT_READY" && <div className="list-empty">{preview.message}</div>}
        {preview.state === "PREPARING" && <div className="preview-state"><LoaderCircle className="spin" size={18} /><span><strong>O provedor ainda está preparando o ambiente</strong><small>Esta tela será atualizada automaticamente.</small></span></div>}
        {preview.state === "FAILED" && <div className="form-error">{preview.message ?? "O deployment de preview não ficou disponível."}</div>}
        {preview.state === "UNAVAILABLE" && <div className="list-empty">{preview.message ?? "O projeto não possui um provedor de preview conectado ao GitHub."}</div>}

        {preview.state === "AVAILABLE" && api && inspection && <div className="api-preview">
          <div className="api-preview-heading"><Braces size={17} /><span><strong>{inspection.title}</strong><small>{inspection.version ? `Versão ${inspection.version}` : "Endpoints detectados automaticamente"}</small></span>{inspection.documentationUrl && <a href={inspection.documentationUrl} target="_blank" rel="noreferrer" referrerPolicy="no-referrer">Abrir OpenAPI</a>}</div>
          {inspection.example && <div className="api-example"><div><code>{inspection.example.method}</code><strong>{inspection.example.path}</strong><span>HTTP {inspection.example.status}</span></div><pre>{inspection.example.body || "Resposta sem conteúdo"}</pre></div>}
          {inspection.endpoints?.length > 0 && <details className="api-endpoints"><summary>Ver {inspection.endpoints.length} endpoints detectados</summary><div>{inspection.endpoints.map((endpoint) => <span key={`${endpoint.method}:${endpoint.path}`}><code>{endpoint.method}</code><strong>{endpoint.path}</strong><small>{endpoint.summary ?? "Sem descrição"}</small></span>)}</div></details>}
        </div>}

        {preview.state === "AVAILABLE" && !api && <div className="preview-state preview-ready"><MonitorPlay size={20} /><span><strong>Aplicação pronta para navegação</strong><small>O preview abre em uma aba isolada e não altera o ambiente de produção.</small></span></div>}
      </div>}
    </section>
  );
}
