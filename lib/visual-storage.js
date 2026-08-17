import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { env } from "./env.js";

function configuration() {
  if (!env.BUCKET_ENDPOINT || !env.BUCKET_NAME || !env.BUCKET_ACCESS_KEY_ID || !env.BUCKET_SECRET_ACCESS_KEY) {
    throw new Error("O armazenamento da validação visual não está configurado");
  }
  return {
    bucket: env.BUCKET_NAME,
    client: new S3Client({
      region: "auto",
      endpoint: env.BUCKET_ENDPOINT,
      credentials: { accessKeyId: env.BUCKET_ACCESS_KEY_ID, secretAccessKey: env.BUCKET_SECRET_ACCESS_KEY },
    }),
  };
}

export async function putVisualEvidence(key, body) {
  const { bucket, client } = configuration();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "image/png", CacheControl: "private, max-age=3600" }));
}

export async function getVisualEvidence(key) {
  const { bucket, client } = configuration();
  return client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
}
