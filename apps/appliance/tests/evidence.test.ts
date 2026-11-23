import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app.js';
import { addAccount } from '../src/auth.js';
import { openDb, verifyAudit, type Db } from '../src/db.js';
import { openVault, verifyExhibit } from '../src/vault.js';

const origin = 'https://courtplus.example.test';
const password = 'fictional evidence inbox password';
const path = '/api/evidence/submissions';
const inbox = '/judge/evidence';
const anonymousPath = '/api/evidence/anonymous';
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
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk, _, callback) {
      logs.push(chunk.toString());
      callback();
    },
  });
  const start = () => buildApp({ db, origin, now: () => Date.parse(receivedAt), evidenceEnabled: true, logger: { level: 'trace', stream } });

  async function login(username: string, remoteAddress: string) {
    const reply = await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress, payload: { username, password } });
    expect(reply.statusCode).toBe(200);
    return { cookie: String(reply.headers['set-cookie']).split(';')[0] };
  }

  async function upload(form: FormData, requestOrigin = origin, url = path, headers: Record<string, string> = {}) {
    const encoded = new Request(origin + url, { method: 'POST', body: form });
    return app.inject({
      method: 'POST', url, remoteAddress: url === anonymousPath ? '203.0.113.74' : undefined, headers: {
        origin: requestOrigin, 'content-type': encoded.headers.get('content-type')!, ...headers,
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

  test('accepts a text-only anonymous petition without identity fields, credentials, or a request log', async () => {
    logs.length = 0;
    const remoteAddress = '203.0.113.74';
    const formPage = await app.inject({ url: '/report-anonymously', remoteAddress });
    expect(formPage.body).not.toContain('name="submittedBy"');
    expect(formPage.body).toContain('/anonymous-assets/cloud.js');
    expect((await app.inject({ url: '/anonymous-assets/cloud.js', remoteAddress })).statusCode).toBe(200);
    expect((await app.inject({ url: '/anonymous-assets/cloud.css', remoteAddress })).statusCode).toBe(200);
    const form = new FormData();
    form.set('category', 'petition');
    expect((await upload(form, origin, anonymousPath)).json()).toEqual({ error: 'ANONYMOUS_EMPTY' });
    const statement = 'Fictional petition for judicial review.';
    form.set('statement', statement);
    expect((await upload(form, origin, anonymousPath, judge)).json()).toEqual({ error: 'ANONYMOUS_CREDENTIALS' });
    form.set('submittedBy', 'Must never be persisted');
    expect((await upload(form, origin, anonymousPath)).statusCode).toBe(400);
    form.delete('submittedBy');
    const reply = await upload(form, origin, anonymousPath);
    expect(reply.statusCode, reply.body).toBe(201);
    expect(logs.join('')).not.toContain(remoteAddress);
    expect(logs.join('')).not.toContain(anonymousPath);
    const { reference, receipt } = reply.json();
    expect(reply.json()).toMatchObject({ fileCount: 0, receipt: { payload: {
      actor: 'anonymous', manifest: { files: [], statementSha256: createHash('sha256').update(statement).digest('hex') },
    } } });
    expect(db.prepare('SELECT submitted_by, case_reference FROM evidence_submissions WHERE id = ?').get(reference))
      .toEqual({ submitted_by: '', case_reference: '' });
    const page = await app.inject({ url: inbox + '/' + reference, headers: judge });
    expect(page.body).toContain('Anonymous petition');
    expect(page.body).toContain(statement);
    const statementUrl = inbox + '/' + reference + '/statement';
    expect((await app.inject({ url: statementUrl, headers: admin })).statusCode).toBe(403);
    const retrieved = await app.inject({ url: statementUrl, headers: judge });
    expect(retrieved.body).toBe(statement);
    const vault = openVault(db, dbPath + '.evidence-key.pem');
    expect(verifyExhibit(retrieved.rawPayload, 'statement', receipt, vault.pem).name).toBe('statement.txt');
  });

  test('replaces anonymous exhibit names and preserves bytes for verification', async () => {
    const form = new FormData();
    form.set('category', 'report');
    form.append('evidence', new Blob([photo]), 'Private-name.jpg');
    const reply = await upload(form, origin, anonymousPath);
    expect(reply.statusCode, reply.body).toBe(201);
    const { reference, receipt } = reply.json();
    const [file] = receipt.payload.manifest.files;
    expect(file.name).toBe('exhibit-1.jpg');
    const view = await app.inject({ url: inbox + '/' + reference, headers: judge });
    expect(view.body).toContain('Anonymous report');
    expect(view.body).not.toContain('Private-name');
    const retrieved = await app.inject({ url: inbox + '/' + reference + '/files/' + file.id, headers: judge });
    expect(retrieved.rawPayload).toEqual(Buffer.from(photo));
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

  test('seals existing uploads without claiming to have signed their original timestamp', () => {
    const legacyPath = join(directory, 'legacy.sqlite3');
    const id = randomUUID();
    const original = openDb(legacyPath, secret);
    try {
      original.exec('DROP TABLE evidence_custody; DROP TABLE evidence_legacy; DROP TRIGGER evidence_files_only_before_seal;'
        + ' DROP TRIGGER evidence_submissions_no_UPDATE; DROP TRIGGER evidence_submissions_no_DELETE;'
        + ' DROP TRIGGER evidence_files_no_UPDATE; DROP TRIGGER evidence_files_no_DELETE;'
        + ' ALTER TABLE evidence_submissions DROP COLUMN category; ALTER TABLE evidence_submissions DROP COLUMN channel; PRAGMA user_version=2');
      original.prepare('INSERT INTO evidence_submissions (id, received_at, submitted_by, case_reference, statement) VALUES (?, ?, ?, ?, ?)')
        .run(id, receivedAt, 'Legacy test citizen', '', '');
      original.prepare('INSERT INTO evidence_files VALUES (?, ?, ?, ?, ?)').run(randomUUID(), id, 'legacy.jpg', photo.length, photo);
    } finally {
      original.close();
    }
    const upgraded = openDb(legacyPath, secret);
    try {
      const upgradedAt = '2026-11-24T09:30:00.000Z';
      const vault = openVault(upgraded, legacyPath + '.pem', () => Date.parse(upgradedAt));
      expect(vault.verifyVault()).toMatchObject({ entries: 1, submissions: 1 });
      expect(vault.evidenceHistory(id)[0].payload).toMatchObject({
        action: 'legacy', at: upgradedAt, manifest: { receivedAt },
      });
    } finally {
      upgraded.close();
    }
  });
});
