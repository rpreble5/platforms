/**
 * Publishing decks: the Studio's "Publish" lands a pack in questions/ on
 * THIS server, and — when the server has a GitHub token — commits it to
 * the repository too, so the host laptop picks it up with a pull.
 *
 * The repo is the database on purpose: decks are already files in the
 * format the game reads, git keeps every version and who changed what,
 * and the venue laptop syncs with the pull it already does. There is no
 * second copy of the truth anywhere.
 *
 * Conflicts are caught, not merged: every listing carries a `rev` (a hash
 * of the file's bytes); a publish sends the rev it opened, and a file that
 * moved on since is refused with 409 unless the author says force.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A deck's filename from its name, mirroring the Studio's download name so
 * the two routes agree. Never taken from the client as a path.
 * @param {string} name
 */
export function packSlug(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'deck'
  );
}

/** @param {string} text @returns {string} short content hash */
export function packRev(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

/**
 * The publish request, after the HTTP layer parsed it.
 * @typedef {object} PublishRequest
 * @property {any} pack the exportable pack JSON, as the Studio would download it
 * @property {string} [file] the questions/ file this deck was opened from
 * @property {string} [baseRev] the rev of that file when it was opened
 * @property {boolean} [force] overwrite even if the file moved on
 * @property {string} [by] the author's display name
 */

/**
 * Validate the shape, refuse a stale overwrite, write the file.
 * @param {string} root
 * @param {PublishRequest} req
 * @returns {{file: string, rev: string, text: string, created: boolean}}
 * @throws {Error & {code: 'BAD_PACK' | 'CONFLICT'}} with `current` on a conflict
 */
export function publishPack(root, req) {
  const pack = req?.pack;
  if (!pack || typeof pack !== 'object' || typeof pack.pack !== 'string' || !pack.pack.trim() || !Array.isArray(pack.questions)) {
    throw Object.assign(new Error('a deck needs a name and a questions list'), { code: 'BAD_PACK' });
  }
  const dir = path.join(root, 'questions');
  fs.mkdirSync(dir, { recursive: true });

  // The file: the one it was opened from if that still exists (renaming a
  // deck keeps its file), else the slug of its name.
  const known = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const wanted = typeof req.file === 'string' ? path.basename(req.file) : '';
  const file = wanted && known.includes(wanted) ? wanted : `${packSlug(pack.pack)}.json`;
  const full = path.join(dir, file);
  const exists = fs.existsSync(full);

  if (exists && !req.force) {
    const current = packRev(fs.readFileSync(full, 'utf8'));
    if (!req.baseRev || req.baseRev !== current) {
      throw Object.assign(new Error('this deck changed on the server since you opened it'), {
        code: 'CONFLICT',
        current,
      });
    }
  }

  const by = typeof req.by === 'string' ? req.by.trim().slice(0, 60) : '';
  const out = { ...pack, published: { by, at: new Date().toISOString() } };
  const text = `${JSON.stringify(out, null, 2)}\n`;
  fs.writeFileSync(full, text);
  return { file, rev: packRev(text), text, created: !exists };
}

/**
 * Commit one file to the repository through the GitHub Contents API:
 * read the current blob sha (if any), then PUT the new content. A plain
 * fetch, no SDK — two calls, and the token never leaves the server.
 * @param {{token: string, repo: string, branch: string, file: string, content: string, message: string, fetchImpl?: typeof fetch}} o
 * @returns {Promise<{sha: string, url: string}>}
 */
export async function commitToGitHub(o) {
  const f = o.fetchImpl ?? fetch;
  const api = `https://api.github.com/repos/${o.repo}/contents/questions/${encodeURIComponent(o.file)}`;
  const headers = {
    Authorization: `Bearer ${o.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
  let sha;
  const cur = await f(`${api}?ref=${encodeURIComponent(o.branch)}`, { headers });
  if (cur.status === 200) sha = (await cur.json()).sha;
  else if (cur.status !== 404) throw new Error(`GitHub read failed (${cur.status})`);
  const put = await f(api, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: o.message,
      content: Buffer.from(o.content, 'utf8').toString('base64'),
      branch: o.branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!put.ok) throw new Error(`GitHub commit failed (${put.status})`);
  const j = await put.json();
  return { sha: j.content?.sha ?? '', url: j.commit?.html_url ?? '' };
}
