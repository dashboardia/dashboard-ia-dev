"use client";

import { CheckCircle2, LoaderCircle, Save, TriangleAlert } from "lucide-react";
import { useState } from "react";

import {
  MAX_PARALLEL_EXECUTIONS,
  NODE_MEMORY_OPTIONS_MB,
} from "../../lib/execution-limits";

export default function GlobalSettingsForm({ initialSettings, workerInstances = 0 }) {
  const [form, setForm] = useState({
    timeZone: initialSettings.timeZone,
    nodeMemoryMb: String(initialSettings.nodeMemoryMb),
    commandTimeoutMinutes: String(initialSettings.commandTimeoutMinutes),
    agentTimeoutMinutes: String(initialSettings.agentTimeoutMinutes),
    parallelExecutions: String(initialSettings.parallelExecutions),
    workerAutoscalingEnabled: initialSettings.workerAutoscalingEnabled,
    workerMinReplicas: String(initialSettings.workerMinReplicas),
    workerMaxReplicas: String(initialSettings.workerMaxReplicas),
    workerAutoscaleIntervalSeconds: String(initialSettings.workerAutoscaleIntervalSeconds),
    workerScaleDownCooldownMinutes: String(initialSettings.workerScaleDownCooldownMinutes),
    executionProcessingEnabled: initialSettings.executionProcessingEnabled,
    agentPowerMode: initialSettings.agentPowerMode,
    executionMaxAttempts: String(initialSettings.executionMaxAttempts),
    staleExecutionMinutes: String(initialSettings.staleExecutionMinutes),
    healthCheckIntervalMinutes: String(initialSettings.healthCheckIntervalMinutes),
    healthCheckTimeoutSeconds: String(initialSettings.healthCheckTimeoutSeconds),
    healthCheckConcurrency: String(initialSettings.healthCheckConcurrency),
    healthCheckRetentionDays: String(initialSettings.healthCheckRetentionDays),
    previewPreparationTimeoutMinutes: String(initialSettings.previewPreparationTimeoutMinutes),
    environmentTtlMinutes: String(initialSettings.environmentTtlMinutes),
    environmentCreditCost: String(initialSettings.environmentCreditCost),
    environmentMaxPerUser: String(initialSettings.environmentMaxPerUser),
    executionConversationTimeoutMinutes: String(initialSettings.executionConversationTimeoutMinutes),
    executionConversationMaxAdjustments: String(initialSettings.executionConversationMaxAdjustments),
    financialShadowEnabled: initialSettings.financialShadowEnabled,
    usdToBrlCents: String(initialSettings.usdToBrlCents),
    aiSafetyPercent: String(initialSettings.aiSafetyPercent),
    targetGrossMarginPercent: String(initialSettings.targetGrossMarginPercent),
    creditValueCents: String(initialSettings.creditValueCents),
    reservationBufferPercent: String(initialSettings.reservationBufferPercent),
    creditBalanceSafetyMarginPercent: String(initialSettings.creditBalanceSafetyMarginPercent),
    workerCostCentsPerHour: String(initialSettings.workerCostCentsPerHour),
    visualValidationCostCents: String(initialSettings.visualValidationCostCents),
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const requestedCapacity = Math.max(1, Number(form.workerAutoscalingEnabled ? form.workerMaxReplicas : form.parallelExecutions) || 1);
  const effectiveCapacity = Math.min(requestedCapacity, workerInstances);

  function change(event) {
    setSaved(false);
    setError("");
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [event.target.name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.fields?.[0]?.message ?? result.error ?? "Não foi possível salvar");
      setSaved(true);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form-card detail-card full-card" onSubmit={submit}>
      <div className="card-heading">
        <div>
          <h2>Execução global</h2>
          <p>Padrões aplicados pelo worker a todos os projetos</p>
        </div>
        <label className="financial-shadow-toggle">
          <input name="executionProcessingEnabled" type="checkbox" checked={form.executionProcessingEnabled} onChange={change} />
          <span>{form.executionProcessingEnabled ? "Processamentos ligados" : "Processamentos pausados"}</span>
        </label>
      </div>
      {!form.executionProcessingEnabled && <div className="form-error"><TriangleAlert size={16} />Novas execuções serão bloqueadas. Execuções na fila serão paradas imediatamente e trabalhos ativos serão interrompidos com segurança. Ao religar, cada cliente deverá reprocessar manualmente as demandas paradas.</div>}
      <div className="form-grid">
        <label>
          <span>Fuso horário</span>
          <select name="timeZone" value={form.timeZone} onChange={change}>
            <option value="America/Sao_Paulo">Brasil — São Paulo</option>
            <option value="UTC">UTC</option>
          </select>
        </label>
        <label>
          <span>Potência global do agente</span>
          <select name="agentPowerMode" value={form.agentPowerMode} onChange={change}>
            <option value="ECONOMY">Econômica</option>
            <option value="BALANCED">Equilibrada</option>
            <option value="MAXIMUM">Máxima</option>
          </select>
          <small>Controla raciocínio, quantidade de interações, tokens de saída e tempo mínimo conforme o escopo.</small>
        </label>
        <label>
          <span>Memória máxima do Node por execução</span>
          <select name="nodeMemoryMb" value={form.nodeMemoryMb} onChange={change}>
            {NODE_MEMORY_OPTIONS_MB.map((memoryMb) => (
              <option key={memoryMb} value={memoryMb}>
                {memoryMb >= 1024 ? `${memoryMb / 1024} GB` : `${memoryMb} MB`}
              </option>
            ))}
          </select>
          <small>Limite aplicado a cada execução isolada. Para builds Vite maiores, use 1 GB.</small>
        </label>
        <label>
          <span>Capacidade global</span>
          <input name="parallelExecutions" type="number" min="1" max={MAX_PARALLEL_EXECUTIONS} value={form.parallelExecutions} onChange={change} disabled={form.workerAutoscalingEnabled} />
          <small>{form.workerAutoscalingEnabled ? "Controlada automaticamente pelo máximo de réplicas." : `${workerInstances} réplica(s) ativa(s); capacidade efetiva agora: ${effectiveCapacity}.`}</small>
        </label>
        <label>
          <span>Autoscaling do Worker</span>
          <input name="workerAutoscalingEnabled" type="checkbox" checked={form.workerAutoscalingEnabled} onChange={change} />
          <small>{form.workerAutoscalingEnabled ? "Ativo: ajusta réplicas conforme a fila." : "Inativo: mantém a escala configurada manualmente no Railway."}</small>
        </label>
        <label>
          <span>Mínimo de réplicas</span>
          <input name="workerMinReplicas" type="number" min="1" max={MAX_PARALLEL_EXECUTIONS} value={form.workerMinReplicas} onChange={change} disabled={!form.workerAutoscalingEnabled} />
          <small>Capacidade mantida mesmo sem fila. Recomendado: 2.</small>
        </label>
        <label>
          <span>Máximo de réplicas</span>
          <input name="workerMaxReplicas" type="number" min="1" max={MAX_PARALLEL_EXECUTIONS} value={form.workerMaxReplicas} onChange={change} disabled={!form.workerAutoscalingEnabled} />
          <small>Teto de custo e simultaneidade. Recomendado inicial: 10.</small>
        </label>
        <label>
          <span>Verificar fila a cada (s)</span>
          <input name="workerAutoscaleIntervalSeconds" type="number" min="30" max="300" value={form.workerAutoscaleIntervalSeconds} onChange={change} disabled={!form.workerAutoscalingEnabled} />
          <small>Escala para cima imediatamente em cada verificação.</small>
        </label>
        <label>
          <span>Cooldown para reduzir (min)</span>
          <input name="workerScaleDownCooldownMinutes" type="number" min="1" max="60" value={form.workerScaleDownCooldownMinutes} onChange={change} disabled={!form.workerAutoscalingEnabled} />
          <small>Reduz uma réplica por vez para evitar oscilações.</small>
        </label>
        <label>
          <span>Timeout de cada comando</span>
          <input name="commandTimeoutMinutes" type="number" min="1" max="30" value={form.commandTimeoutMinutes} onChange={change} />
          <small>Minutos para instalação, lint, testes e build.</small>
        </label>
        <label>
          <span>Timeout do agente</span>
          <input name="agentTimeoutMinutes" type="number" min="1" max="30" value={form.agentTimeoutMinutes} onChange={change} />
          <small>Minutos máximos para implementação.</small>
        </label>
        <label><span>Máximo de tentativas</span><input name="executionMaxAttempts" type="number" min="1" max="10" value={form.executionMaxAttempts} onChange={change} /><small>Quantidade máxima de retomadas automáticas após interrupção do worker.</small></label>
        <label><span>Execução travada após</span><input name="staleExecutionMinutes" type="number" min="5" max="180" value={form.staleExecutionMinutes} onChange={change} /><small>Minutos sem progresso antes de liberar ou encerrar uma execução órfã.</small></label>
      </div>
      <div className="financial-settings">
        <div className="card-heading"><div><h3>Monitoramento, ambientes e interação</h3><p>Parâmetros operacionais aplicados em tempo real.</p></div></div>
        <div className="form-grid three-columns">
          <label><span>Intervalo de saúde (min)</span><input name="healthCheckIntervalMinutes" type="number" min="1" max="60" value={form.healthCheckIntervalMinutes} onChange={change} /><small>Frequência de verificação das URLs de produção.</small></label>
          <label><span>Timeout de saúde (s)</span><input name="healthCheckTimeoutSeconds" type="number" min="2" max="60" value={form.healthCheckTimeoutSeconds} onChange={change} /><small>Tempo máximo por projeto monitorado.</small></label>
          <label><span>Checagens simultâneas</span><input name="healthCheckConcurrency" type="number" min="1" max="25" value={form.healthCheckConcurrency} onChange={change} /><small>Projetos verificados em paralelo.</small></label>
          <label><span>Retenção da saúde (dias)</span><input name="healthCheckRetentionDays" type="number" min="1" max="365" value={form.healthCheckRetentionDays} onChange={change} /><small>Histórico mantido no banco.</small></label>
          <label><span>Espera do ambiente (min)</span><input name="previewPreparationTimeoutMinutes" type="number" min="1" max="60" value={form.previewPreparationTimeoutMinutes} onChange={change} /><small>Quando uma subida presa em preparação passa a ser considerada falha.</small></label>
          <label><span>Duração do ambiente (min)</span><input name="environmentTtlMinutes" type="number" min="15" max="1440" value={form.environmentTtlMinutes} onChange={change} /><small>Tempo de vida do container antes da expiração automática.</small></label>
          <label><span>Custo por ambiente publicado (créditos)</span><input name="environmentCreditCost" type="number" min="0" max="100000" value={form.environmentCreditCost} onChange={change} /><small>O saldo fica protegido durante o build e só é cobrado quando o ambiente estiver disponível. Falhas não consomem créditos.</small></label>
          <label><span>Ambientes por usuário</span><input name="environmentMaxPerUser" type="number" min="1" max="20" value={form.environmentMaxPerUser} onChange={change} /><small>Quantidade máxima de ambientes ativos por usuário.</small></label>
          <label><span>Inatividade da execução (min)</span><input name="executionConversationTimeoutMinutes" type="number" min="1440" max="10080" value={form.executionConversationTimeoutMinutes} onChange={change} /><small>Mínimo: 1.440 minutos (24 horas) sem interação do usuário.</small></label>
          <label><span>Máximo de ajustes</span><input name="executionConversationMaxAdjustments" type="number" min="1" max="100" value={form.executionConversationMaxAdjustments} onChange={change} /><small>Limite de respostas do cliente dentro da mesma execução.</small></label>
        </div>
      </div>
      <div className="financial-settings">
        <div className="card-heading">
          <div>
            <h3>Modo financeiro silencioso</h3>
            <p>Calcula custo, créditos e margem para calibração. Não cobra nem bloqueia o cliente.</p>
          </div>
          <label className="financial-shadow-toggle">
            <input name="financialShadowEnabled" type="checkbox" checked={form.financialShadowEnabled} onChange={change} />
            <span>{form.financialShadowEnabled ? "Ativo" : "Inativo"}</span>
          </label>
        </div>
        <div className="form-grid three-columns">
          <label><span>Cotação interna do dólar (centavos)</span><input name="usdToBrlCents" type="number" min="100" max="2000" value={form.usdToBrlCents} onChange={change} /><small>600 representa R$ 6,00 por US$ 1.</small></label>
          <label><span>Margem de segurança da IA (%)</span><input name="aiSafetyPercent" type="number" min="0" max="100" value={form.aiSafetyPercent} onChange={change} /><small>Proteção aplicada após converter o custo em dólar.</small></label>
          <label><span>Margem bruta alvo (%)</span><input name="targetGrossMarginPercent" type="number" min="50" max="95" value={form.targetGrossMarginPercent} onChange={change} /><small>Define quanto custo interno cabe em cada crédito.</small></label>
          <label><span>Referência interna do crédito (centavos)</span><input name="creditValueCents" type="number" min="1" max="1000" value={form.creditValueCents} onChange={change} /><small>Usada na calibração financeira. Preços dos pacotes são administrados no Catálogo.</small></label>
          <label><span>Margem da estimativa (%)</span><input name="reservationBufferPercent" type="number" min="0" max="100" value={form.reservationBufferPercent} onChange={change} /><small>Margem preventiva adicionada ao limite estimado antes da execução.</small></label>
          <label><span>Margem de continuidade do saldo (%)</span><input name="creditBalanceSafetyMarginPercent" type="number" min="0" max="100" value={form.creditBalanceSafetyMarginPercent} onChange={change} /><small>Permite concluir uma execução além do saldo disponível. O padrão é 20%; o excedente vira saldo devedor e bloqueia novas execuções.</small></label>
          <label><span>Worker por hora (centavos)</span><input name="workerCostCentsPerHour" type="number" min="0" max="100000" value={form.workerCostCentsPerHour} onChange={change} /><small>100 representa R$ 1,00 por hora de execução.</small></label>
          <label><span>Validação visual fixa (centavos)</span><input name="visualValidationCostCents" type="number" min="0" max="100000" value={form.visualValidationCostCents} onChange={change} /><small>Somada apenas quando a demanda exige evidências visuais.</small></label>
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        {saved && <span className="form-success"><CheckCircle2 size={15} />Configurações salvas</span>}
        <button className="primary" type="submit" disabled={saving}>
          {saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
          {saving ? "Salvando..." : "Salvar configurações globais"}
        </button>
      </div>
    </form>
  );
}
