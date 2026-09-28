import { describe, expect, it } from 'vitest';
import { examMetadata, examQuestionFields } from '../packages/ingestion/src/exam-metadata.js';

describe('exam metadata', () => {
  it('extracts only explicit paper details from a catalog title', () => {
    expect(examMetadata('Set01_ESE_MAY24_SOCS_B TECH_II_ECEG1012_Digital Electronics')).toEqual({ year: 2024, examType: 'end_semester', session: 'MAY', courseCode: 'ECEG1012', program: 'B.Tech' });
    expect(examMetadata('Untitled paper')).toEqual({ year: null, examType: null, session: null, courseCode: null, program: null });
  });
  it('does not guess marks when a question has no explicit marks label', () => {
    expect(examQuestionFields('Paper. Question 7: Q7 Design a counter.')).toMatchObject({ questionNumber: '7', marks: null });
    expect(examQuestionFields('Paper. Question 2: Q2 Explain (a) CMOS [10 marks]')).toMatchObject({ questionNumber: '2', subpart: 'a', marks: 10 });
  });
});
