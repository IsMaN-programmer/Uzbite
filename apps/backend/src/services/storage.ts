import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Upload, UploadPurpose } from '@prisma/client';
import { env, storageReady, receiptStorageReady } from '../config/env.js';
import { db } from '../config/database.js';
import { assert } from '../utils/errors.js';

const s3 = new S3Client({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION, forcePathStyle: Boolean(env.S3_ENDPOINT), credentials: { accessKeyId: env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '' } });
export function detectImage(buffer: Buffer): { mimeType: string; extension: string } | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { mimeType: 'image/png', extension: 'png' };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mimeType: 'image/jpeg', extension: 'jpg' };
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { mimeType: 'image/webp', extension: 'webp' };
  return null;
}
export async function storeUpload(userId: string, purpose: UploadPurpose, file: Express.Multer.File | undefined) {
  assert(purpose === 'RECEIPT' ? receiptStorageReady : storageReady, 503, 'STORAGE_NOT_CONFIGURED', 'Облачное хранилище пока не настроено');
  assert(file, 400, 'FILE_REQUIRED', 'Выберите файл');
  assert(file.size <= (purpose === 'AVATAR' ? 5 : 8) * 1024 * 1024, 400, 'FILE_TOO_LARGE', 'Файл слишком большой');
  const image = detectImage(file.buffer);
  assert(image && file.mimetype === image.mimeType, 400, 'FILE_TYPE', 'Разрешены только настоящие изображения JPEG, PNG и WebP');
  const key = `${purpose === 'AVATAR' ? 'public/avatars' : 'receipts'}/${userId}/${randomUUID()}.${image.extension}`;
  const bucket = purpose === 'RECEIPT' ? env.S3_PRIVATE_BUCKET! : env.S3_BUCKET!;
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: file.buffer, ContentType: image.mimeType, ContentLength: file.size, CacheControl: purpose === 'RECEIPT' ? 'private, no-store' : 'public, max-age=31536000, immutable', ServerSideEncryption: 'AES256' }));
  try {
    const upload = await db.upload.create({ data: { userId, purpose, key, mimeType: image.mimeType, size: file.size } });
    const url = purpose === 'AVATAR' ? `${env.CDN_BASE_URL!.replace(/\/$/, '')}/${key}` : `/api/uploads/${upload.id}`;
    if (purpose === 'AVATAR') await db.user.update({ where: { id: userId }, data: { avatarUrl: url } });
    return { id: upload.id, url };
  } catch (error) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {});
    throw error;
  }
}
export async function signedReceipt(userId: string, id: string) {
  const upload = await db.upload.findFirst({ where: { id, userId, purpose: 'RECEIPT' } });
  assert(upload, 404, 'NOT_FOUND', 'Файл не найден');
  assert(receiptStorageReady, 503, 'STORAGE_NOT_CONFIGURED', 'Облачное хранилище пока не настроено');
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_PRIVATE_BUCKET!, Key: upload.key, ResponseCacheControl: 'private, no-store' }), { expiresIn: 60 });
}

/**
 * Private identity files (courier face photos). Stored in the private S3 bucket when it is
 * configured. Development without a bucket keeps them on this computer in the ignored
 * `.local/private-uploads` folder (key prefix `local:`); production never falls back to disk.
 */
const LOCAL_PREFIX = 'local:';
const localRoot = fileURLToPath(new URL('../../../../.local/private-uploads/', import.meta.url));
export const privateStorageReady = () => receiptStorageReady || env.NODE_ENV !== 'production';
function localPath(key: string) {
  const path = resolve(localRoot, key.slice(LOCAL_PREFIX.length));
  assert(path.startsWith(resolve(localRoot) + sep), 500, 'STORAGE_PATH', 'Недопустимый путь файла');
  return path;
}
/** Where a private file lives, for the developer admission CLI. */
export function privateFileLocation(upload: Pick<Upload, 'key'>) {
  return upload.key.startsWith(LOCAL_PREFIX) ? localPath(upload.key) : `s3://${env.S3_PRIVATE_BUCKET}/${upload.key}`;
}
export async function storePrivateImage(userId: string, purpose: 'COURIER_FACE', file: Express.Multer.File | undefined) {
  assert(privateStorageReady(), 503, 'STORAGE_NOT_CONFIGURED', 'Облачное хранилище пока не настроено');
  assert(file, 400, 'FILE_REQUIRED', 'Выберите файл');
  assert(file.size <= 8 * 1024 * 1024, 400, 'FILE_TOO_LARGE', 'Файл слишком большой');
  const image = detectImage(file.buffer);
  assert(image, 400, 'FILE_TYPE', 'Разрешены только настоящие изображения JPEG, PNG и WebP');
  const objectKey = `courier-faces/${userId}/${randomUUID()}.${image.extension}`;
  let key: string;
  if (receiptStorageReady) {
    key = objectKey;
    await s3.send(new PutObjectCommand({ Bucket: env.S3_PRIVATE_BUCKET!, Key: key, Body: file.buffer, ContentType: image.mimeType, ContentLength: file.size, CacheControl: 'private, no-store', ServerSideEncryption: 'AES256' }));
  } else {
    key = `${LOCAL_PREFIX}${objectKey}`;
    const path = localPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.buffer, { mode: 0o600 });
  }
  try {
    return await db.upload.create({ data: { userId, purpose, key, mimeType: image.mimeType, size: file.size } });
  } catch (error) {
    await deletePrivateObject({ key });
    throw error;
  }
}
/** Bytes of a private file (local folder in development, private bucket otherwise), e.g. for support review. */
export async function readPrivateObject(upload: Pick<Upload, 'key'>): Promise<Buffer> {
  if (upload.key.startsWith(LOCAL_PREFIX)) return readFile(localPath(upload.key));
  const object = await s3.send(new GetObjectCommand({ Bucket: env.S3_PRIVATE_BUCKET!, Key: upload.key }));
  return Buffer.from(await object.Body!.transformToByteArray());
}
/** Removes the stored object only; the caller deletes the Upload row. Failures are not fatal. */
export async function deletePrivateObject(upload: Pick<Upload, 'key'>) {
  if (upload.key.startsWith(LOCAL_PREFIX)) {
    const path = localPath(upload.key);
    await rm(path, { force: true }).catch(() => {});
    await rmdir(dirname(path)).catch(() => { /* Not empty: other files of this courier remain. */ });
  }
  else await s3.send(new DeleteObjectCommand({ Bucket: env.S3_PRIVATE_BUCKET!, Key: upload.key })).catch(() => {});
}
