import { PrismaAdapter } from "@next-auth/prisma-adapter";
import GitHubProviderModule from "next-auth/providers/github";

import { db } from "./db";
import { env } from "./env";

const githubClientId = env.GITHUB_ID ?? "github-oauth-not-configured";
const githubClientSecret = env.GITHUB_SECRET ?? "github-oauth-not-configured";
const GitHubProvider = GitHubProviderModule.default ?? GitHubProviderModule;

export const authOptions = {
  adapter: PrismaAdapter(db),
  secret: env.NEXTAUTH_SECRET,
  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  providers: [
    GitHubProvider({
      clientId: githubClientId,
      clientSecret: githubClientSecret,
      profile(profile) {
        return {
          id: String(profile.id),
          name: profile.name ?? profile.login,
          email: profile.email,
          image: profile.avatar_url,
          githubLogin: profile.login,
        };
      },
      authorization: {
        params: {
          scope: "read:user user:email repo",
        },
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user }) {
      return user.status !== "SUSPENDED";
    },
    async session({ session, user }) {
      session.user.id = user.id;
      session.user.githubLogin = user.githubLogin;
      session.user.globalRole = user.globalRole;
      session.user.status = user.status;
      return session;
    },
  },
  events: {
    async signIn({ user, profile }) {
      const githubLogin = typeof profile?.login === "string" ? profile.login : null;
      const isConfiguredAdmin =
        githubLogin &&
        env.ADMIN_GITHUB_LOGIN &&
        githubLogin.toLowerCase() === env.ADMIN_GITHUB_LOGIN.toLowerCase();

      try {
        await db.$transaction([
          db.user.update({
            where: { id: user.id },
            data: {
              githubLogin,
              ...(isConfiguredAdmin ? { globalRole: "ADMIN" } : {}),
            },
          }),
          db.auditLog.create({
            data: {
              actorId: user.id,
              action: "auth.sign_in",
              entityType: "User",
              entityId: user.id,
              metadata: githubLogin ? { githubLogin } : undefined,
            },
          }),
        ]);
      } catch (error) {
        console.error("[auth] Falha ao registrar login", error);
      }
    },
  },
};
