import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { allowedOrigin, type Session } from './auth.js';
import { audit, type Db } from './db.js';
import { html, HttpError, page, parse, requireValue } from './http.js';
import { verifyExhibit, type EvidenceMetadata, type openVault } from './vault.js';

const MiB = 1024 * 1024;
const maxFile = 25 * MiB;
const maxTotal = 40 * MiB;
const maxFiles = 5;
const storageLimit = 1024 * MiB;
const submissionLimit = 10_000;
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
const anonymousFields = z.strictObject({
  category: z.enum(['report', 'petition']),
  statement: z.string().trim().max(4000).default(''),
});
function uploadSuffix(anonymous = false) {
  return '<p id="upload-limits">Up to 5 files, 25 MiB per file and 40 MiB in total.</p>'
    + '<button type="submit"' + (anonymous ? ' disabled' : '') + '>Send to the court</button><p role="status"></p>'
    + '<a id="evidence-receipt" download="courtplus-evidence-receipt.json" hidden>Download signed receipt</a></form>';
}
const fileInput = '<label>Files<input type="file" name="evidence" accept="' + [...extensions].join(',')
  + '" multiple aria-describedby="upload-limits"';
const submissionParams = z.object({ submissionId: z.uuidv4() });
const fileParams = submissionParams.extend({ fileId: z.uuidv4() });
const inboxQuery = z.strictObject({
  before: z.string().regex(/^[1-9]\d{0,14}$/).transform(Number).optional(),
});
const judgeNav = '<nav><a href="/judge/evidence">Evidence inbox</a> <button id="sign-out" type="button">Sign out</button></nav>';
type InboxEntry = Omit<EvidenceMetadata, 'statement'> & { seq: number };
type JudgeAccess = (request: FastifyRequest, roles: readonly ['judge']) => Session;
type EvidenceRequest = EvidenceMetadata['channel'];

function submitter(row: InboxEntry | EvidenceMetadata) {
  if (row.channel === 'identified') return row.submittedBy;
  return row.category === 'petition' ? 'Anonymous petition' : 'Anonymous report';
}

function attachment(name: string) {
  const encoded = encodeURIComponent(name).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16));
  return 'attachment; filename="evidence' + extname(name).toLowerCase() + '"; filename*=UTF-8\'\'' + encoded;
}

