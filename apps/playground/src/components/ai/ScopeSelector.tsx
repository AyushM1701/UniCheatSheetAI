'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, GraduationCap } from 'lucide-react';
import { useChatWorkspace } from '@/hooks/useChatWorkspace';

export function ScopeSelector() {
  const { courses, scope, setScope } = useChatWorkspace();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId();
  const items = [{ id: '', name: 'All allowed courses' }, ...courses];
  const selectedIndex = Math.max(0, items.findIndex((course) => course.id === (scope.courseId ?? '')));
  const selected = items[selectedIndex]!;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);
  useEffect(() => {
    if (open) requestAnimationFrame(() => options.current[selectedIndex]?.focus());
  }, [open, selectedIndex]);

  const close = () => { setOpen(false); trigger.current?.focus(); };
  const choose = (id: string) => {
    setScope({ ...scope, courseId: id || undefined, semester: undefined });
    close();
  };
  const move = (index: number) => options.current[(index + items.length) % items.length]?.focus();
  return <div ref={root} className={`scope-select-wrap${open ? ' is-open' : ''}`}>
    <button ref={trigger} type="button" className="scope-trigger" aria-label={`Course scope: ${selected.name}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((current) => !current)} onKeyDown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
      if (event.key === 'Escape' && open) { event.preventDefault(); close(); }
    }}>
      <GraduationCap size={16} strokeWidth={1.7} aria-hidden="true" /><span className="scope-label">{selected.id ? selected.name : 'All courses'}</span><ChevronDown className="scope-chevron" size={14} strokeWidth={1.7} aria-hidden="true" />
    </button>
    {open && <div className="scope-menu">
      <div className="scope-menu-heading"><span>COURSE SCOPE</span><small>{courses.length} available to you</small></div>
      <div id={listId} role="listbox" aria-label="Allowed courses" className="scope-options">
        {items.map((course, index) => <button key={course.id || 'all'} ref={(element) => { options.current[index] = element; }} type="button" role="option" aria-selected={index === selectedIndex} className={`scope-option${index === selectedIndex ? ' is-selected' : ''}`} onClick={() => choose(course.id)} onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); move(index + 1); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); move(index - 1); }
          else if (event.key === 'Home') { event.preventDefault(); move(0); }
          else if (event.key === 'End') { event.preventDefault(); move(items.length - 1); }
          else if (event.key === 'Escape') { event.preventDefault(); close(); }
          else if (event.key === 'Tab') setOpen(false);
        }}><span className="scope-option-name">{course.name}</span>{index === selectedIndex && <Check size={15} strokeWidth={2} aria-hidden="true" />}</button>)}
      </div>
    </div>}
  </div>;
}
