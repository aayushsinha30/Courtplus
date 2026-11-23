import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { allowedOrigin, type Session } from './auth.js';
import { audit, type Db } from './db.js';
import { html, HttpError, page, parse, requireValue } from './http.js';

const MiB = 1024 * 1024;
const maxFile = 25 * MiB;
const maxTotal = 40 * MiB;
const maxFiles = 5;
const storageLimit = 1024 * MiB;
const pageSize = 25;
const extensions = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.heic', '.tiff',
  '.mp4', '.mov', '.webm', '.mkv', '.avi', '.3gp',
  '.mp3', '.wav', '.m4a', '.ogg', '.opus', '.aac', '.flac', '.amr',
  '.pdf', '.txt', '.csv', '.doc', '.docx', '.odt', '.rtf', '.xls', '.xlsx',
]);
const submissionFields = z.strictObject({
  submittedBy: z.string().trim().min(1).max(120),
  caseReference: z.string().trim().max(120).default(''),
  statement: z.string().trim().max(4000).default(''),
});
const submissionParams = z.object({ submissionId: z.uuidv4() });
const fileParams = submissionParams.extend({ fileId: z.uuidv4() });
const inboxQuery = z.strictObject({
  before: z.string().regex(/^[1-9]\d{0,14}$/).transform(Number).optional(),
});
const judgeNav = '<nav><a href="/judge/evidence">Evidence inbox</a> <button id="sign-out" type="button">Sign out</button></nav>';
type Submission = {
  seq: number; id: string; receivedAt: string; submittedBy: string; caseReference: string; statement: string;
};
type EvidenceFile = { id: string; name: string; byteLength: number };
type JudgeAccess = (request: FastifyRequest, roles: readonly ['judge']) => Session;

function attachment(name: string) {
  const encoded = encodeURIComponent(name).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16));
  return 'attachment; filename="evidence' + extname(name).toLowerCase() + '"; filename*=UTF-8\'\'' + encoded;
}

