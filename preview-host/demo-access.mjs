import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const MAX_FILES = 5_000;
const MAX_FILE_BYTES = 512 * 1024;
const TEXT_EXTENSIONS = new Set([".env", ".example", ".ini", ".java", ".js", ".jsx", ".json", ".kt", ".properties", ".py", ".ts", ".tsx", ".xml", ".yaml", ".yml"]);
const USER_KEYS = ["ADMIN_USER", "ADMIN_USERNAME", "DEFAULT_ADMIN_USER", "DEFAULT_ADMIN_USERNAME", "INITIAL_ADMIN_USER", "INITIAL_ADMIN_USERNAME", "DEMO_USER", "DEMO_USERNAME", "TEST_USER", "TEST_USERNAME", "DJANGO_SUPERUSER_USERNAME"];
const EMAIL_KEYS = ["ADMIN_EMAIL", "DEFAULT_ADMIN_EMAIL", "INITIAL_ADMIN_EMAIL", "DEMO_EMAIL", "TEST_EMAIL", "DJANGO_SUPERUSER_EMAIL"];
const PASSWORD_KEYS = ["ADMIN_PASS", "ADMIN_PASSWORD", "DEFAULT_ADMIN_PASS", "DEFAULT_ADMIN_PASSWORD", "INITIAL_ADMIN_PASS", "INITIAL_ADMIN_PASSWORD", "DEMO_PASS", "DEMO_PASSWORD", "TEST_PASS", "TEST_PASSWORD", "DJANGO_SUPERUSER_PASSWORD"];
const SEED_KEYS = ["DASHBOARDIA_DEMO_MODE", "DEMO_MODE", "SEED_DEMO_DATA", "LOAD_SAMPLE_DATA", "SEED_DATA"];

async function searchableSource(root) {
  const pending = [root];
  const contents = [];
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
      const extension = path.extname(entry.name).toLowerCase();
      if (!entry.isFile() || (!TEXT_EXTENSIONS.has(extension) && !/^\.env(?:\.|$)/.test(entry.name))) continue;
      const value = await readFile(target, "utf8").catch(() => "");
      if (Buffer.byteLength(value) <= MAX_FILE_BYTES) contents.push(value);
    }
  }
  return contents.join("\n");
}

function referencedKeys(source, keys) {
  return keys.filter((key) => new RegExp(`\\b${key}\\b`).test(source));
}

export async function prepareDemoAccess({ sourceDirectory, credentials }) {
  if (!credentials?.username || !credentials?.password) return { environment: {}, credentials: null, adjustments: [] };
  const source = await searchableSource(sourceDirectory);
  const userKeys = referencedKeys(source, USER_KEYS);
  const emailKeys = referencedKeys(source, EMAIL_KEYS);
  const passwordKeys = referencedKeys(source, PASSWORD_KEYS);
  if ((!userKeys.length && !emailKeys.length) || !passwordKeys.length) {
    return { environment: {}, credentials: null, adjustments: [] };
  }

  const environment = {};
  for (const key of userKeys) environment[key] = credentials.username;
  for (const key of emailKeys) environment[key] = credentials.email;
  for (const key of passwordKeys) environment[key] = credentials.password;
  const seedKeys = referencedKeys(source, SEED_KEYS);
  for (const key of seedKeys) environment[key] = "true";

  return {
    environment,
    credentials: {
      username: userKeys.length ? credentials.username : null,
      email: emailKeys.length ? credentials.email : null,
      password: credentials.password,
    },
    adjustments: [{
      code: "TEMPORARY_DEMO_ACCESS",
      file: "Ambiente temporário",
      summary: seedKeys.length
        ? "Credenciais e modo de dados demonstrativos configurados somente no container."
        : "Credenciais administrativas de teste configuradas somente no container.",
    }],
  };
}
