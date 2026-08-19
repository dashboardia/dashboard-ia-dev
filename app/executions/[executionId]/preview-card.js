"use client";

/* eslint-disable @next/next/no-img-element -- imagens privadas de altura variável servidas por rota autenticada */

import { Braces, ExternalLink, Images, LoaderCircle, MonitorPlay, RefreshCw, Server } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const stateLabels = {
  NOT_READY: "Aguardando Pull Request",
  PREPARING: "Preparando",
  AVAILABLE: "Disponível",
  EVIDENCE: "Evidência visual",
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
        {preview?.state === "EVIDENCE" ? <Images size={20} /> : api ? <Server size={20} /> : <MonitorPlay size={20} />}
      </div>

      {loading && !preview ? <div className="preview-state"><LoaderCircle className="spin" size={18} /><span><strong>Localizando preview</strong><small>Consultando deployments do commit no GitHub.</small></span></div> : null}
      {error ? <div className="form-error">{error}</div> : null}
      {preview && <div className="preview-content">
        <div className="preview-toolbar">
          <span className={`status-pill preview-${preview.state?.toLowerCase()}`}>{stateLabels[preview.state] ?? preview.state}</span>
          {preview.provider && <small>{preview.environment ?? "Preview"} · {preview.provider}</small>}
          <button className="preview-refresh-button" disabled={loading} onClick={load} type="button">{loading ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}<span>{loading ? "Consultando" : "Sincronizar"}</span></button>
          {preview.url && <a className="primary compact" href={preview.url} target="_blank" rel="noreferrer" referrerPolicy="no-referrer"><ExternalLink size={14} />{api ? "Abrir API" : "Navegar no preview"}</a>}
        </div>

        {preview.state === "NOT_READY" && <div className="list-empty">{preview.message}</div>}
        {preview.state === "PREPARING" && <div className="preview-state"><LoaderCircle className="spin" size={18} /><span><strong>Preparando o ambiente de preview</strong><small>Atualização automática ativa. O Dashboardia consulta deployments, checks e comentários do PR. A espera termina após {preview.timeoutMinutes ?? 15} minutos sem avanço.</small></span></div>}
        {preview.state === "FAILED" && <div className="form-error">{preview.message ?? "O deployment de preview não ficou disponível."}</div>}
        {preview.state === "UNAVAILABLE" && <div className="preview-unavailable"><strong>O código está pronto, mas não existe um ambiente publicado</strong><p>{preview.message ?? "O projeto não possui um provedor de preview conectado ao GitHub."}</p><small>No Render, abra o serviço → Previews → Pull Request Previews e selecione Automatic. No Railway, habilite PR Environments no serviço.</small></div>}
        {preview.state === "EVIDENCE" && <div className="preview-evidence">
          <div className="preview-evidence-heading"><Images size={17} /><span><strong>Resultado visual da implementação</strong><small>{preview.message}</small></span></div>
          <div className="preview-evidence-grid">{preview.evidence?.map((item) => <figure key={item.id}><a href={item.url} target="_blank" rel="noreferrer"><img src={item.url} alt={`Preview ${item.route} em ${item.viewport}`} loading="lazy" /></a><figcaption><strong>{item.route}</strong><span>{item.viewport === "mobile" ? "Celular" : "Desktop"}</span></figcaption></figure>)}</div>
          <small className="preview-evidence-footnote">Esta é uma captura do código executado pelo worker. Para navegar na página, o provedor ainda precisa publicar um Pull Request Preview.</small>
        </div>}

        {preview.state === "AVAILABLE" && api && inspection && <div className="api-preview">
          <div className="api-preview-heading"><Braces size={17} /><span><strong>{inspection.title}</strong><small>{inspection.version ? `Versão ${inspection.version}` : "Endpoints detectados automaticamente"}</small></span>{inspection.documentationUrl && <a href={inspection.documentationUrl} target="_blank" rel="noreferrer" referrerPolicy="no-referrer">Abrir OpenAPI</a>}</div>
          {inspection.example && <div className="api-example"><div><code>{inspection.example.method}</code><strong>{inspection.example.path}</strong><span>HTTP {inspection.example.status}</span></div><pre>{inspection.example.body || "Resposta sem conteúdo"}</pre></div>}
          {inspection.endpoints?.length > 0 && <details className="api-endpoints"><summary>Ver {inspection.endpoints.length} endpoints detectados</summary><div>{inspection.endpoints.map((endpoint) => <span key={`${endpoint.method}:${endpoint.path}`}><code>{endpoint.method}</code><strong>{endpoint.path}</strong><small>{endpoint.summary ?? "Sem descrição"}</small></span>)}</div></details>}
        </div>}

        {preview.state === "AVAILABLE" && !api && <div className="web-preview"><div className="web-preview-address"><span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" /><code>{preview.url}</code><a href={preview.url} target="_blank" rel="noreferrer" referrerPolicy="no-referrer"><ExternalLink size={13} />Abrir em nova aba</a></div><iframe src={preview.url} title="Preview navegável da implementação" sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts" referrerPolicy="no-referrer" loading="lazy" /><small>Ambiente isolado do provedor. Se a aplicação bloquear incorporação, use “Abrir em nova aba”.</small></div>}
      </div>}
    </section>
  );
}
