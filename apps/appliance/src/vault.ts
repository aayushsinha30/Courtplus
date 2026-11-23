import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify, type KeyObject } from 'node:crypto';
import { linkSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { canonical, sha256, type Db } from './db.js';

const genesis = '0'.repeat(64);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const signature = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
const timestamp = z.iso.datetime();
const exhibit = z.strictObject({ id: z.uuidv4(), name: z.string(), bytes: z.number().int().positive(), sha256: hash });
const manifest = z.strictObject({ receivedAt: timestamp, metadataSha256: hash, files: z.array(exhibit) });
const eventFields = {
  kind: z.literal('courtplus-evidence-custody-v1'),
  seq: z.number().int().positive(), previous: hash, keyId: hash,
  submissionId: z.uuidv4(), at: timestamp, actor: z.string().min(1),
};
const event = z.discriminatedUnion('action', [
  z.strictObject({ ...eventFields, action: z.enum(['receive', 'legacy']), manifest }),
  z.strictObject({ ...eventFields, action: z.enum(['open', 'manifest', 'section63', 'custody']) }),
  z.strictObject({ ...eventFields, action: z.literal('download'), fileId: z.uuidv4() }),
]);
const eventEnvelope = z.strictObject({ payload: event, signature });
const checkpointEnvelope = z.strictObject({
  payload: z.strictObject({
    kind: z.literal('courtplus-evidence-checkpoint-v1'), keyId: hash,
    count: z.number().int().nonnegative(), head: hash, at: timestamp,
  }),
  signature,
});

export type EvidenceMetadata = {
  id: string; receivedAt: string; submittedBy: string; caseReference: string; statement: string;
  channel: 'identified' | 'anonymous';
};
type FileContent = { id: string; name: string; content: Buffer };
type Event = z.infer<typeof event>;
type Envelope = z.infer<typeof eventEnvelope>;
type Seal = Extract<Event, { manifest: unknown }>;
type AccessEvent = Exclude<Event, Seal>;
type JournalRow = { seq: number; submissionId: string; action: string; envelope: string; head: string };

const metadataQuery = 'SELECT id, received_at AS receivedAt, submitted_by AS submittedBy,'
  + ' case_reference AS caseReference, statement, channel FROM evidence_submissions';
const journalQuery = 'SELECT seq, submission_id AS submissionId, action, envelope, head FROM evidence_custody';

export class VaultIntegrityError extends Error {}

function publicKeyId(key: KeyObject) {
  return sha256(key.export({ type: 'spki', format: 'der' }));
}

function assertSignature(envelope: { payload: { keyId: string }; signature: string }, key: KeyObject) {
  if (key.asymmetricKeyType !== 'ed25519' || envelope.payload.keyId !== publicKeyId(key)
    || !verify(null, Buffer.from(canonical(envelope.payload)), key, Buffer.from(envelope.signature, 'base64url'))) {
    throw new VaultIntegrityError('Evidence vault signature or trusted key does not match');
  }
}

function loadPrivateKey(db: Db, path: string) {
  try {
    return createPrivateKey(readFileSync(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (db.prepare('SELECT 1 FROM evidence_custody LIMIT 1').get()) {
      throw new VaultIntegrityError('Restore the original evidence signing key before opening this vault');
    }
    const privateKey = generateKeyPairSync('ed25519').privateKey;
    const temporary = path + '.' + randomUUID();
    writeFileSync(temporary, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx', flush: true });
    try {
      // Publishing by hard link makes creation atomic and cannot replace another process's key.
      linkSync(temporary, path);
      return privateKey;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      return createPrivateKey(readFileSync(path));
    } finally {
      unlinkSync(temporary);
    }
  }
}

function snapshot(metadata: EvidenceMetadata, files: FileContent[]): z.infer<typeof manifest> {
  return {
    receivedAt: metadata.receivedAt,
    metadataSha256: sha256(canonical(metadata)),
    files: files.map(file => ({ id: file.id, name: file.name, bytes: file.content.length, sha256: sha256(file.content) })),
  };
}

export function verifyExhibit(contents: Uint8Array, fileId: string, signedManifest: unknown, trustedPublicKey: string) {
  const envelope = eventEnvelope.parse(signedManifest);
  assertSignature(envelope, createPublicKey(trustedPublicKey));
  if (!('manifest' in envelope.payload)) throw new VaultIntegrityError('Expected a signed evidence manifest');
  const expected = envelope.payload.manifest.files.find(file => file.id === fileId);
  if (!expected || expected.bytes !== contents.length || expected.sha256 !== sha256(contents)) {
    throw new VaultIntegrityError('Evidence file content does not match its signed SHA-256 digest');
  }
  return expected;
}

export function openVault(db: Db, keyPath: string, now: () => number = Date.now) {
  const key = loadPrivateKey(db, keyPath);
  if (key.asymmetricKeyType !== 'ed25519') throw new VaultIntegrityError('Evidence vault key must be Ed25519');
  const publicKey = createPublicKey(key);
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const keyId = publicKeyId(publicKey);
  const tail = db.prepare<[], JournalRow>(journalQuery + ' ORDER BY seq DESC LIMIT 1');
  const journal = db.prepare<[], JournalRow>(journalQuery + ' ORDER BY seq');
  const history = db.prepare<[string], JournalRow>(journalQuery + ' WHERE submission_id = ? ORDER BY seq');
  const seals = db.prepare<[string], JournalRow>(journalQuery + " WHERE submission_id = ? AND action IN ('receive', 'legacy')");
  const contents = db.prepare<[string], FileContent>(
    'SELECT id, name, content FROM evidence_files WHERE submission_id = ? ORDER BY rowid',
  );
  const add = db.prepare('INSERT INTO evidence_custody (seq, submission_id, action, envelope, head) VALUES (?, ?, ?, ?, ?)');
  const listMetadata = db.prepare<[], EvidenceMetadata>(metadataQuery + ' ORDER BY seq');

  function decode(row: JournalRow): Envelope {
    const envelope = eventEnvelope.parse(JSON.parse(row.envelope));
    const { seq, submissionId, action } = envelope.payload;
    assertSignature(envelope, publicKey);
    if (seq !== row.seq || submissionId !== row.submissionId || action !== row.action || sha256(canonical(envelope)) !== row.head) {
      throw new VaultIntegrityError('Evidence custody row does not match its signed event');
    }
    return envelope;
  }

  function signed<T extends { keyId: string }>(payload: T) {
    return { payload, signature: sign(null, Buffer.from(canonical(payload)), key).toString('base64url') };
  }

  function record(submissionId: string, actor: string, detail:
    Pick<Seal, 'action' | 'manifest'> | { action: Exclude<AccessEvent['action'], 'download'> } | { action: 'download'; fileId: string }) {
    if (!db.inTransaction) throw new Error('Evidence custody must share the write transaction');
    const prior = tail.get();
    if (prior) decode(prior);
    const envelope = signed(event.parse({
      kind: 'courtplus-evidence-custody-v1', seq: (prior?.seq ?? 0) + 1, previous: prior?.head ?? genesis,
      keyId, submissionId, at: new Date(now()).toISOString(), actor, ...detail,
    }));
    const encoded = canonical(envelope);
    add.run(envelope.payload.seq, submissionId, detail.action, encoded, sha256(encoded));
    return envelope;
  }

  function seal(metadata: EvidenceMetadata, files: FileContent[], action: Seal['action'] = 'receive') {
    return record(metadata.id, action === 'legacy' ? 'migration' : 'citizen', { action, manifest: snapshot(metadata, files) });
  }

  function getSeal(metadata: EvidenceMetadata) {
    const row = seals.get(metadata.id);
    if (!row) throw new VaultIntegrityError('Evidence submission has no custody seal');
    const envelope = decode(row);
    if (!('manifest' in envelope.payload) || envelope.payload.manifest.receivedAt !== metadata.receivedAt
      || envelope.payload.manifest.metadataSha256 !== sha256(canonical(metadata))) {
      throw new VaultIntegrityError('Evidence submission metadata does not match its signed manifest');
    }
    return { ...envelope, payload: envelope.payload };
  }

  function verifyFile(metadata: EvidenceMetadata, file: FileContent) {
    const expected = verifyExhibit(file.content, file.id, getSeal(metadata), pem);
    if (expected.name !== file.name) throw new VaultIntegrityError('Evidence file name does not match its signed manifest');
  }

  function verifySubmission(metadata: EvidenceMetadata) {
    const envelope = getSeal(metadata);
    if (canonical(snapshot(metadata, contents.all(metadata.id))) !== canonical(envelope.payload.manifest)) {
      throw new VaultIntegrityError('Evidence file list or contents do not match the signed manifest');
    }
    return envelope;
  }

  function verifyVault(checkpoint?: unknown) {
    return db.transaction(() => {
      const trusted = checkpoint === undefined ? undefined : checkpointEnvelope.parse(checkpoint);
      if (trusted) assertSignature(trusted, publicKey);
      const sealedFiles = new Map<string, Set<string>>();
      let head = genesis;
      let entries = 0;
      let anchored = trusted === undefined || (trusted.payload.count === 0 && trusted.payload.head === genesis);
      for (const row of journal.iterate()) {
        const { payload } = decode(row);
        if (row.seq !== entries + 1 || payload.previous !== head) throw new VaultIntegrityError('Evidence custody chain is broken');
        if ('manifest' in payload) {
          if (sealedFiles.has(payload.submissionId)) throw new VaultIntegrityError('Evidence submission was sealed twice');
          sealedFiles.set(payload.submissionId, new Set(payload.manifest.files.map(file => file.id)));
        } else {
          const fileIds = sealedFiles.get(payload.submissionId);
          if (!fileIds || (payload.action === 'download' && !fileIds.has(payload.fileId))) {
            throw new VaultIntegrityError('Custody event refers to evidence outside its signed manifest');
          }
        }
        head = row.head;
        entries = row.seq;
        if (trusted?.payload.count === entries) anchored = trusted.payload.head === head;
      }
      if (!anchored) throw new VaultIntegrityError('Evidence custody differs from the independently retained checkpoint');
      let submissions = 0;
      for (const metadata of listMetadata.all()) {
        verifySubmission(metadata);
        submissions += 1;
      }
      if (submissions !== sealedFiles.size || db.prepare(
        'SELECT 1 FROM evidence_files f LEFT JOIN evidence_submissions s ON s.id = f.submission_id WHERE s.id IS NULL LIMIT 1',
      ).get()) throw new VaultIntegrityError('Evidence vault is missing a submission or contains orphaned exhibits');
      return { entries, head, submissions };
    })();
  }

  function checkpoint() {
    const verified = verifyVault();
    return signed({
      kind: 'courtplus-evidence-checkpoint-v1' as const, keyId,
      count: verified.entries, head: verified.head, at: new Date(now()).toISOString(),
    });
  }

  const latest = tail.get();
  if (latest) decode(latest);
  const pending = db.prepare<[], EvidenceMetadata>(metadataQuery
    + ' WHERE id IN (SELECT id FROM evidence_legacy)'
    + " AND id NOT IN (SELECT submission_id FROM evidence_custody WHERE action IN ('receive', 'legacy')) ORDER BY seq");
  for (const metadata of pending.all()) {
    db.transaction(() => {
      if (!seals.get(metadata.id)) seal(metadata, contents.all(metadata.id), 'legacy');
    }).immediate();
  }
  return {
    pem, record, seal, getSeal, verifyFile, verifySubmission, verifyVault, checkpoint,
    evidenceHistory: (id: string) => history.all(id).map(decode),
  };
}
