import { NextResponse } from "next/server";

import { requireUser } from "../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../lib/api";
import { githubInstallationPublicationAccess, installationRepositoryListIncludes } from "../../../../lib/github-authorization-recovery";
import {
  findGitHubRepositoryInstallation,
  getGitHubAppInstallUrl,
  getGitHubInstallationToken,
  githubRequest,
  listRepositoryBranches,
  verifyRepositoryAccess,
} from "../../../../lib/github";

function normalizeRepository(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) return null;
  return normalized;
}

async function installationIncludesRepository(token, repositoryFullName, repositorySelection) {
  if (repositorySelection === "all") return true;
  for (let page = 1; page <= 20; page += 1) {
    const payload = await githubRequest(token, `/installation/repositories?per_page=100&page=${page}`);
    if (installationRepositoryListIncludes(payload, repositoryFullName)) return true;
    const repositories = Array.isArray(payload?.repositories) ? payload.repositories : [];
    if (repositories.length < 100) return false;
  }
  return false;
}

export async function POST(request) {
  try {
    assertSameOrigin(request);
    await requireUser();
    const input = await request.json().catch(() => ({}));
    const repositoryFullName = normalizeRepository(input.repository);
    if (!repositoryFullName) {
      return NextResponse.json({ error: "Informe a URL de um repositório GitHub válido." }, { status: 422 });
    }

    const fallbackInstallUrl = getGitHubAppInstallUrl();
    const installation = await findGitHubRepositoryInstallation(repositoryFullName).catch(() => null);
    if (!installation?.id) {
      return NextResponse.json({
        connected: false,
        repositoryFullName,
        installUrl: fallbackInstallUrl,
        reason: "O Dashboard IA ainda não está autorizado neste repositório.",
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const publicationAccess = githubInstallationPublicationAccess(installation);
    if (!publicationAccess.canPublish) {
      return NextResponse.json({
        connected: false,
        repositoryFullName,
        installUrl: installation.html_url ?? fallbackInstallUrl,
        reason: "A instalação existe, mas ainda precisa de permissão de escrita em Code e Pull requests.",
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const installationId = String(installation.id);
    const token = await getGitHubInstallationToken(installationId);
    const selected = await installationIncludesRepository(token, repositoryFullName, installation.repository_selection);
    if (!selected) {
      return NextResponse.json({
        connected: false,
        repositoryFullName,
        installUrl: installation.html_url ?? fallbackInstallUrl,
        reason: "O GitHub App está instalado, mas este repositório ainda não foi selecionado e salvo na instalação.",
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const repository = await verifyRepositoryAccess(token, repositoryFullName);
    const discoveredBranches = await listRepositoryBranches(token, repositoryFullName);
    const branches = discoveredBranches.length
      ? discoveredBranches
      : [{ name: repository.default_branch || "main", protected: false, sha: null, empty: true }];

    return NextResponse.json({
      connected: true,
      installationId,
      repository: {
        fullName: repository.full_name ?? repositoryFullName,
        name: repository.name ?? repositoryFullName.split("/").at(-1),
        defaultBranch: repository.default_branch || branches[0]?.name || "main",
        empty: Number(repository.size ?? 0) === 0,
      },
      branches,
      installUrl: installation.html_url ?? fallbackInstallUrl,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