export async function evidenceRoutes(app: FastifyInstance, db: Db, origin: string, now: () => number,
  authorize: JudgeAccess, vault: ReturnType<typeof openVault>) {
  const inbox = db.prepare<[number, number], InboxEntry>(
    'SELECT seq, id, received_at AS receivedAt, submitted_by AS submittedBy, case_reference AS caseReference, channel, category'
    + ' FROM evidence_submissions WHERE seq < ? ORDER BY seq DESC LIMIT ?',
  );
  const submission = db.prepare<[string], EvidenceMetadata>(
    'SELECT id, received_at AS receivedAt, submitted_by AS submittedBy, case_reference AS caseReference, statement, channel, category'
    + ' FROM evidence_submissions WHERE id = ?',
  );
  const file = db.prepare<[string, string], { id: string; name: string; content: Buffer }>(
    'SELECT id, name, content FROM evidence_files WHERE submission_id = ? AND id = ?',
  );
  const used = db.prepare<[], { bytes: number }>('SELECT COALESCE(SUM(byte_length), 0) AS bytes FROM evidence_files');
  const submissionCount = db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM evidence_submissions');
  const addSubmission = db.prepare(
    'INSERT INTO evidence_submissions (id, received_at, submitted_by, case_reference, statement, channel, category) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const addFile = db.prepare('INSERT INTO evidence_files VALUES (?, ?, ?, ?, ?)');

  app.get('/submit-evidence', async (_, reply) => page(reply, 'Send evidence to the court', [
    '<nav><a href="/login">Court staff sign in</a> · <a href="/report-anonymously">Report anonymously</a></nav>',
    '<p>Send original photos, videos, audio or documents to the judge’s evidence inbox. Save the reference shown after upload.</p>',
    '<form id="evidence-upload" method="post" action="/api/evidence/submissions" enctype="multipart/form-data">',
    '<label>Your name<input name="submittedBy" autocomplete="name" maxlength="120" required></label>',
    '<label>Case reference, if known<input name="caseReference" maxlength="120"></label>',
    '<label>Note for the court, optional<textarea name="statement" rows="4" maxlength="4000"></textarea></label>',
    fileInput + ' required></label>', uploadSuffix(),
  ].join(''), 'evidence-upload'));

  app.get('/report-anonymously', { logLevel: 'silent' }, async (_, reply) => page(reply, 'Report or petition anonymously', [
    '<p>Send a statement, files, or both to the judge’s evidence inbox. This form uses no account, name, or contact fields.</p>',
    '<p>File contents are preserved exactly and may carry identifying details, including location, faces, voices, or document metadata. '
      + 'Check your files and statement before sending. Network operators may see that you connected.</p>',
    '<form id="evidence-upload" method="post" action="/api/evidence/anonymous" enctype="multipart/form-data" data-anonymous>',
    '<label>Submission type<select name="category"><option value="report">Report</option><option value="petition">Petition</option></select></label>',
    '<label>Statement<textarea name="statement" rows="6" maxlength="4000"></textarea></label>',
    fileInput + '></label>', uploadSuffix(true),
    '<noscript><p>Enable JavaScript to send your report without browser credentials.</p></noscript>',
  ].join(''), 'evidence-upload', '/anonymous-assets'));

  await app.register(async upload => {
    await upload.register(multipart);
    let activeUploads = 0;
    async function receive(request: FastifyRequest, reply: FastifyReply, channel: EvidenceRequest) {
      const anonymous = channel === 'anonymous';
      const schema = anonymous ? anonymousFields : submissionFields;
      allowedOrigin(request, origin);
      if (anonymous && (request.headers.cookie || request.headers.authorization)) {
        throw new HttpError(400, 'ANONYMOUS_CREDENTIALS');
      }
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
            if (!Object.hasOwn(schema.shape, part.fieldname) || Object.hasOwn(fields, part.fieldname)
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
          const fileId = randomUUID();
          attachments.push({ id: fileId, name: anonymous ? 'exhibit-' + (attachments.length + 1) + extname(name).toLowerCase() : name, content });
        }
        const id = randomUUID();
        const receivedAt = new Date(now()).toISOString();
        const metadata: EvidenceMetadata = anonymous
          ? { id, receivedAt, channel, submittedBy: '', caseReference: '', ...parse(anonymousFields, fields) }
          : { id, receivedAt, channel, ...parse(submissionFields, fields) };
        if (!attachments.length && (!anonymous || !metadata.statement)) {
          throw new HttpError(400, anonymous ? 'ANONYMOUS_EMPTY' : 'EVIDENCE_EMPTY');
        }
        const receipt = db.transaction(() => {
          if (used.get()!.bytes + total > storageLimit || submissionCount.get()!.count >= submissionLimit) {
            throw new HttpError(503, 'EVIDENCE_STORAGE_FULL');
          }
          addSubmission.run(id, receivedAt, metadata.submittedBy, metadata.caseReference, metadata.statement, metadata.channel, metadata.category ?? null);
          for (const entry of attachments) addFile.run(entry.id, id, entry.name, entry.content.length, entry.content);
          audit(db, anonymous ? 'anonymous' : 'citizen', 'evidence.receive', { submissionId: id, fileIds: attachments.map(entry => entry.id) });
          return vault.seal(metadata, attachments);
        }).immediate();
        return reply.code(201).send({ reference: id, receivedAt, fileCount: attachments.length, receipt });
      } finally {
        activeUploads -= 1;
      }
    }
    upload.post('/api/evidence/submissions', { config: { rateLimit: { max: 8 } } },
      (request, reply) => receive(request, reply, 'identified'));
    upload.post('/api/evidence/anonymous', { logLevel: 'silent', config: { rateLimit: { max: 8 } } },
      (request, reply) => receive(request, reply, 'anonymous'));
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
      + html(row.caseReference || row.id) + '</a><br>' + html(submitter(row))
      + ' · <time datetime="' + row.receivedAt + '">' + row.receivedAt + '</time></li>');
    const older = rows.length > pageSize ? '<p><a href="?before=' + rows[pageSize - 1].seq + '">Older submissions</a></p>' : '';
    return page(reply, 'Evidence inbox', judgeNav + (content.length ? '<ul>' + content.join('') + '</ul>' : '<p>No submissions.</p>') + older, 'judge-evidence');
  });

  app.get('/judge/evidence/:submissionId', { exposeHeadRoute: false }, async (request, reply) => {
    const judge = authorize(request, ['judge']);
    const { submissionId } = parse(submissionParams, request.params);
    const row = requireValue(submission.get(submissionId));
    const { payload } = vault.getSeal(row);
    db.transaction(() => {
      audit(db, judge.id, 'evidence.open', { submissionId });
      vault.record(submissionId, judge.id, { action: 'open' });
    }).immediate();
    const links = payload.manifest.files.map(entry => '<li><a href="/judge/evidence/' + row.id + '/files/' + entry.id + '">'
      + html(entry.name) + '</a> (' + entry.bytes.toLocaleString('en-IN') + ' bytes)'
      + '<br>SHA-256 <code>' + entry.sha256 + '</code></li>');
    return page(reply, 'Evidence submission', judgeNav + '<dl>'
      + '<dt>Submission reference</dt><dd>' + row.id + '</dd>'
      + '<dt>Received (UTC)</dt><dd>' + row.receivedAt + '</dd>'
      + '<dt>Sealed (UTC)</dt><dd>' + payload.at + (payload.action === 'legacy' ? ' · sealed after migration' : '') + '</dd>'
      + '<dt>' + (row.channel === 'anonymous' ? 'Intake channel' : 'Name supplied by submitter') + '</dt><dd>' + html(submitter(row)) + '</dd>'
      + (row.channel === 'identified' ? '<dt>Case reference</dt><dd>' + html(row.caseReference || 'None supplied') + '</dd>' : '')
      + '<dt>Note</dt><dd class="evidence-note">' + html(row.statement || 'None supplied') + '</dd></dl>'
      + (payload.manifest.statementSha256 ? '<p><a href="/judge/evidence/' + row.id + '/statement">Download verified statement</a></p>' : '')
      + (links.length ? '<h2>Original files</h2><p>Files are supplied by the sender. Open downloaded files in a protected viewer.</p>'
        + '<ul>' + links.join('') + '</ul>' : '')
      + '<p><a href="/judge/evidence/' + row.id + '/manifest">Download signed manifest</a> · '
      + '<a href="/judge/evidence/' + row.id + '/section-63">Section 63 hash report and worksheet</a> · '
      + '<a href="/judge/evidence/' + row.id + '/custody">Download custody trail</a></p>', 'judge-evidence');
  });

  app.get('/judge/evidence/:submissionId/files/:fileId', { exposeHeadRoute: false }, async (request, reply) => {
    const judge = authorize(request, ['judge']);
    const { submissionId, fileId } = parse(fileParams, request.params);
    const row = requireValue(submission.get(submissionId));
    const entry = requireValue(file.get(submissionId, fileId));
    vault.verifyFile(row, entry);
    db.transaction(() => {
      audit(db, judge.id, 'evidence.download', { submissionId, fileId });
      vault.record(submissionId, judge.id, { action: 'download', fileId });
    }).immediate();
    return reply.type('application/octet-stream').header('content-disposition', attachment(entry.name)).send(entry.content);
  });

  app.get('/judge/evidence/:submissionId/manifest', { exposeHeadRoute: false }, async (request, reply) => {
    const judge = authorize(request, ['judge']);
    const { submissionId } = parse(submissionParams, request.params);
    const seal = vault.verifySubmission(requireValue(submission.get(submissionId)));
    db.transaction(() => vault.record(submissionId, judge.id, { action: 'manifest' })).immediate();
    return reply.header('content-disposition', 'attachment; filename="courtplus-evidence-manifest.json"').send(seal);
  });

  app.get('/judge/evidence/:submissionId/statement', { exposeHeadRoute: false }, async (request, reply) => {
    const judge = authorize(request, ['judge']);
    const { submissionId } = parse(submissionParams, request.params);
    const row = requireValue(submission.get(submissionId));
    if (row.channel !== 'anonymous' || !row.statement) throw new HttpError(404, 'NOT_FOUND');
    const contents = Buffer.from(row.statement, 'utf8');
    verifyExhibit(contents, 'statement', vault.getSeal(row), vault.pem);
    db.transaction(() => vault.record(submissionId, judge.id, { action: 'statement' })).immediate();
    return reply.type('application/octet-stream').header('content-disposition', 'attachment; filename="statement.txt"').send(contents);
  });

  app.get('/judge/evidence/:submissionId/custody', { exposeHeadRoute: false }, async (request, reply) => {
    const judge = authorize(request, ['judge']);
    const { submissionId } = parse(submissionParams, request.params);
    vault.getSeal(requireValue(submission.get(submissionId)));
    const events = db.transaction(() => {
      vault.record(submissionId, judge.id, { action: 'custody' });
      return vault.evidenceHistory(submissionId);
    }).immediate();
    return reply.header('content-disposition', 'attachment; filename="courtplus-evidence-custody.json"').send(events);
  });

  app.get('/judge/evidence/:submissionId/section-63', { exposeHeadRoute: false }, async (request, reply) => {
    const judge = authorize(request, ['judge']);
    const { submissionId } = parse(submissionParams, request.params);
    const { payload } = vault.verifySubmission(requireValue(submission.get(submissionId)));
    db.transaction(() => vault.record(submissionId, judge.id, { action: 'section63' })).immediate();
    const fileHashes = payload.manifest.files.map(entry => '<li>' + html(entry.name) + ' · '
      + entry.bytes + ' bytes<br>File reference ' + entry.id + '<br>SHA-256 <code>' + entry.sha256 + '</code></li>');
    const worksheet = (heading: string, fields: string[]) => '<h2>' + heading + '</h2><dl>'
      + fields.map(field => '<dt>' + field + '</dt><dd>________________________________________________</dd>').join('') + '</dl>';
    const signoff = ['Name and designation', 'Signature', 'Date, time (IST), and place'];
    return page(reply, 'Section 63 hash report and worksheet',
      '<p><strong>For preparation and review.</strong> Attach this hash report to the applicable certificate. '
      + 'The custodian and expert must supply their own particulars, attestations, and signatures.</p>'
      + '<p><a href="https://www.ncrb.mha.gov.in/uploads/SankalanPortal/ScheduleBSA.html">Official Schedule</a></p>'
      + '<dl><dt>Submission</dt><dd>' + submissionId + '</dd><dt>Recorded receipt (UTC)</dt><dd>' + payload.manifest.receivedAt + '</dd>'
      + '<dt>Sealed (UTC)</dt><dd>' + payload.at + (payload.action === 'legacy' ? ' · sealed after migration' : '') + '</dd>'
      + '<dt>CourtPlus seal key fingerprint</dt><dd><code>' + payload.keyId + '</code></dd>'
      + '<dt>Canonical submission metadata SHA-256</dt><dd><code>' + payload.manifest.metadataSha256 + '</code></dd>'
      + (payload.manifest.statementSha256 ? '<dt>Statement SHA-256</dt><dd><code>' + payload.manifest.statementSha256 + '</code></dd>' : '')
      + '</dl>'
      + '<h2>Exhibit hashes</h2>' + (fileHashes.length ? '<ul>' + fileHashes.join('') + '</ul>' : '<p>No file attachments.</p>')
      + worksheet('Part A preparation · Custodian', ['Source, device type, make, model and identifiers',
        'How the record was produced and copied', 'Control, regular operation and any interruptions', ...signoff])
      + worksheet('Part B preparation · Expert', ['Examined source, device type, make, model and identifiers',
        'Examined records and independent SHA-256 results', ...signoff]));
  });
}
