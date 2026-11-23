// Enkripsi/dekripsi kunci tanda tangan APK (keystore).
// File terenkripsi (android/keystore.p12.enc) aman disimpan di repo public: tanpa password tidak bisa dibuka.
// Password disimpan sebagai secret GitHub APK_KEY_PASSWORD.
//
//   node scripts/keystore.mjs encrypt <keystore.p12> <out.enc>   (password dari env APK_KEY_PASSWORD)
//   node scripts/keystore.mjs decrypt <in.enc> <keystore.p12>
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [mode, input, output] = process.argv.slice(2);
const password = process.env.APK_KEY_PASSWORD;
if (!password || !['encrypt', 'decrypt'].includes(mode) || !input || !output) {
  console.error('Pakai: APK_KEY_PASSWORD=... node scripts/keystore.mjs encrypt|decrypt <in> <out>');
  process.exit(2);
}
const MAGIC = Buffer.from('CSK1');
const ITER = 600_000;
const key = (salt) => pbkdf2Sync(password, salt, ITER, 32, 'sha256');

if (mode === 'encrypt') {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(salt), iv);
  const data = Buffer.concat([c.update(readFileSync(input)), c.final()]);
  writeFileSync(output, Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), data]));
} else {
  const buf = readFileSync(input);
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('Format file kunci tidak dikenal');
  const salt = buf.subarray(4, 20);
  const iv = buf.subarray(20, 32);
  const tag = buf.subarray(32, 48);
  const d = createDecipheriv('aes-256-gcm', key(salt), iv);
  d.setAuthTag(tag);
  try {
    writeFileSync(output, Buffer.concat([d.update(buf.subarray(48)), d.final()]));
  } catch {
    console.error('Password kunci salah (secret APK_KEY_PASSWORD tidak cocok).');
    process.exit(1);
  }
}
