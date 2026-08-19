"use client";

import { Lightbulb, LoaderCircle, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AI_MODELS, DEFAULT_AI_MODEL } from "../../../lib/ai-models";

const DEMAND_EXAMPLES = {
  BUG: {
    label: "Correção",
    title: "Corrigir perda dos dados ao voltar no cadastro",
    description: "No fluxo /cadastro, após preencher a etapa 2 e clicar em Voltar, os dados da etapa 1 são apagados. O usuário precisa preencher tudo novamente. Manter os valores já informados ao navegar entre as etapas, sem alterar as validações atuais.",
    acceptanceCriteria: "- Os campos preenchidos permanecem ao voltar e avançar.\n- A correção funciona em desktop e celular.\n- O envio final continua validando os campos obrigatórios.",
  },
  FEATURE: {
    label: "Nova funcionalidade",
    title: "Adicionar filtro por período no histórico de pedidos",
    description: "Na página /pedidos, permitir que o usuário filtre o histórico por data inicial e final. O filtro deve ser aplicado à listagem existente e permanecer na URL para poder ser compartilhado.",
    acceptanceCriteria: "- O período inicial não pode ser posterior ao final.\n- A listagem mostra apenas pedidos dentro do período.\n- Limpar filtros restaura a listagem completa.\n- O layout funciona em desktop e celular.",
  },
  REFACTOR: {
    label: "Refatoração",
    title: "Centralizar validação de permissões dos projetos",
    description: "As rotas de projetos repetem regras de acesso em pontos diferentes. Centralizar a validação no módulo de acesso existente, mantendo os mesmos papéis e respostas atuais da API.",
    acceptanceCriteria: "- Não alterar o comportamento das permissões existentes.\n- Remover a duplicação das regras nas rotas afetadas.\n- Manter ou adicionar testes para Gestor, Desenvolvedor e Visualizador.",
  },
  TEST: {
    label: "Testes",
    title: "Cobrir renovação e cancelamento de assinatura",
    description: "Adicionar testes automatizados para o ciclo de cobrança: confirmação do pagamento, renovação mensal, cancelamento e tentativa de processar novamente o mesmo webhook.",
    acceptanceCriteria: "- Cobrir os quatro cenários descritos.\n- Garantir idempotência do webhook.\n- A suíte completa deve continuar passando.",
  },
  INVESTIGATION: {
    label: "Investigação",
    title: "Investigar lentidão ao carregar a página de projetos",
    description: "A página /projects leva entre 8 e 12 segundos para abrir quando a conta possui muitos repositórios. Identificar a origem com evidências e propor a correção mais segura, sem implementar mudanças antes da conclusão.",
    acceptanceCriteria: "- Apresentar a causa comprovada da lentidão.\n- Indicar consultas ou chamadas responsáveis pelo tempo.\n- Recomendar solução, riscos e forma de validação.",
  },
  DOCUMENTATION: {
    label: "Documentação de negócio",
    title: "Documentar o fluxo de aprovação de pedidos",
    description: "Gerar documentação de negócio do fluxo de aprovação de pedidos a partir do código atual. Explicar atores, regras, estados, exceções e integrações em linguagem adequada para clientes e gestores.",
    acceptanceCriteria: "- Não expor segredos nem detalhes internos desnecessários.\n- Separar regras confirmadas de inferências.\n- Entregar DOCX e PDF com fluxo, regras e exceções.",
  },
};

