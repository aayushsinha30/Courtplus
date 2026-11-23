import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app.js';
import { addAccount } from '../src/auth.js';
import { openDb, verifyAudit, type Db } from '../src/db.js';
import { openVault, verifyExhibit } from '../src/vault.js';

const origin = 'https://courtplus.example.test';
const password = 'fictional evidence inbox password';
const path = '/api/evidence/submissions';
const inbox = '/judge/evidence';
const photo = Uint8Array.of(0xff, 0xd8, 0xff, 0x01, 0x00, 0xff, 0xd9);
const receivedAt = '2026-11-23T12:00:00.000Z';
type App = Awaited<ReturnType<typeof buildApp>>;

function formData() {
  const form = new FormData();
  form.set('submittedBy', 'Fictional Citizen');
  form.set('caseReference', '<script>case reference</script>');
  form.set('statement', 'A fictional exhibit.\nSecond line.');
  return form;
}

describe.sequential('Citizen evidence intake', () => {
  let directory: string;
  let secret: string;
  let dbPath: string;
  let db: Db;
  let app: App;
  let judge: { cookie: string };
  let admin: { cookie: string };
  let detail: string;
  let download: string;
  const start = () => buildApp({ db, origin, now: () => Date.parse(receivedAt), evidenceEnabled: true });

  async function login(username: string, remoteAddress: string) {
    const reply = await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress, payload: { username, password } });
    expect(reply.statusCode).toBe(200);
    return { cookie: String(reply.headers['set-cookie']).split(';')[0] };
  }

  async function upload(form: FormData, requestOrigin = origin) {
    const encoded = new Request(origin + path, { method: 'POST', body: form });
    return app.inject({
      method: 'POST', url: path, headers: {
        origin: requestOrigin, 'content-type': encoded.headers.get('content-type')!,
      },
      payload: Buffer.from(await encoded.arrayBuffer()),
    });
  }

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'courtplus-evidence-'));
    secret = join(directory, 'db-key');
    dbPath = join(directory, 'cloud.sqlite3');
    writeFileSync(secret, randomBytes(32).toString('hex'));
    db = openDb(dbPath, secret);
    await addAccount(db, 'judge', password, 'judge');
    await addAccount(db, 'admin', password, 'admin');
    // Reopen the pre-evidence schema while retaining its existing accounts.
    db.exec('DROP TABLE evidence_custody; DROP TABLE evidence_legacy; DROP TABLE evidence_files; DROP TABLE evidence_submissions; PRAGMA user_version=1');
    db.close();
    db = openDb(dbPath, secret);
    app = await start();
    judge = await login('judge', '192.0.2.1');
    admin = await login('admin', '192.0.2.2');
  });

  afterAll(async () => {
    await app?.close();
    db?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  test('delivers a multipart submission to a judge and downloads byte-identical files', async () => {
    expect((await app.inject('/submit-evidence')).body).toContain('type="file"');
    const form = formData();
    form.append('evidence', new Blob([photo], { type: 'image/jpeg' }), 'exhibit.jpg');
    form.append('evidence', new Blob(['Fictional audio'], { type: 'audio/mpeg' }), 'interview.mp3');
    form.append('evidence', new Blob(['Fictional video'], { type: 'video/mp4' }), 'recording.mp4');
    form.append('evidence', new Blob(['%PDF-1.7 Fictional exhibit'], { type: 'application/pdf' }), 'record.pdf');
    form.append('evidence', new Blob(['Fictional notes'], { type: 'text/plain' }), 'notes.txt');
    const reply = await upload(form);
    expect(reply.statusCode, reply.body).toBe(201);
    const { reference } = reply.json<{ reference: string }>();
    expect(reply.json()).toMatchObject({ reference, receivedAt, fileCount: 5 });
    detail = inbox + '/' + reference;

    expect((await app.inject({ url: '/', headers: judge })).headers.location).toBe(inbox);
    expect((await app.inject(inbox)).headers.location).toBe('/login');
    expect((await app.inject({ url: inbox, headers: admin })).statusCode).toBe(403);
    expect((await app.inject({ url: inbox, headers: judge })).body).toContain(detail);
    const view = await app.inject({ url: detail, headers: judge });
    expect(view.body).toContain('Fictional Citizen');
    expect(view.body).toContain(createHash('sha256').update(photo).digest('hex'));
    expect(view.body).toContain('&lt;script&gt;case reference&lt;/script&gt;');
    expect(view.body).not.toContain('<script>case reference</script>');
    download = view.body.match(/href="([^"]+)">exhibit\.jpg<\/a>/)![1];
    expect((await app.inject(download)).statusCode).toBe(401);
    expect((await app.inject({ url: download, headers: admin })).statusCode).toBe(403);
    expect((await app.inject({ url: download.replace(reference, randomUUID()), headers: judge })).statusCode).toBe(404);
    const exhibit = await app.inject({ url: download, headers: judge });
    expect(exhibit.statusCode).toBe(200);
    expect(exhibit.rawPayload).toEqual(Buffer.from(photo));
    expect(exhibit.headers['content-type']).toBe('application/octet-stream');
    expect(exhibit.headers['content-disposition']).toMatch(/^attachment;/);
    expect(exhibit.headers['cache-control']).toBe('no-store');
    expect(verifyAudit(db).valid).toBe(true);
    const custody = db.prepare('SELECT action FROM audit_log WHERE action LIKE ? ORDER BY id').pluck().all('evidence.%');
    expect(custody).toEqual(['evidence.receive', 'evidence.open', 'evidence.download']);
    const report = await app.inject({ url: detail + '/section-63', headers: judge });
    expect(report.body).toContain('Part B preparation');
    expect(report.body).toContain('exhibit.jpg');
    expect((await app.inject(detail + '/manifest')).statusCode).toBe(401);
    const manifest = await app.inject({ url: detail + '/manifest', headers: judge });
    expect(manifest.rawPayload.length).toBeGreaterThan(0);
    expect(manifest.json()).toEqual(reply.json().receipt);
    const vault = openVault(db, dbPath + '.evidence-key.pem');
    expect(verifyExhibit(photo, download.split('/').at(-1)!, manifest.json(), vault.pem).name).toBe('exhibit.jpg');
    expect(vault.verifyVault()).toMatchObject({ submissions: 1, entries: 5 });
    const events = await app.inject({ url: detail + '/custody', headers: judge });
    expect(events.json().map((entry: { payload: { action: string } }) => entry.payload.action))
      .toEqual(['receive', 'open', 'download', 'section63', 'manifest', 'custody']);
  });

  test('rejects invalid and oversized uploads without partially storing a submission', async () => {
    const crossSite = await upload(formData(), 'https://other.example.test');
    expect(crossSite.statusCode).toBe(403);
    const wrongType = formData();
    wrongType.append('evidence', new Blob([photo]), 'allowed.jpg');
    wrongType.append('evidence', new Blob(['example']), 'blocked.html');
    expect((await upload(wrongType)).statusCode).toBe(415);
    const tooMany = formData();
    for (let index = 0; index < 6; index++) tooMany.append('evidence', new Blob([photo]), 'exhibit.jpg');
    expect((await upload(tooMany)).statusCode).toBe(413);
    const oversized = formData();
    oversized.append('evidence', new Blob([new Uint8Array(25 * 1024 * 1024 + 1)]), 'video.mp4');
    expect((await upload(oversized)).statusCode).toBe(413);
    expect(db.prepare('SELECT COUNT(*) FROM evidence_submissions').pluck().get()).toBe(1);
    expect(db.prepare('SELECT COUNT(*) FROM evidence_files').pluck().get()).toBe(5);
  });

  test('keeps uploads available after restart and hides intake when disabled', async () => {
    const first = openVault(db, dbPath + '.evidence-key.pem');
    const checkpoint = first.checkpoint();
    await app.close();
    db.close();
    db = openDb(dbPath, secret);
    app = await buildApp({ db, origin });
    expect((await app.inject('/submit-evidence')).statusCode).toBe(404);
    expect((await app.inject({ url: inbox, headers: judge })).statusCode).toBe(404);
    await app.close();
    app = await start();
    const reopened = openVault(db, dbPath + '.evidence-key.pem');
    expect(reopened.pem).toBe(first.pem);
    expect(reopened.verifyVault(checkpoint).submissions).toBe(1);
    expect((await app.inject({ url: detail, headers: judge })).statusCode).toBe(200);
    expect((await app.inject({ url: download, headers: judge })).rawPayload).toEqual(Buffer.from(photo));
  });

  test('rejects storage tampering and detects rollback against a saved checkpoint', async () => {
    const keyPath = dbPath + '.evidence-key.pem';
    const vault = openVault(db, keyPath);
    const checkpoint = vault.checkpoint();
    const id = download.split('/').at(-1)!;
    expect(() => db.prepare('UPDATE evidence_files SET content = zeroblob(byte_length) WHERE id = ?').run(id)).toThrow(/append-only/);
    expect(() => db.exec('DELETE FROM evidence_custody')).toThrow(/append-only/);
    db.exec('DROP TRIGGER evidence_custody_no_DELETE');
    db.prepare('DELETE FROM evidence_custody WHERE seq = ?').run(checkpoint.payload.count);
    expect(() => vault.verifyVault(checkpoint)).toThrow(/checkpoint/);
    db.exec('DROP TRIGGER evidence_files_no_UPDATE');
    db.prepare('UPDATE evidence_files SET content = zeroblob(byte_length) WHERE id = ?').run(id);
    expect((await app.inject({ url: download, headers: judge })).statusCode).toBe(409);
    expect(() => vault.verifyVault()).toThrow(/contents/);
    expect(() => openVault(db, keyPath + '.missing')).toThrow(/original evidence signing key/);
  });
});
