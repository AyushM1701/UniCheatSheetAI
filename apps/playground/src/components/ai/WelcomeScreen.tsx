'use client';
import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, ClipboardList, FileText, Sparkles } from 'lucide-react';
import { ChatComposer } from './ChatComposer';
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
  const [suggestion, setSuggestion] = useState('');
  const [resources, setResources] = useState<AcademicResource[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [repeated, setRepeated] = useState<Awaited<ReturnType<typeof ai.getRepeatedPyqs>> | null>(null);
  const [repeatedError, setRepeatedError] = useState<string | null>(null);
  const available = coverage.filter((item) => !scope.courseId || item.courseId === scope.courseId);
  const count = available.reduce((sum, item) => sum + item.count, 0);
  const papers = available.filter((item) => item.type === 'pyq').reduce((sum, item) => sum + item.count, 0);

  useEffect(() => { setPage(1); }, [scope.courseId, mode]);
  useEffect(() => { setRepeated(null); setRepeatedError(null); }, [scope.courseId]);
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
    setSuggestion(`Explain the important ideas in ${resource.title} and help me study them`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return <main className="welcome-screen"><div className="welcome-content">
    <div className="welcome-kicker"><span className="kicker-line" /> YOUR ACADEMIC COPILOT <span className="kicker-line" /></div>
    <h1>UniCheatSheet <span>AI</span></h1>
    {semester && <div className="semester-caption">Semester {semester}</div>}
    <p className="welcome-subtitle">Study what is available in your courses. Ask for a clear explanation, explore papers, or revise a topic.</p>
    <div className="welcome-composer"><ChatComposer initialText={suggestion} /></div>
    <div className="study-mode-tabs" role="group" aria-label="Study material type">{modes.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={mode === id ? 'is-active' : ''} aria-pressed={mode === id} onClick={() => setMode(mode === id ? 'auto' : id)}><Icon size={16} />{label}</button>)}</div>
    <section className="course-home" aria-label="Your courses"><div className="home-section-heading"><h2>Your courses</h2><span>{courses.length} available</span></div><div className="course-home-grid">{courses.map((course) => { const resourceCount = coverage.filter((item) => item.courseId === course.id).reduce((sum, item) => sum + item.count, 0); return <button key={course.id} type="button" className={scope.courseId === course.id ? 'course-home-card is-active' : 'course-home-card'} onClick={() => setScope({ sources: ['unicheatsheet'], courseId: scope.courseId === course.id ? undefined : course.id })}><strong>{course.name}</strong><small>{resourceCount} indexed {resourceCount === 1 ? 'resource' : 'resources'}</small><ArrowUpRight size={16} /></button>; })}</div></section>
    <section className="quick-actions" aria-label="Quick actions"><div className="home-section-heading"><h2>Quick actions</h2></div><div className="quick-action-row"><button onClick={() => { setMode('notes'); setSuggestion('Make concise revision notes from the indexed material in this course'); }}><Sparkles size={16} />Quick revision</button>{papers > 0 && <button onClick={() => { setMode('pyqs'); setSuggestion('Give me some real past-paper questions from this course'); }}><ClipboardList size={16} />Past-paper questions</button>}{papers > 0 && scope.courseId && <button onClick={() => { void ai.getRepeatedPyqs(scope.courseId!).then((result) => { setRepeated(result); setRepeatedError(null); }).catch(() => setRepeatedError('Could not load repeated questions.')); }}><ClipboardList size={16} />Repeated questions</button>}<button onClick={() => { setMode('practice'); setSuggestion('Generate a short practice test based on the indexed material, clearly labeled as generated practice'); }}><BookOpen size={16} />Practice test</button></div>
      {repeatedError && <p role="alert" className="material-empty">{repeatedError}</p>}
      {repeated && <div className="repeated-panel"><h3>Repeated questions in indexed papers</h3><p>Exact wording matches across distinct papers · {repeated.analyzedQuestions} indexed question records analyzed{repeated.truncated ? ' (first 5,000 only)' : ''}</p>{repeated.repeated.length ? <ol>{repeated.repeated.map((item, index) => <li key={index}><strong>{item.paperCount} papers</strong> · {item.text.replace(/^.*?\. Question \d+:\s*/i, '')}<small>{item.appearances.map((appearance) => `${appearance.year ?? 'Year unknown'} p.${appearance.page ?? '?'}`).join(' · ')}</small></li>)}</ol> : <p>No exact repeated wording found. Similar topics may still appear in different wording.</p>}</div>}
    </section>
    <section className="material-browser" aria-label="Browse material"><div className="home-section-heading"><h2>Browse material</h2><span>{total} {mode === 'auto' || mode === 'practice' ? 'resources' : mode}</span></div>
      {loading ? <p className="material-empty">Loading materials…</p> : resourceError ? <p className="material-empty" role="alert">{resourceError}</p> : resources.length ? <div className="material-grid">{resources.map((resource) => <article className="material-card" key={resource.id}><div className="material-card-meta"><span>{resource.courseName}</span><span>{resource.resourceType.toUpperCase()}</span>{resource.contentFormat !== 'unknown' && <span>{resource.contentFormat}</span>}</div><h3>{resource.title}</h3><p>{resource.unit ? `${resource.unit} · ` : ''}{resource.pageCount ? `${resource.pageCount} pages · ` : ''}{resource.indexed ? 'Indexed for AI' : 'Index pending'}</p><button type="button" disabled={!resource.indexed} onClick={() => askResource(resource)}>Ask AI about this <ArrowUpRight size={15} /></button></article>)}</div> : <p className="material-empty">No indexed {mode === 'auto' ? 'materials' : mode} in this selection yet.</p>}
      {total > 12 && <div className="material-pages"><button disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page} of {Math.ceil(total / 12)}</span><button disabled={page * 12 >= total} onClick={() => setPage((current) => current + 1)}>Next</button></div>}
    </section>
    <p className="welcome-footnote">{count ? `${count} indexed ${count === 1 ? 'document' : 'documents'} available${papers ? `, including ${papers} past ${papers === 1 ? 'paper' : 'papers'}` : ''}.` : 'Choose a course and ask about its indexed material.'}</p>
  </div></main>;
}
