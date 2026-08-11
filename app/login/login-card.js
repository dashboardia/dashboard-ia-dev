"use client";

import { ArrowRight, CheckCircle2, Code2, Github, ShieldCheck } from "lucide-react";
import { signIn } from "next-auth/react";

const errorMessages = {
  AccessDenied: "Seu acesso está suspenso ou não foi autorizado.",
  OAuthAccountNotLinked: "Este e-mail já está vinculado a outra conta.",
  OAuthCallback: "O GitHub não concluiu a autenticação. Tente novamente.",
};

export default function LoginCard({ configured, error }) {
  const errorMessage = error ? errorMessages[error] ?? "Não foi possível entrar. Tente novamente." : null;

  return (
    <section className="login-card">
      <div className="login-brand">
        <span className="brand-mark"><Code2 size={22} /></span>
        <span>Forgeboard</span>
      </div>

      <div className="login-copy">
        <span className="login-badge"><ShieldCheck size={14} />Acesso seguro</span>
        <h1>Desenvolvimento assistido em um só lugar.</h1>
        <p>Entre com o GitHub para acessar projetos, demandas, execuções e aprovações conforme seu papel.</p>
      </div>

      {errorMessage && <div className="login-error">{errorMessage}</div>}

      <button
        className="login-github"
        disabled={!configured}
        onClick={() => signIn("github", { callbackUrl: "/" })}
      >
        <Github size={20} />
        <span>{configured ? "Continuar com GitHub" : "Configuração de acesso pendente"}</span>
        <ArrowRight size={18} />
      </button>

      <div className="login-features">
        <span><CheckCircle2 size={14} />Sem senha adicional</span>
        <span><CheckCircle2 size={14} />Permissões por projeto</span>
      </div>
    </section>
  );
}
