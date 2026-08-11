import { db } from "./db";
import { env } from "./env";
import { ensureGitHubWebhook, getGitHubAccessToken } from "./github";
import { githubWebhookUrl } from "./webhooks";

export async function configureProjectGitHubWebhook({ project, userId }) {
  if (!env.GITHUB_WEBHOOK_SECRET || !env.NEXTAUTH_URL) {
    const message = "GITHUB_WEBHOOK_SECRET e NEXTAUTH_URL precisam estar configuradas";
    await db.project.update({ where: { id: project.id }, data: { githubWebhookError: message } });
    return { configured: false, error: message };
  }

  try {
    const token = await getGitHubAccessToken(userId);
    const hook = await ensureGitHubWebhook(token, project.repositoryFullName, {
      url: githubWebhookUrl(env.NEXTAUTH_URL),
      secret: env.GITHUB_WEBHOOK_SECRET,
    });
    await db.project.update({
      where: { id: project.id },
      data: { githubWebhookId: String(hook.id), githubWebhookAt: new Date(), githubWebhookError: null },
    });
    return { configured: true, webhookId: String(hook.id) };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Falha ao configurar webhook";
    await db.project.update({ where: { id: project.id }, data: { githubWebhookError: message } });
    return { configured: false, error: message };
  }
}
