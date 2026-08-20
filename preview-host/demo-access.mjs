import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_FILES = 1_000;
const MAX_FILE_BYTES = 512 * 1024;
const USER_KEYS = ["ADMIN_USER", "ADMIN_USERNAME", "DEFAULT_ADMIN_USER", "DEFAULT_ADMIN_USERNAME", "INITIAL_ADMIN_USER", "INITIAL_ADMIN_USERNAME", "DEMO_USER", "DEMO_USERNAME", "TEST_USER", "TEST_USERNAME", "DJANGO_SUPERUSER_USERNAME"];
const EMAIL_KEYS = ["ADMIN_EMAIL", "DEFAULT_ADMIN_EMAIL", "INITIAL_ADMIN_EMAIL", "DEMO_EMAIL", "TEST_EMAIL", "DJANGO_SUPERUSER_EMAIL"];
const PASSWORD_KEYS = ["ADMIN_PASS", "ADMIN_PASSWORD", "DEFAULT_ADMIN_PASS", "DEFAULT_ADMIN_PASSWORD", "INITIAL_ADMIN_PASS", "INITIAL_ADMIN_PASSWORD", "DEMO_PASS", "DEMO_PASSWORD", "TEST_PASS", "TEST_PASSWORD", "DJANGO_SUPERUSER_PASSWORD"];
const SEED_KEYS = ["DASHBOARDIA_DEMO_MODE", "DEMO_MODE", "SEED_DEMO_DATA", "LOAD_SAMPLE_DATA", "SEED_DATA"];
const CONTRACT_PATH = /(?:^|\/)\.dashboardia\/demo-access\.json$/i;
const INITIALIZER_NAME = /[^/]*(?:bootstrap|initializer|seeder|data[_-]?loader|fixture)\.(?:java|kt|js|ts|py)$/i;
const DEMO_PATH = new RegExp(`(?:^|/)(?:DemoDataBootstrap\\.(?:java|kt)|${INITIALIZER_NAME.source}|(?:demo[_-]?(?:data|seed)|seed(?:_data)?|data|import)\\.(?:js|ts|py|sql)|fixtures/[^/]+\\.(?:json|ya?ml))$`, "i");
const DISCOVERY_PATH = new RegExp(`(?:^|/)(?:package\\.json|manage\\.py|config\\.(?:js|ts|py)|\\.env(?:\\.example)?|application(?:-[^/]+)?\\.(?:properties|ya?ml)|${INITIALIZER_NAME.source}|DemoDataBootstrap\\.(?:java|kt)|(?:demo[_-]?(?:data|seed)|seed(?:_data)?|data|import)\\.(?:js|ts|py|sql)|fixtures/[^/]+\\.(?:json|ya?ml)|\\.dashboardia/demo-access\\.json)$`, "i");
const STANDARD_DEMO_ENVIRONMENT = {
  enabled: "DASHBOARDIA_DEMO_MODE",
  username: "DASHBOARDIA_DEMO_USERNAME",
  email: "DASHBOARDIA_DEMO_EMAIL",
  password: "DASHBOARDIA_DEMO_PASSWORD",
};

async function searchableFiles(root) {
  const pending = [root];
  const files = [];
  let visited = 0;
  while (pending.length && visited < MAX_FILES) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (visited >= MAX_FILES) break;
      visited += 1;
      if ([".git", "node_modules", "target", "build", "dist", ".next", "vendor"].includes(entry.name)) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(target);
        continue;
      }
      const relativePath = path.relative(root, target).replaceAll("\\", "/");
      if (!entry.isFile() || !DISCOVERY_PATH.test(relativePath)) continue;
      const content = await readFile(target, "utf8").catch(() => "");
      if (Buffer.byteLength(content) <= MAX_FILE_BYTES) files.push({ path: relativePath, absolutePath: target, content });
    }
  }
  return files;
}

function referencedKeys(source, keys) {
  return keys.filter((key) => new RegExp(`\\b${key}\\b`).test(source));
}

function replaceFactoryCredentials(source, credentials) {
  const declaration = source.match(/(?:public|private|protected)\s+[\w<>?,. ]+\s+(\w+)\s*\(([^)]*(?:password|senha|pass)[^)]*)\)\s*\{/i);
  if (!declaration) return source;
  const parameterNames = declaration[2].split(",").map((parameter) => parameter.trim().split(/\s+/).at(-1)?.toLowerCase() ?? "");
  const usernameIndex = parameterNames.findIndex((name) => /^(?:username|user|login|registration|matricula|usuario)$/.test(name));
  const emailIndex = parameterNames.findIndex((name) => /^(?:email|mail)$/.test(name));
  const passwordIndex = parameterNames.findIndex((name) => /(?:password|senha|pass)/.test(name));
  if (passwordIndex < 0 || (usernameIndex < 0 && emailIndex < 0)) return source;
  return source.replace(new RegExp(`\\b${declaration[1]}\\s*\\(([^;]+?)\\)`, "gi"), (call, argumentsText) => {
    const values = argumentsText.split(",");
    const literalIndexes = [usernameIndex, emailIndex, passwordIndex].filter((index) => index >= 0);
    if (!literalIndexes.every((index) => values[index]?.trim().match(/^["'][^"']+["']$/))) return call;
    if (usernameIndex >= 0) values[usernameIndex] = ` ${JSON.stringify(credentials.username)}`;
    if (emailIndex >= 0) values[emailIndex] = ` ${JSON.stringify(credentials.email)}`;
    values[passwordIndex] = ` ${JSON.stringify(credentials.password)}`;
    return `${declaration[1]}(${values.join(",")})`;
  });
}

