'use client';
import { ChevronDown, GraduationCap } from 'lucide-react';
import { useChatWorkspace } from '@/hooks/useChatWorkspace';
export function ScopeSelector() {
  const { courses, scope, setScope } = useChatWorkspace();
  const selected = courses.find((course) => course.id === scope.courseId);
  return <label className="scope-select-wrap" title="Choose a course for more focused answers">
    <GraduationCap size={16} strokeWidth={1.7} /><span className="scope-label">{selected?.code || selected?.name || 'All courses'}</span><ChevronDown size={14} strokeWidth={1.7} />
    <select aria-label="Course scope" value={scope.courseId ?? ''} onChange={(event) => { const course = courses.find((item) => item.id === event.target.value); setScope({ ...scope, courseId: course?.id, semester: undefined }); }}>
      <option value="">All courses</option>
      {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
    </select>
  </label>;
}