export default function DemandForm({ projects, initialProjectId }) {
  const router = useRouter();
  const [form, setForm] = useState({
    projectId: projects.some((project) => project.id === initialProjectId) ? initialProjectId : "",
    title: "",
    description: "",
    acceptanceCriteria: "",
    type: "BUG",
    priority: "NORMAL",
    visualValidation: false,
    visualPaths: "/",
    aiModel: DEFAULT_AI_MODEL,
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const example = DEMAND_EXAMPLES[form.type];

  function change(event) {
    const { name, type, checked, value } = event.target;
    setForm((current) => name === "type" && value === "DOCUMENTATION"
      ? { ...current, type: value, aiModel: "gpt-5.6-luna", visualValidation: false, visualPaths: "/" }
      : { ...current, [name]: type === "checkbox" ? checked : value });
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = { ...form, visualPaths: form.visualValidation ? form.visualPaths.split("\n").map((path) => path.trim()).filter(Boolean) : [] };
      const response = await fetch("/api/demands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível criar a demanda");
      router.push(`/demands/${result.demand.id}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError.message);
      setSaving(false);
    }
  }

  if (!projects.length) return <div className="form-card resource-empty"><strong>Sem projetos disponíveis</strong><span>Você precisa ser Gestor ou Desenvolvedor em pelo menos um projeto.</span></div>;

  return (
    <form className="form-card" onSubmit={submit}>
      <div className="form-grid three-columns demand-basics">
        <label><span>Projeto e repositório</span><select name="projectId" value={form.projectId} onChange={change} required><option value="" disabled>Selecione o destino da demanda</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name} — {project.repositoryFullName}</option>)}</select></label>
        <label><span>Tipo</span><select name="type" value={form.type} onChange={change}><option value="BUG">Correção</option><option value="FEATURE">Nova funcionalidade</option><option value="REFACTOR">Refatoração</option><option value="TEST">Testes</option><option value="INVESTIGATION">Investigação</option><option value="DOCUMENTATION">Documentação de negócio</option></select></label>
        <label><span>Prioridade</span><select name="priority" value={form.priority} onChange={change}><option value="LOW">Baixa</option><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option></select></label>
      </div>
      <details className="demand-example full-field">
        <summary><Lightbulb size={17} /><span><strong>Ver exemplo de {example.label.toLowerCase()}</strong><small>Use este nível de detalhe para obter uma implementação mais precisa.</small></span></summary>
        <div><span><small>Título</small><strong>{example.title}</strong></span><span><small>Contexto e resultado esperado</small><p>{example.description}</p></span><span><small>Critérios de aceite</small><p>{example.acceptanceCriteria}</p></span></div>
      </details>
      <label className="full-field"><span>Título</span><input name="title" value={form.title} onChange={change} maxLength={140} placeholder={`Ex.: ${example.title}`} required /><small className="field-guidance">Resuma a alteração e o local afetado.</small></label>
      <label className="full-field"><span>Contexto e resultado esperado</span><textarea name="description" value={form.description} onChange={change} rows={7} placeholder={example.description} required /><small className="field-guidance">Explique o comportamento atual, onde acontece e como deve funcionar depois.</small></label>
      <label className="full-field"><span>Critérios de aceite</span><textarea name="acceptanceCriteria" value={form.acceptanceCriteria} onChange={change} rows={4} placeholder={example.acceptanceCriteria} /><small className="field-guidance">Liste condições objetivas que possam ser testadas ao final.</small></label>
      <fieldset className="model-selector full-field">
        <legend>Modelo de IA</legend>
        <p>Escolha o nível de capacidade adequado para esta demanda.</p>
        <div className="model-options">
          {AI_MODELS.map((option) => <label className={form.aiModel === option.value ? "selected" : ""} key={option.value}><input type="radio" name="aiModel" value={option.value} checked={form.aiModel === option.value} onChange={change} /><span><strong>{option.label}</strong><em>{option.model}</em><small>{option.description}</small></span></label>)}
        </div>
      </fieldset>
      {form.type !== "DOCUMENTATION" && <label className="visual-validation-option"><input name="visualValidation" type="checkbox" checked={form.visualValidation} onChange={change} /><span><strong>Exigir validação visual</strong><small>Gera evidências em desktop e celular, sem substituir a aprovação do código.</small></span></label>}
      {form.type !== "DOCUMENTATION" && form.visualValidation && <label className="full-field"><span>Rotas para validar (uma por linha)</span><textarea name="visualPaths" value={form.visualPaths} onChange={change} rows={3} placeholder={'/\n/login\n/dashboard'} required /></label>}
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions"><button className="primary" disabled={saving} type="submit">{saving ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}{saving ? "Criando..." : "Enviar para aprovação"}</button></div>
    </form>
  );
}
