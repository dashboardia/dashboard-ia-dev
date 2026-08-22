export const messages = {
  "pt-BR": {
    overview: "Visão geral", projects: "Projetos", environments: "Ambientes", demands: "Demandas", executions: "Execuções",
    pullRequests: "Pull Requests", logs: "Logs", health: "Saúde", users: "Usuários", audit: "Auditoria", financial: "Financeiro",
    billing: "Plano e créditos", catalog: "Catálogo", settings: "Configurações", faq: "Ajuda e FAQ", workspace: "ESPAÇO DE TRABALHO",
    admin: "Administrador global", projectAccess: "Acesso por projeto", signOut: "Sair", openMenu: "Abrir menu",
    closeMenu: "Fechar menu", githubConnected: "GitHub conectado", preferences: "Aparência e idioma",
    preferencesHelp: "Personalize a experiência desta conta em todos os dispositivos.", theme: "Tema",
    language: "Idioma", system: "Seguir sistema", light: "Claro", gray: "Cinza", dark: "Escuro", portuguese: "Português",
    english: "English", spanish: "Español", save: "Salvar preferências", saving: "Salvando...",
    saved: "Preferências salvas.", support: "Suporte Dashboardia", supportIntro: "Descreva o problema, informe a demanda ou envie um print.", supportUnavailable: "Não consegui responder agora. Você pode abrir um chamado com o suporte humano abaixo.",
    askPlaceholder: "Descreva o problema ou informe a demanda…", send: "Enviar", close: "Fechar", assistantDisclaimer: "O assistente usa a documentação e o contexto operacional autorizado.",
    faqTitle: "Ajuda e perguntas frequentes", faqDescription: "Respostas práticas para configurar e usar o Dashboardia.",
    searchFaq: "Buscar uma dúvida...", all: "Todos", noResults: "Nenhuma resposta encontrada.",
  },
  en: {
    overview: "Overview", projects: "Projects", environments: "Environments", demands: "Requests", executions: "Executions",
    pullRequests: "Pull Requests", logs: "Logs", health: "Health", users: "Users", audit: "Audit", financial: "Financial",
    billing: "Plan and credits", catalog: "Catalog", settings: "Settings", faq: "Help & FAQ", workspace: "WORKSPACE",
    admin: "Global administrator", projectAccess: "Project access", signOut: "Sign out", openMenu: "Open menu",
    closeMenu: "Close menu", githubConnected: "GitHub connected", preferences: "Appearance and language",
    preferencesHelp: "Customize this account experience on every device.", theme: "Theme",
    language: "Language", system: "Use system setting", light: "Light", gray: "Gray", dark: "Dark", portuguese: "Português",
    english: "English", spanish: "Español", save: "Save preferences", saving: "Saving...",
    saved: "Preferences saved.", support: "Dashboardia Assistant", supportIntro: "Ask questions about using the platform.", supportUnavailable: "I could not answer right now.",
    askPlaceholder: "How can I use Dashboardia?", send: "Send", close: "Close", assistantDisclaimer: "The assistant only consults product documentation.",
    faqTitle: "Help and frequently asked questions", faqDescription: "Practical answers for configuring and using Dashboardia.",
    searchFaq: "Search for a question...", all: "All", noResults: "No answers found.",
  },
  es: {
    overview: "Resumen", projects: "Proyectos", environments: "Entornos", demands: "Solicitudes", executions: "Ejecuciones",
    pullRequests: "Pull Requests", logs: "Registros", health: "Salud", users: "Usuarios", audit: "Auditoría", financial: "Finanzas",
    billing: "Plan y créditos", catalog: "Catálogo", settings: "Configuración", faq: "Ayuda y FAQ", workspace: "ESPACIO DE TRABAJO",
    admin: "Administrador global", projectAccess: "Acceso por proyecto", signOut: "Salir", openMenu: "Abrir menú",
    closeMenu: "Cerrar menú", githubConnected: "GitHub conectado", preferences: "Apariencia e idioma",
    preferencesHelp: "Personaliza la experiencia de esta cuenta en todos los dispositivos.", theme: "Tema",
    language: "Idioma", system: "Seguir el sistema", light: "Claro", gray: "Gris", dark: "Oscuro", portuguese: "Português",
    english: "English", spanish: "Español", save: "Guardar preferencias", saving: "Guardando...",
    saved: "Preferencias guardadas.", support: "Asistente de Dashboardia", supportIntro: "Resuelve dudas sobre el uso de la plataforma.", supportUnavailable: "No pude responder en este momento.",
    askPlaceholder: "¿Cómo puedo usar Dashboardia?", send: "Enviar", close: "Cerrar", assistantDisclaimer: "El asistente consulta únicamente la documentación del producto.",
    faqTitle: "Ayuda y preguntas frecuentes", faqDescription: "Respuestas prácticas para configurar y usar Dashboardia.",
    searchFaq: "Buscar una pregunta...", all: "Todos", noResults: "No se encontraron respuestas.",
  },
};

export function translate(locale, key) {
  return messages[locale]?.[key] ?? messages["pt-BR"][key] ?? key;
}
