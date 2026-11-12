import { jwtVerify, SignJWT } from 'jose';
import type { Task } from '@delegate/shared';
import type { AppConfig } from '../config.js';
import { badRequest, HttpError } from '../lib/errors.js';
import type { Http } from './channels.js';

interface DriveFile {
  id: string;
  name: string;
  webViewLink?: string;
  modifiedTime?: string;
  mimeType?: string;
  lastModifyingUser?: { displayName?: string; emailAddress?: string };
  owners?: Array<{ emailAddress?: string }>;
}

export interface DriveAttestation {
  taskId: string;
  url: string;
  fileName: string;
  note: string;
  verified: boolean;
}

const AUDIENCE = 'delegate-drive-proof';

/**
 * Google Drive proof. The browser picks a file with the Google Picker (drive.file scope — no
 * restricted-scope review) and hands us the file id + its short-lived access token. We read the
 * file's metadata from Google ourselves and return a signed attestation the submit call accepts,
 * so "verified" can't be forged client-side.
 */
export class DriveService {
  private key: Uint8Array;

  constructor(
    private config: AppConfig,
    private http: Http,
  ) {
    this.key = new Uint8Array(config.encryptionKey);
  }

  get enabled() {
    return !!this.config.google;
  }

  async verify(task: Task, assigneeEmail: string, fileId: string, accessToken: string) {
    if (!/^[\w-]{10,200}$/.test(fileId)) throw badRequest('That is not a Google Drive file id');
    const fields = 'id,name,webViewLink,modifiedTime,mimeType,lastModifyingUser(displayName,emailAddress),owners(emailAddress)';
    const res = await this.http(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 401 || res.status === 403) throw new HttpError(400, 'Google did not allow access to that file. Pick it again.', 'drive_denied');
    if (res.status === 404) throw badRequest('Google Drive could not find that file');
    if (!res.ok) throw new HttpError(502, `Google Drive error (${res.status})`, 'provider_error');
    const file = (await res.json()) as DriveFile;

    const since = new Date(task.startedAt ?? task.createdAt).getTime() - 5 * 60_000; // allow clock skew
    const modified = file.modifiedTime ? new Date(file.modifiedTime).getTime() : 0;
    const email = assigneeEmail.toLowerCase();
    const byAssignee =
      file.lastModifyingUser?.emailAddress?.toLowerCase() === email || (file.owners ?? []).some((o) => o.emailAddress?.toLowerCase() === email);
    const verified = modified >= since && byAssignee;
    const editedBy = file.lastModifyingUser?.displayName ?? 'someone';
    const note = `Google Drive · ${file.name} · last edited by ${editedBy} ${file.modifiedTime ? new Date(file.modifiedTime).toUTCString().slice(5, 22) : ''}${
      verified ? '' : modified < since ? ' (before the task started)' : ' (not by the assignee)'
    }`;

    const attestation: DriveAttestation = {
      taskId: task.id,
      url: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
      fileName: file.name.slice(0, 200),
      note,
      verified,
    };
    const token = await new SignJWT({ ...attestation }).setProtectedHeader({ alg: 'HS256' }).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('30m').sign(this.key);
    return { attestation: token, preview: attestation };
  }

  async readAttestation(token: string, taskId: string): Promise<DriveAttestation> {
    try {
      const { payload } = await jwtVerify(token, this.key, { audience: AUDIENCE });
      const att = payload as unknown as DriveAttestation;
      if (att.taskId !== taskId) throw new Error('task mismatch');
      return { taskId: att.taskId, url: att.url, fileName: att.fileName, note: att.note, verified: !!att.verified };
    } catch {
      throw badRequest('The Google Drive check expired. Pick the file again.');
    }
  }
}
