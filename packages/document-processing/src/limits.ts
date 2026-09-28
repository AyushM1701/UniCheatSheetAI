export function pdfMaxBytes(): number {
  const mb = Number(process.env.PDF_MAX_MB ?? 25);
  if (!Number.isFinite(mb) || mb < 1 || mb > 250) throw new Error('PDF_MAX_MB must be between 1 and 250');
  return Math.floor(mb * 1024 * 1024);
}