export async function evidenceRoutes(app: FastifyInstance, db: Db, origin: string, now: () => number, authorize: JudgeAccess) {
  const inbox = db.prepare<[number, number], Omit<Submission, 'statement'>>(
    'SELECT seq, id, received_at AS receivedAt, submitted_by AS submittedBy, case_reference AS caseReference'
    + ' FROM evidence_submissions WHERE seq < ? ORDER BY seq DESC LIMIT ?',
  );
  const submission = db.prepare<[string], Submission>(
    'SELECT seq, id, received_at AS receivedAt, submitted_by AS submittedBy, case_reference AS caseReference, statement'
    + ' FROM evidence_submissions WHERE id = ?',
  );
  const files = db.prepare<[string], EvidenceFile>(
    'SELECT id, name, byte_length AS byteLength FROM evidence_files WHERE submission_id = ? ORDER BY rowid',
  );
  const file = db.prepare<[string, string], EvidenceFile & { content: Buffer }>(
    'SELECT id, name, content FROM evidence_files WHERE submission_id = ? AND id = ?',
  );
  const used = db.prepare<[], { bytes: number }>('SELECT COALESCE(SUM(byte_length), 0) AS bytes FROM evidence_files');
  const addSubmission = db.prepare(
    'INSERT INTO evidence_submissions (id, received_at, submitted_by, case_reference, statement) VALUES (?, ?, ?, ?, ?)',
  );
  const addFile = db.prepare('INSERT INTO evidence_files VALUES (?, ?, ?, ?, ?)');

  app.get('/submit-evidence', async (_, reply) => page(reply, 'Send evidence to the court', [
    '<nav><a href="/login">Court staff sign in</a></nav>',
    '<p>Send original photos, videos, audio or documents to the judge’s evidence inbox. Save the reference shown after upload.</p>',
    '<form id="evidence-upload" method="post" action="/api/evidence/submissions" enctype="multipart/form-data">',
    '<label>Your name<input name="submittedBy" autocomplete="name" maxlength="120" required></label>',
    '<label>Case reference, if known<input name="caseReference" maxlength="120"></label>',
    '<label>Note for the court, optional<textarea name="statement" rows="4" maxlength="4000"></textarea></label>',
    '<label>Files<input type="file" name="evidence" accept="' + [...extensions].join(',') + '" multiple required aria-describedby="upload-limits"></label>',
    '<p id="upload-limits">Up to 5 files, 25 MiB per file and 40 MiB in total.</p>',
    '<button type="submit">Send to the court</button><p role="status"></p></form>',
  ].join(''), 'evidence-upload'));

  await app.register(async upload => {
    await upload.register(multipart);
    let activeUploads = 0;
    upload.post('/api/evidence/submissions', { config: { rateLimit: { max: 8 } } }, async (request, reply) => {
      allowedOrigin(request, origin);
      if (!request.isMultipart()) throw new HttpError(415, 'MULTIPART_REQUIRED');
      if (Number(request.headers['content-length']) > maxTotal + MiB) throw new HttpError(413, 'EVIDENCE_LIMIT');
      if (activeUploads >= 2) throw new HttpError(503, 'EVIDENCE_BUSY');
      activeUploads += 1;
      const fields: Record<string, unknown> = {};
      const attachments: { id: string; name: string; content: Buffer }[] = [];
      let total = 0;
      try {
        const limits = { files: maxFiles, fields: 3, parts: maxFiles + 3, fileSize: maxFile + 1, fieldSize: 16 * 1024 };
        for await (const part of request.parts({ limits })) {
          if (part.type === 'field') {
            if (!Object.hasOwn(submissionFields.shape, part.fieldname) || Object.hasOwn(fields, part.fieldname)
              || part.fieldnameTruncated || part.valueTruncated) throw new HttpError(400, 'INVALID_ARGUMENT');
            fields[part.fieldname] = part.value;
            continue;
          }
          const name = part.filename;
          if (part.fieldname !== 'evidence' || !name || name.length > 180 || /[\p{C}/\\]/u.test(name)
            || !extensions.has(extname(name).toLowerCase())) {
            part.file.destroy();
            throw new HttpError(415, 'EVIDENCE_FILE_TYPE');
          }
          const content = await part.toBuffer();
          total += content.length;
          if (attachments.length >= maxFiles || content.length > maxFile || total > maxTotal) {
            throw new HttpError(413, 'EVIDENCE_LIMIT');
          }
          if (!content.length) throw new HttpError(400, 'EVIDENCE_EMPTY');
          attachments.push({ id: randomUUID(), name, content });
        }
        if (!attachments.length) throw new HttpError(400, 'EVIDENCE_EMPTY');
        const input = parse(submissionFields, fields);
        const id = randomUUID();
        const receivedAt = new Date(now()).toISOString();
        db.transaction(() => {
          if (used.get()!.bytes + total > storageLimit) throw new HttpError(503, 'EVIDENCE_STORAGE_FULL');
          addSubmission.run(id, receivedAt, input.submittedBy, input.caseReference, input.statement);
          for (const entry of attachments) addFile.run(entry.id, id, entry.name, entry.content.length, entry.content);
          audit(db, 'citizen', 'evidence.receive', { submissionId: id, fileIds: attachments.map(entry => entry.id) });
        }).immediate();
        return reply.code(201).send({ reference: id, receivedAt, fileCount: attachments.length });
      } finally {
        activeUploads -= 1;
      }
    });
  });

  app.get('/judge/evidence', async (request, reply) => {
    try {
      authorize(request, ['judge']);
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 401) return reply.redirect('/login');
      throw error;
    }
    const { before } = parse(inboxQuery, request.query);
    const rows = inbox.all(before ?? Number.MAX_SAFE_INTEGER, pageSize + 1);
    const content = rows.slice(0, pageSize).map(row => '<li><a href="/judge/evidence/' + row.id + '">'
      + html(row.caseReference || row.id) + '</a><br>' + html(row.submittedBy)
      + ' · <time datetime="' + row.receivedAt + '">' + row.receivedAt + '</time></li>');
    const older = rows.length > pageSize ? '<p><a href="?before=' + rows[pageSize - 1].seq + '">Older submissions</a></p>' : '';
    return page(reply, 'Evidence inbox', judgeNav + (content.length ? '<ul>' + content.join('') + '</ul>' : '<p>No submissions.</p>') + older, 'judge-evidence');
  });

  app.get('/judge/evidence/:submissionId', async (request, reply) => {
    const judge = authorize(request, ['judge']);
    const { submissionId } = parse(submissionParams, request.params);
    const row = requireValue(submission.get(submissionId));
    const attachments = files.all(submissionId);
    db.transaction(() => audit(db, judge.id, 'evidence.open', { submissionId })).immediate();
    const links = attachments.map(entry => '<li><a href="/judge/evidence/' + row.id + '/files/' + entry.id + '">'
      + html(entry.name) + '</a> (' + entry.byteLength.toLocaleString('en-IN') + ' bytes)</li>');
    return page(reply, 'Evidence submission', judgeNav + '<dl>'
      + '<dt>Submission reference</dt><dd>' + row.id + '</dd>'
      + '<dt>Received (UTC)</dt><dd>' + row.receivedAt + '</dd>'
      + '<dt>Name supplied by submitter</dt><dd>' + html(row.submittedBy) + '</dd>'
      + '<dt>Case reference</dt><dd>' + html(row.caseReference || 'None supplied') + '</dd>'
      + '<dt>Note</dt><dd class="evidence-note">' + html(row.statement || 'None supplied') + '</dd></dl>'
      + '<h2>Original files</h2><p>Files are supplied by the sender. Open downloaded files in a protected viewer.</p>'
      + '<ul>' + links.join('') + '</ul>', 'judge-evidence');
  });

  app.get('/judge/evidence/:submissionId/files/:fileId', async (request, reply) => {
    const judge = authorize(request, ['judge']);
    const { submissionId, fileId } = parse(fileParams, request.params);
    const entry = requireValue(file.get(submissionId, fileId));
    db.transaction(() => audit(db, judge.id, 'evidence.download', { submissionId, fileId })).immediate();
    return reply.type('application/octet-stream').header('content-disposition', attachment(entry.name)).send(entry.content);
  });
}