function replaceLabeledValue(source, labels, value) {
  const name = labels.join("|");
  const patterns = [
    new RegExp(`((?:set)?(?:${name})\\s*\\(\\s*["'])[^"'\\r\\n]+(["'])`, "gi"),
    new RegExp(`((?:${name})\\s*[:=]\\s*["'])[^"'\\r\\n]+(["'])`, "gi"),
    new RegExp(`(["'](?:${name})["']\\s*:\\s*["'])[^"'\\r\\n]+(["'])`, "gi"),
  ];
  return patterns.reduce((current, pattern) => current.replace(pattern, (_match, prefix, suffix) => `${prefix}${value}${suffix}`), source);
}

async function applyGeneratedCredentials(files, credentials) {
  const changedFiles = [];
  for (const file of files) {
    if (!DEMO_PATH.test(file.path)) continue;
    let content = replaceFactoryCredentials(file.content, credentials);
    content = replaceLabeledValue(content, ["username", "user", "login", "registration", "matricula", "usuario"], credentials.username);
    content = replaceLabeledValue(content, ["email", "mail"], credentials.email);
    content = replaceLabeledValue(content, ["password", "passwordHash", "pass", "senha"], credentials.password);
    if (/(?:password|senha|pass)/i.test(content)) {
      content = content.replace(/((?:encode|hashpw)\s*\(\s*["'])[^"'\r\n]+(["'])/gi, (_match, prefix, suffix) => `${prefix}${credentials.password}${suffix}`);
    }
    if (content === file.content) continue;
    await writeFile(file.absolutePath, content, { mode: 0o600 });
    changedFiles.push(file.path);
  }
  return changedFiles;
}

function demoAccessPayload({ status, username = null, email = null, password = null, message, source = null }) {
  return { status, username, email, password, message, source };
}

function validEnvironmentKey(value, fallback) {
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(String(value || "")) ? String(value) : fallback;
}

function demoAccessContract(files) {
  const file = files.find((candidate) => CONTRACT_PATH.test(candidate.path));
  if (!file) return null;
  try {
    const value = JSON.parse(file.content);
    if (value?.version !== 1) return null;
    return {
      file: file.path,
      enabledEnv: validEnvironmentKey(value.enabledEnv, STANDARD_DEMO_ENVIRONMENT.enabled),
      usernameEnv: validEnvironmentKey(value.usernameEnv, STANDARD_DEMO_ENVIRONMENT.username),
      emailEnv: validEnvironmentKey(value.emailEnv, STANDARD_DEMO_ENVIRONMENT.email),
      passwordEnv: validEnvironmentKey(value.passwordEnv, STANDARD_DEMO_ENVIRONMENT.password),
      seedCommand: typeof value.seedCommand === "string" && value.seedCommand.trim() ? value.seedCommand.trim() : null,
    };
  } catch {
    return null;
  }
}

function relativeCommandPrefix(filePath, workingDirectory) {
  const packageDirectory = path.posix.dirname(filePath.replaceAll("\\", "/"));
  const normalizedWorkingDirectory = (workingDirectory || ".").replaceAll("\\", "/").replace(/^\.\//, "");
  const relativeDirectory = path.posix.relative(normalizedWorkingDirectory === "." ? "" : normalizedWorkingDirectory, packageDirectory === "." ? "" : packageDirectory);
  return relativeDirectory && relativeDirectory !== "." ? ` --prefix ${JSON.stringify(relativeDirectory)}` : "";
}

function detectedSeedCommand(files, workingDirectory) {
  for (const file of files.filter((candidate) => path.basename(candidate.path) === "package.json")) {
    let packageJson;
    try {
      packageJson = JSON.parse(file.content);
    } catch {
      continue;
    }
    const script = ["seed:demo", "db:seed", "seed", "prisma:seed"].find((name) => packageJson.scripts?.[name]);
    if (script) return `npm${relativeCommandPrefix(file.path, workingDirectory)} run ${script}`;
    if (packageJson.prisma?.seed) {
      const prefix = relativeCommandPrefix(file.path, workingDirectory).replace(/^ --prefix /, "");
      return `${prefix ? `cd ${prefix} && ` : ""}npx prisma db seed`;
    }
  }
  const managePy = files.find((file) => path.basename(file.path) === "manage.py");
  const fixture = files.find((file) => /(?:^|\/)fixtures\/.*\.(?:json|ya?ml)$/i.test(file.path));
  if (managePy && fixture) {
    const working = (workingDirectory || ".").replaceAll("\\", "/").replace(/^\.\//, "");
    const manageDirectory = path.posix.dirname(managePy.path.replaceAll("\\", "/"));
    const managePrefix = path.posix.relative(working === "." ? "" : working, manageDirectory === "." ? "" : manageDirectory);
    const fixtureFromManage = path.posix.relative(manageDirectory === "." ? "" : manageDirectory, fixture.path.replaceAll("\\", "/"));
    return `${managePrefix && managePrefix !== "." ? `cd ${JSON.stringify(managePrefix)} && ` : ""}python manage.py loaddata ${JSON.stringify(fixtureFromManage)}`;
  }
  const pythonSeed = files.find((file) => /(?:^|\/)(?:seed|demo_seed|seed_data)\.py$/i.test(file.path));
  if (pythonSeed) {
    const working = (workingDirectory || ".").replaceAll("\\", "/").replace(/^\.\//, "");
    const relativeSeed = path.posix.relative(working === "." ? "" : working, pythonSeed.path.replaceAll("\\", "/"));
    return `python ${JSON.stringify(relativeSeed)}`;
  }
  return null;
}

export async function prepareDemoAccess({ sourceDirectory, workingDirectory = ".", credentials }) {
  if (!credentials?.username || !credentials?.password) return { environment: {}, credentials: null, adjustments: [], seedCommand: null };
  const files = await searchableFiles(sourceDirectory);
  const contract = demoAccessContract(files);
  if (contract) {
    return {
      environment: {
        [contract.enabledEnv]: "true",
        [contract.usernameEnv]: credentials.username,
        [contract.emailEnv]: credentials.email,
        [contract.passwordEnv]: credentials.password,
      },
      credentials: demoAccessPayload({
        status: "READY",
        username: credentials.username,
        email: credentials.email,
        password: credentials.password,
        message: "Acesso e massa de demonstração criados automaticamente para este ambiente.",
        source: contract.file,
      }),
      adjustments: [{
        code: "DASHBOARDIA_DEMO_CONTRACT",
        file: contract.file,
        summary: "O contrato de demonstração do projeto foi ativado somente no container temporário.",
      }],
      seedCommand: contract.seedCommand,
    };
  }
  const source = files.map((file) => file.content).join("\n");
  const demoFiles = files.filter((file) => DEMO_PATH.test(file.path));
  const userKeys = referencedKeys(source, USER_KEYS);
  const emailKeys = referencedKeys(source, EMAIL_KEYS);
  const passwordKeys = referencedKeys(source, PASSWORD_KEYS);
  const seedKeys = referencedKeys(source, SEED_KEYS);
  const environment = {};
  const seedCommand = detectedSeedCommand(files, workingDirectory);

  for (const key of userKeys) environment[key] = credentials.username;
  for (const key of emailKeys) environment[key] = credentials.email;
  for (const key of passwordKeys) environment[key] = credentials.password;
  for (const key of seedKeys) environment[key] = "true";

  const supportsGeneratedCredentials = (userKeys.length > 0 || emailKeys.length > 0) && passwordKeys.length > 0;
  if (supportsGeneratedCredentials) {
    return {
      environment,
      credentials: demoAccessPayload({
        status: "READY",
        username: userKeys.length ? credentials.username : null,
        email: emailKeys.length ? credentials.email : null,
        password: credentials.password,
        message: seedKeys.length ? "Acesso e massa de demonstração preparados automaticamente." : "Acesso administrativo temporário preparado automaticamente.",
        source: "Configuração do ambiente",
      }),
      adjustments: [{
        code: "TEMPORARY_DEMO_ACCESS",
        file: "Ambiente temporário",
        summary: seedKeys.length
          ? "Credenciais e modo de dados demonstrativos configurados somente no container."
          : "Credenciais administrativas de teste configuradas somente no container.",
      }],
      seedCommand,
    };
  }

  const changedCredentialFiles = await applyGeneratedCredentials(demoFiles, credentials);
  if (changedCredentialFiles.length > 0) {
    return {
      environment,
      credentials: demoAccessPayload({
        status: "READY",
        username: credentials.username,
        email: credentials.email,
        password: credentials.password,
        message: "Massa de demonstração preparada com um acesso temporário gerado pelo Dashboardia.",
        source: changedCredentialFiles.join(", "),
      }),
      adjustments: [{
        code: "TEMPORARY_DEMO_CREDENTIALS",
        file: changedCredentialFiles.join(", "),
        summary: "As credenciais do bootstrap foram substituídas somente na cópia temporária usada pelo ambiente.",
      }],
      seedCommand,
    };
  }

  if (demoFiles.length > 0 || seedKeys.length > 0) {
    return {
      environment,
      credentials: demoAccessPayload({
        status: "DATA_ONLY",
        message: "A massa de demonstração foi detectada, mas o projeto não expõe uma senha de teste legível.",
        source: demoFiles[0]?.path ?? "Configuração do ambiente",
      }),
      adjustments: [],
      seedCommand,
    };
  }

  return {
    environment,
    credentials: demoAccessPayload({
      status: "NOT_CONFIGURED",
      message: "Este projeto não possui seed ou bootstrap de demonstração compatível para criar um acesso automaticamente.",
    }),
    adjustments: [],
    seedCommand,
  };
}
