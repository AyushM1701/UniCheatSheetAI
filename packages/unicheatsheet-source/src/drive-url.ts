const FILE_ID = /^[A-Za-z0-9_-]{3,}$/;

export function extractDriveFileId(value: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || !['drive.google.com', 'docs.google.com'].includes(url.hostname.toLowerCase())) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.includes('folders')) return null;
  let id: string | undefined;
  const d = segments.indexOf('d');
  if (d > 0 && ['file', 'document', 'spreadsheets', 'presentation', 'forms'].includes(segments[d - 1]!)) id = segments[d + 1];
  else if (['/open', '/uc'].includes(url.pathname)) id = url.searchParams.get('id') ?? undefined;
  return id && FILE_ID.test(id) ? id : null;
}
