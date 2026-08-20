"use client";

import { CirclePlus, Pencil, Save, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

const emptyPlan = {
  code: "",
  name: "",
  description: "",
  priceCents: "",
  includedCredits: "",
  projectLimit: "",
  parallelExecutionLimit: "",
  trialDays: "",
  active: true,
  public: true,
  sortOrder: 50,
  structural: false,
};

const emptyPack = {
  code: "",
  name: "",
  credits: "",
  priceCents: "",
  validityMonths: 12,
  active: true,
  public: true,
  sortOrder: 50,
  structural: false,
};

function editablePlan(plan) {
  return Object.fromEntries(Object.entries(plan).map(([key, value]) => [key, value ?? ""]));
}

function moneyFromCents(cents, digits = 4) {
  if (cents == null || !Number.isFinite(Number(cents))) return "Sem medição";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: digits }).format(Number(cents) / 100);
}

function formatPlanPrice(cents) {
  if (cents == null) return "Sob consulta";
  if (cents === 0) return "Grátis";
  return moneyFromCents(cents, 2);
}

function effectiveCreditValueCents(plan) {
  return plan?.priceCents && plan?.includedCredits ? plan.priceCents / plan.includedCredits : null;
}

export default function CatalogManager({ initialPlans, initialPacks, creditValueCents, targetGrossMarginPercent, observedCostPerCreditCents }) {
  const [plans, setPlans] = useState(initialPlans);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [packs, setPacks] = useState(initialPacks);
  const [editingPack, setEditingPack] = useState(null);
  const [packSaving, setPackSaving] = useState(false);
  const [packError, setPackError] = useState("");
  const [packMessage, setPackMessage] = useState("");
  const targetCostPerCreditCents = Math.max(1, creditValueCents * (100 - targetGrossMarginPercent) / 100);
  const orderedPlans = useMemo(() => [...plans].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)), [plans]);
  const orderedPacks = useMemo(() => [...packs].sort((left, right) => left.sortOrder - right.sortOrder || left.credits - right.credits), [packs]);

  function startCreate() {
    setError("");
    setMessage("");
    setEditing({ ...emptyPlan, _creating: true });
  }

  function startEdit(plan) {
    setError("");
    setMessage("");
    setEditing({ ...editablePlan(plan), _creating: false });
  }

  function change(event) {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setEditing((current) => ({ ...current, [event.target.name]: event.target.name === "code" ? String(value).toUpperCase() : value }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    const creating = editing._creating;
    try {
      const response = await fetch("/api/catalog/plans", {
        method: creating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.fields?.[0]?.message ?? result.error ?? "Não foi possível salvar o plano");
      setPlans((current) => creating ? [...current, result.plan] : current.map((plan) => plan.code === result.plan.code ? result.plan : plan));
      setEditing(null);
      setMessage(creating ? "Plano criado." : "Plano atualizado.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(plan) {
    if (!window.confirm(`Excluir definitivamente o plano ${plan.name}?`)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/catalog/plans", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: plan.code }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível excluir o plano");
      setPlans((current) => current.filter((item) => item.code !== plan.code));
      setMessage("Plano excluído.");
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setSaving(false);
    }
  }

  function startCreatePack() {
    setPackError("");
    setPackMessage("");
    setEditingPack({ ...emptyPack, _creating: true });
  }

  function startEditPack(pack) {
    setPackError("");
    setPackMessage("");
    setEditingPack({ ...editablePlan(pack), _creating: false });
  }

  function changePack(event) {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setEditingPack((current) => ({ ...current, [event.target.name]: event.target.name === "code" ? String(value).toUpperCase() : value }));
  }

  async function savePack(event) {
    event.preventDefault();
    setPackSaving(true);
    setPackError("");
    setPackMessage("");
    const creating = editingPack._creating;
    try {
      const response = await fetch("/api/catalog/packs", {
        method: creating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingPack),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.fields?.[0]?.message ?? result.error ?? "Não foi possível salvar o pacote");
      setPacks((current) => creating ? [...current, result.pack] : current.map((pack) => pack.code === result.pack.code ? result.pack : pack));
      setEditingPack(null);
      setPackMessage(creating ? "Pacote criado." : "Pacote atualizado.");
    } catch (saveError) {
      setPackError(saveError.message);
    } finally {
      setPackSaving(false);
    }
  }

  async function removePack(pack) {
    if (!window.confirm(`Excluir definitivamente o pacote ${pack.name}?`)) return;
    setPackSaving(true);
    setPackError("");
    setPackMessage("");
    try {
      const response = await fetch("/api/catalog/packs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: pack.code }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível excluir o pacote");
      setPacks((current) => current.filter((item) => item.code !== pack.code));
      setPackMessage("Pacote excluído.");
    } catch (deleteError) {
      setPackError(deleteError.message);
    } finally {
      setPackSaving(false);
    }
  }

  return <div className="catalog-manager"><section className="form-card detail-card full-card plan-catalog">
    <div className="card-heading">
      <div><h2>Planos, preços e créditos</h2><p>Catálogo usado pelo checkout, renovações, limites e saldo mensal.</p></div>
      <button className="secondary-button" type="button" onClick={startCreate}><CirclePlus size={16} />Novo plano</button>
    </div>

    <div className="credit-unit-grid">
      <span><small>Referência comercial / crédito</small><strong>{moneyFromCents(creditValueCents, 2)}</strong><em>Calibração interna; pacotes têm preço próprio</em></span>
      <span><small>Dashboardia · custo-alvo</small><strong>{moneyFromCents(targetCostPerCreditCents)}</strong><em>Margem bruta alvo de {targetGrossMarginPercent}%</em></span>
      <span><small>Dashboardia · custo observado</small><strong>{moneyFromCents(observedCostPerCreditCents)}</strong><em>Média dos snapshots medidos</em></span>
    </div>
    <p className="plan-cost-note">O custo observado é o indicador mais próximo do real disponível: soma IA, worker e validação visual registrados por execução. Custos fixos gerais não atribuídos a clientes não entram nessa média.</p>

    <div className="plan-admin-list">
      {orderedPlans.map((plan) => {
        const unitValue = effectiveCreditValueCents(plan);
        return <article key={plan.code} className={!plan.active ? "inactive" : ""}>
          <div className="plan-admin-main">
            <span className="plan-admin-title"><strong>{plan.name}</strong><code>{plan.code}</code></span>
            <small>{plan.description || "Sem descrição"}</small>
            <div className="plan-admin-badges"><em>{plan.active ? "Ativo" : "Inativo"}</em><em>{plan.public ? "Visível ao cliente" : "Oculto"}</em>{plan.structural && <em>Estrutural</em>}</div>
          </div>
          <div className="plan-admin-metrics">
            <span><small>Mensalidade</small><strong>{formatPlanPrice(plan.priceCents)}</strong></span>
            <span><small>Créditos</small><strong>{plan.includedCredits?.toLocaleString("pt-BR") ?? "—"}</strong></span>
            <span><small>Cliente / crédito</small><strong>{moneyFromCents(unitValue)}</strong></span>
            <span><small>Projetos / paralelas</small><strong>{plan.projectLimit ?? "∞"} / {plan.parallelExecutionLimit ?? "∞"}</strong></span>
          </div>
          <div className="plan-admin-actions">
            <button type="button" title="Editar plano" onClick={() => startEdit(plan)}><Pencil size={16} /></button>
            {!plan.structural && <button type="button" title="Excluir plano" disabled={saving} onClick={() => remove(plan)}><Trash2 size={16} /></button>}
          </div>
        </article>;
      })}
    </div>

    {editing && <form className="plan-editor" onSubmit={save}>
      <div className="card-heading"><div><h3>{editing._creating ? "Criar plano" : `Editar ${editing.name}`}</h3><p>Os valores salvos passam a ser a fonte oficial da cobrança e dos limites.</p></div><button type="button" className="icon-button" onClick={() => setEditing(null)}><X size={17} /></button></div>
      <div className="form-grid three-columns">
        <label><span>Código</span><input name="code" value={editing.code} onChange={change} disabled={!editing._creating} placeholder="PRO" maxLength={32} /><small>Não poderá ser alterado depois.</small></label>
        <label><span>Nome</span><input name="name" value={editing.name} onChange={change} maxLength={60} required /></label>
        <label><span>Ordem</span><input name="sortOrder" type="number" min="0" max="10000" value={editing.sortOrder} onChange={change} /></label>
        <label className="wide-field"><span>Descrição</span><input name="description" value={editing.description} onChange={change} maxLength={240} /></label>
        <label><span>Mensalidade (centavos)</span><input name="priceCents" type="number" min="0" value={editing.priceCents} onChange={change} /><small>29700 = R$ 297,00.</small></label>
        <label><span>Créditos mensais</span><input name="includedCredits" type="number" min="0" value={editing.includedCredits} onChange={change} /></label>
        <label><span>Limite de projetos</span><input name="projectLimit" type="number" min="1" value={editing.projectLimit} onChange={change} /></label>
        <label><span>Execuções paralelas</span><input name="parallelExecutionLimit" type="number" min="1" value={editing.parallelExecutionLimit} onChange={change} /></label>
        <label><span>Dias de teste</span><input name="trialDays" type="number" min="1" max="365" value={editing.trialDays} onChange={change} /><small>Deixe vazio em planos pagos.</small></label>
      </div>
      <div className="plan-editor-toggles">
        <label><input name="active" type="checkbox" checked={Boolean(editing.active)} onChange={change} />Plano ativo</label>
        <label><input name="public" type="checkbox" checked={Boolean(editing.public)} onChange={change} />Exibir para contratação</label>
      </div>
      <div className="form-actions"><button className="primary" type="submit" disabled={saving}><Save size={16} />{saving ? "Salvando..." : "Salvar plano"}</button></div>
    </form>}
    {error && <div className="form-error">{error}</div>}
    {message && <div className="form-success">{message}</div>}
  </section>

  <section className="form-card detail-card full-card plan-catalog credit-pack-catalog">
    <div className="card-heading">
      <div><h2>Pacotes de créditos adicionais</h2><p>Valores, quantidades e validade exibidos no checkout do cliente.</p></div>
      <button className="secondary-button" type="button" onClick={startCreatePack}><CirclePlus size={16} />Novo pacote</button>
    </div>
    <div className="plan-admin-list">
      {orderedPacks.map((pack) => <article key={pack.code} className={!pack.active ? "inactive" : ""}>
        <div className="plan-admin-main"><span className="plan-admin-title"><strong>{pack.name}</strong><code>{pack.code}</code></span><small>{pack.validityMonths} meses de validade</small><div className="plan-admin-badges"><em>{pack.active ? "Ativo" : "Inativo"}</em><em>{pack.public ? "Visível ao cliente" : "Oculto"}</em>{pack.structural && <em>Estrutural</em>}</div></div>
        <div className="plan-admin-metrics pack-metrics"><span><small>Créditos</small><strong>{pack.credits.toLocaleString("pt-BR")}</strong></span><span><small>Preço</small><strong>{formatPlanPrice(pack.priceCents)}</strong></span><span><small>Cliente / crédito</small><strong>{moneyFromCents(pack.priceCents / pack.credits)}</strong></span><span><small>Validade</small><strong>{pack.validityMonths} meses</strong></span></div>
        <div className="plan-admin-actions"><button type="button" title="Editar pacote" onClick={() => startEditPack(pack)}><Pencil size={16} /></button>{!pack.structural && <button type="button" title="Excluir pacote" disabled={packSaving} onClick={() => removePack(pack)}><Trash2 size={16} /></button>}</div>
      </article>)}
    </div>
    {editingPack && <form className="plan-editor" onSubmit={savePack}>
      <div className="card-heading"><div><h3>{editingPack._creating ? "Criar pacote" : `Editar ${editingPack.name}`}</h3><p>A compra sempre soma esse lote ao saldo existente do cliente.</p></div><button type="button" className="icon-button" onClick={() => setEditingPack(null)}><X size={17} /></button></div>
      <div className="form-grid three-columns">
        <label><span>Código</span><input name="code" value={editingPack.code} onChange={changePack} disabled={!editingPack._creating} placeholder="CREDITS_5000" maxLength={32} /></label>
        <label><span>Nome</span><input name="name" value={editingPack.name} onChange={changePack} maxLength={60} required /></label>
        <label><span>Ordem</span><input name="sortOrder" type="number" min="0" max="10000" value={editingPack.sortOrder} onChange={changePack} /></label>
        <label><span>Quantidade de créditos</span><input name="credits" type="number" min="1" value={editingPack.credits} onChange={changePack} required /></label>
        <label><span>Preço (centavos)</span><input name="priceCents" type="number" min="1" value={editingPack.priceCents} onChange={changePack} required /><small>10000 = R$ 100,00.</small></label>
        <label><span>Validade (meses)</span><input name="validityMonths" type="number" min="1" max="120" value={editingPack.validityMonths} onChange={changePack} required /></label>
      </div>
      <div className="plan-editor-toggles"><label><input name="active" type="checkbox" checked={Boolean(editingPack.active)} onChange={changePack} />Pacote ativo</label><label><input name="public" type="checkbox" checked={Boolean(editingPack.public)} onChange={changePack} />Exibir para compra</label></div>
      <div className="form-actions"><button className="primary" type="submit" disabled={packSaving}><Save size={16} />{packSaving ? "Salvando..." : "Salvar pacote"}</button></div>
    </form>}
    {packError && <div className="form-error">{packError}</div>}
    {packMessage && <div className="form-success">{packMessage}</div>}
  </section></div>;
}
