"use client";

export default function BranchCombobox({ branches, value, onChange, disabled = false }) {
  const options = Array.isArray(branches) ? branches.filter((branch) => branch?.name) : [];
  const selected = options.some((branch) => branch.name === value) ? value : options[0]?.name ?? "";

  return (
    <select
      className="branch-select"
      value={selected}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled || !options.length}
      aria-label="Selecionar branch"
    >
      {!options.length && <option value="">Nenhuma branch disponível</option>}
      {options.map((branch) => (
        <option value={branch.name} key={branch.name}>
          {branch.name}{branch.protected ? " · protegida" : ""}
        </option>
      ))}
    </select>
  );
}
