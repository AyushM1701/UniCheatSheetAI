export function examMetadata(title: string) {
  const yearToken = title.match(/(?:19|20)\d{2}|(?:MAY|NOV|DEC|APR|JAN|FEB|MAR|JUN|JUL|AUG|SEP|OCT)[_\s-]*(\d{2})(?!\d)/i);
  const year = yearToken ? (yearToken[1] ? 2000 + Number(yearToken[1]) : Number(yearToken[0])) : null;
  const examType = /(?:^|[_\s-])(?:ESE|END[_\s-]?SEM)(?:$|[_\s-])/i.test(title) ? 'end_semester'
    : /(?:^|[_\s-])(?:MSE|MID[_\s-]?SEM)(?:$|[_\s-])/i.test(title) ? 'mid_semester' : null;
  const session = title.match(/(?:^|[_\s-])(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(?=$|[_\s-]|\d)/i)?.[1]?.toUpperCase() ?? null;
  const courseCode = title.match(/(?:^|[_\s-])([A-Z]{3,6}\d{3,5})(?=$|[_\s-])/i)?.[1] ?? null;
  const program = /B\.?\s*TECH/i.test(title) ? 'B.Tech' : /B\.?\s*SC/i.test(title) ? 'B.Sc' : null;
  return { year, examType, session, courseCode, program };
}

export function examQuestionFields(content: string) {
  const questionNumber = content.match(/\bQuestion\s+(\d{1,2})(?=\s*:)/i)?.[1] ?? null;
  const subpart = content.match(/(?:^|\s)\(([a-z])\)/i)?.[1]?.toLowerCase() ?? null;
  const marksToken = content.match(/\[(\d{1,2})\s*(?:marks?|m)\]|\((\d{1,2})\s*marks?\)/i);
  const marks = marksToken ? Number(marksToken[1] ?? marksToken[2]) : null;
  return { questionNumber, subpart, marks };
}
