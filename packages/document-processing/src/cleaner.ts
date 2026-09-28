export function cleanText(input: string): string {
  return input.replace(/\0/g, '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
