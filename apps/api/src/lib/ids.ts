import { randomBytes, randomUUID } from 'node:crypto';

export const uuid = () => randomUUID();

/** Human-friendly invite code, e.g. "LUMEN-7Q4K". Avoids ambiguous characters. */
export function inviteCode(prefix: string): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(4);
  const tail = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  const head = prefix.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6) || 'TEAM';
  return `${head}-${tail}`;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace'
  );
}
