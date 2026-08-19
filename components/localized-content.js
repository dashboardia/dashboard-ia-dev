"use client";

import { useEffect, useRef } from "react";
import { usePreferences } from "./preferences-provider";

const phrases = {
  en: { "Visão geral":"Overview", "Projetos":"Projects", "Demandas":"Requests", "Execuções":"Executions", "Saúde":"Health", "Usuários":"Users", "Auditoria":"Audit", "Configurações":"Settings", "Plano e créditos":"Plan and credits", "Criar demanda":"Create request", "Conectar projeto":"Connect project", "Novo projeto":"New project", "Salvar":"Save", "Cancelar":"Cancel", "Excluir":"Delete", "Editar":"Edit", "Ativo":"Active", "Pendente":"Pending", "Configurado":"Configured", "Preparando":"Preparing", "Não configurado":"Not configured", "Sincronizar":"Sync", "Detalhes":"Details", "Créditos":"Credits", "Créditos disponíveis":"Available credits", "Movimentações":"Transactions", "Plano atual":"Current plan", "Buscar":"Search", "Todos":"All", "Nenhum resultado encontrado.":"No results found." },
  es: { "Visão geral":"Resumen", "Projetos":"Proyectos", "Demandas":"Solicitudes", "Execuções":"Ejecuciones", "Saúde":"Salud", "Usuários":"Usuarios", "Auditoria":"Auditoría", "Configurações":"Configuración", "Plano e créditos":"Plan y créditos", "Criar demanda":"Crear solicitud", "Conectar projeto":"Conectar proyecto", "Novo projeto":"Nuevo proyecto", "Salvar":"Guardar", "Cancelar":"Cancelar", "Excluir":"Eliminar", "Editar":"Editar", "Ativo":"Activo", "Pendente":"Pendiente", "Configurado":"Configurado", "Preparando":"Preparando", "Não configurado":"No configurado", "Sincronizar":"Sincronizar", "Detalhes":"Detalles", "Créditos":"Créditos", "Créditos disponíveis":"Créditos disponibles", "Movimentações":"Movimientos", "Plano atual":"Plan actual", "Buscar":"Buscar", "Todos":"Todos", "Nenhum resultado encontrado.":"No se encontraron resultados." },
};

const originals = new WeakMap();
export default function LocalizedContent({ children }) {
  const ref = useRef(null);
  const { locale } = usePreferences();
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const apply = () => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement?.closest("pre,code,[data-no-translate]") || !node.nodeValue?.trim()) continue;
        if (!originals.has(node)) originals.set(node, node.nodeValue);
        const original = originals.get(node);
        const trimmed = original.trim();
        const translated = phrases[locale]?.[trimmed] ?? trimmed;
        node.nodeValue = original.replace(trimmed, translated);
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [locale]);
  return <div className="localized-content" ref={ref}>{children}</div>;
}
