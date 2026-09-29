'use client';
import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, ClipboardList, FileText, Sparkles } from 'lucide-react';
import { ChatComposer, type ComposerPrompt } from './ChatComposer';
import { FaqPrompts } from './FaqPrompts';
import { useChatWorkspace } from '@/hooks/useChatWorkspace';
import { ai } from '@/lib/api/ai-client';
import type { AcademicResource, ChatMode } from '@/types/chat';

const modes: Array<{ id: ChatMode; label: string; icon: typeof BookOpen }> = [
  { id: 'notes', label: 'Notes', icon: BookOpen },
  { id: 'pyqs', label: 'PYQs', icon: ClipboardList },
  { id: 'solutions', label: 'Solutions', icon: FileText }
];

export function WelcomeScreen() {
  const { semester, scope, setScope, mode, setMode, courses, coverage } = useChatWorkspace();
  const [suggestion, setSuggestion] = useState<ComposerPrompt | null>(null);
  const fillPrompt = (text: string, selectText?: string) => setSuggestion((current) => ({ id: (current?.id ?? 0) + 1, text, selectText }));
  const [resources, setResources] = useState<AcademicResource[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [repeated, setRepeated] = useState<Awaited<ReturnType<typeof ai.getRepeatedPyqs>> | null>(null);
  const [repeatedError, setRepeatedError] = useState<string | null>(null);
  const [examType, setExamType] = useState<'' | 'mid_semester' | 'end_semester'>('');
  const [pyqYear, setPyqYear] = useState('');
  const [questionPage, setQuestionPage] = useState(1);
  const [questions, setQuestions] = useState<Awaited<ReturnType<typeof ai.getPyqQuestions>> | null>(null);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const available = coverage.filter((item) => !scope.courseId || item.courseId === scope.courseId);
  const count = available.reduce((sum, item) => sum + item.count, 0);
  const papers = available.filter((item) => item.type === 'pyq').reduce((sum, item) => sum + item.count, 0);

  useEffect(() => { setPage(1); }, [scope.courseId, mode]);
  useEffect(() => { setRepeated(null); setRepeatedError(null); }, [scope.courseId]);
  useEffect(() => { setQuestionPage(1); }, [scope.courseId, examType, pyqYear]);
  useEffect(() => {
    if (mode !== 'pyqs' || !scope.courseId || (pyqYear && !/^\d{4}$/.test(pyqYear))) { setQuestions(null); return; }
    let cancelled = false;
    ai.getPyqQuestions({ courseId: scope.courseId, ...(examType ? { examType } : {}), ...(pyqYear ? { year: Number(pyqYear) } : {}), page: questionPage, limit: 8 })
      .then((result) => { if (!cancelled) { setQuestions(result); setQuestionError(null); } })
      .catch(() => { if (!cancelled) { setQuestions(null); setQuestionError('Could not load past-paper questions.'); } });
    return () => { cancelled = true; };
  }, [mode, scope.courseId, examType, pyqYear, questionPage]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ai.getResources({ courseId: scope.courseId, category: mode === 'notes' || mode === 'pyqs' || mode === 'solutions' ? mode : undefined, page, limit: 12 })
      .then((response) => { if (!cancelled) { setResources(response.resources); setTotal(response.total); setResourceError(null); } })
      .catch(() => { if (!cancelled) { setResources([]); setTotal(0); setResourceError('Materials are temporarily unavailable.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope.courseId, mode, page]);

  const askResource = (resource: AcademicResource) => {
    setScope({ sources: ['unicheatsheet'], courseId: resource.courseId, resourceId: resource.id, documentId: resource.documentId ?? undefined });
    setMode(resource.resourceType === 'pyq' ? 'pyqs' : ['solution', 'tutorial', 'assignment'].includes(resource.resourceType) ? 'solutions' : 'notes');
    fillPrompt(`Explain the important ideas in ${resource.title} and help me study them`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const selectCourseAction = (nextMode: ChatMode, prompt: string) => {
    setScope({ sources: ['unicheatsheet'], courseId: scope.courseId });
    setMode(nextMode);
    fillPrompt(prompt);
  };

  return <main className="welcome-screen"><div className="welcome-content">
    <div className="welcome-kicker"><span className="kicker-line" /> YOUR ACADEMIC COPILOT <span className="kicker-line" /></div>
    <h1>UniCheatSheet <span>AI</span></h1>
    {semester && <div className="semester-caption">Semester {semester}</div>}
    <p className="welcome-subtitle">Study what is available in your courses. Ask for a clear explanation, explore papers, or revise a topic.</p>
    <div className="welcome-composer"><ChatComposer prompt={suggestion} /><FaqPrompts onSelect={fillPrompt} /></div>
    <div className="study-mode-tabs" role="group" aria-label="Study material type">{modes.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={mode === id ? 'is-active' : ''} aria-pressed={mode === id} onClick={() => setMode(mode === id ? 'auto' : id)}><Icon size={16} />{label}</button>)}</div>
    <section className="course-home" aria-label="Your courses"><div className="home-section-heading"><h2>Your courses</h2><span>{courses.length} available</span></div><div className="course-home-grid">{courses.map((course) => { const resourceCount = coverage.filter((item) => item.courseId === course.id).reduce((sum, item) => sum + item.count, 0); return <button key={course.id} type="button" className={scope.courseId === course.id ? 'course-home-card is-active' : 'course-home-card'} onClick={() => setScope({ sources: ['unicheatsheet'], courseId: scope.courseId === course.id ? undefined : course.id })}><strong>{course.name}</strong><small>{resourceCount} indexed {resourceCount === 1 ? 'resource' : 'resources'}</small><ArrowUpRight size={16} /></button>; })}</div></section>
    <section className="quick-actions" aria-label="Quick actions"><div className="home-section-heading"><h2>Quick actions</h2></div><div className="quick-action-row"><button onClick={() => selectCourseAction('notes', 'Make concise revision notes from the indexed material in this course')}><Sparkles size={16} />Quick revision</button>{papers > 0 && <button onClick={() => selectCourseAction('pyqs', 'Give me some real past-paper questions from this course')}><ClipboardList size={16} />Past-paper questions</button>}{papers > 0 && scope.courseId && <button onClick={() => { void ai.getRepeatedPyqs(scope.courseId!).then((result) => { setRepeated(result); setRepeatedError(null); }).catch(() => setRepeatedError('Could not load repeated questions.')); }}><ClipboardList size={16} />Repeated questions</button>}<button onClick={() => selectCourseAction('practice', 'Generate a short practice test based on the indexed material, clearly labeled as generated practice')}><BookOpen size={16} />Practice test</button></div>
      {repeatedError && <p role="alert" className="material-empty">{repeatedError}</p>}
      {repeated && <div className="repeated-panel"><h3>Repeated questions in indexed papers</h3><p>Exact wording matches across distinct papers · {repeated.analyzedQuestions} indexed question records analyzed{repeated.truncated ? ' (first 5,000 only)' : ''}</p>{repeated.repeated.length ? <ol>{repeated.repeated.map((item, index) => <li key={index}><strong>{item.paperCount} papers</strong> · {item.text.replace(/^.*?\. Question \d+:\s*/i, '')}<small>{item.appearances.map((appearance) => `${appearance.year ?? 'Year unknown'} p.${appearance.page ?? '?'}`).join(' · ')}</small></li>)}</ol> : <p>No exact repeated wording found. Similar topics may still appear in different wording.</p>}</div>}
    </section>
    {mode === 'pyqs' && scope.courseId && <section className="pyq-browser" aria-label="Past-paper questions"><div className="home-section-heading"><h2>Past-paper questions</h2><span>{questions?.total ?? 0} indexed questions</span></div><div className="pyq-filters"><label>Exam<select value={examType} onChange={(event) => setExamType(event.target.value as typeof examType)}><option value="">All exams</option><option value="mid_semester">Mid semester</option><option value="end_semester">End semester</option></select></label><label>Year<input type="text" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="Any year" value={pyqYear} onChange={(event) => setPyqYear(event.target.value.replace(/\D/g, '').slice(0, 4))} /></label></div>{questionError ? <p className="material-empty" role="alert">{questionError}</p> : questions?.questions.length ? <ol className="pyq-question-list">{questions.questions.map((question) => <li key={question.id}><div className="pyq-question-meta">{question.year ?? 'Year unknown'} · {question.examType === 'end_semester' ? 'End semester' : question.examType === 'mid_semester' ? 'Mid semester' : 'Past paper'} · Page {question.page ?? '?'}</div><p>{question.text.replace(/^.*?\. Question \d+:\s*/i, '')}</p><small>{question.paperTitle}{question.needsReview ? ' · OCR needs review' : ''}</small><button type="button" onClick={() => { setScope({ sources: ['unicheatsheet'], courseId: scope.courseId, documentId: question.documentId }); fillPrompt(`Solve question ${question.questionNumber ?? ''} from ${question.paperTitle} and explain every step`); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Ask AI to solve</button></li>)}</ol> : <p className="material-empty">{pyqYear && pyqYear.length !== 4 ? 'Enter a four-digit year.' : questions ? 'No indexed questions match these filters.' : 'Loading questions…'}</p>}{questions && questions.total > 8 && <div className="material-pages"><button disabled={questionPage === 1} onClick={() => setQuestionPage((value) => value - 1)}>Previous</button><span>Page {questionPage} of {Math.ceil(questions.total / 8)}</span><button disabled={questionPage * 8 >= questions.total} onClick={() => setQuestionPage((value) => value + 1)}>Next</button></div>}<p className="pyq-caution">Scanned question wording can contain OCR errors. Check the original paper for symbols and marks.</p></section>}
    <section className="material-browser" aria-label="Browse material"><div className="home-section-heading"><h2>Browse material</h2><span>{total} {mode === 'auto' || mode === 'practice' ? 'resources' : mode}</span></div>
      {loading ? <p className="material-empty">Loading materials…</p> : resourceError ? <p className="material-empty" role="alert">{resourceError}</p> : resources.length ? <div className="material-grid">{resources.map((resource) => <article className="material-card" key={resource.id}><div className="material-card-meta"><span>{resource.courseName}</span><span>{resource.resourceType.toUpperCase()}</span>{resource.contentFormat !== 'unknown' && <span>{resource.contentFormat}</span>}</div><h3>{resource.title}</h3><p>{resource.unit ? `${resource.unit} · ` : ''}{resource.pageCount ? `${resource.pageCount} pages · ` : ''}{resource.indexed ? 'Indexed for AI' : 'Index pending'}{resource.ocrPageCount ? ` · ${resource.ocrPageCount} OCR pages` : ''}{resource.needsReviewPageCount ? ` · ${resource.needsReviewPageCount} need review` : ''}</p><button type="button" disabled={!resource.indexed} onClick={() => askResource(resource)}>Ask AI about this <ArrowUpRight size={15} /></button></article>)}</div> : <p className="material-empty">No indexed {mode === 'auto' ? 'materials' : mode} in this selection yet.</p>}
      {total > 12 && <div className="material-pages"><button disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page} of {Math.ceil(total / 12)}</span><button disabled={page * 12 >= total} onClick={() => setPage((current) => current + 1)}>Next</button></div>}
    </section>
    <p className="welcome-footnote">{count ? `${count} indexed ${count === 1 ? 'document' : 'documents'} available${papers ? `, including ${papers} past ${papers === 1 ? 'paper' : 'papers'}` : ''}.` : 'Choose a course and ask about its indexed material.'}</p>
  </div></main>;
}
