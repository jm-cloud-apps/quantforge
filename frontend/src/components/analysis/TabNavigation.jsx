import { useRef, useState, useEffect, useCallback } from 'react';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'edge', label: 'Edge' },
  { id: 'performance', label: 'Performance' },
  { id: 'risk', label: 'Risk' },
  { id: 'timing', label: 'Timing' },
  { id: 'behavior', label: 'Behavior' },
];

export default function TabNavigation({ activeTab, onChange }) {
  const containerRef = useRef(null);
  const tabRefs = useRef({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  // Measure and position the sliding indicator
  const updateIndicator = useCallback(() => {
    const activeEl = tabRefs.current[activeTab];
    const container = containerRef.current;
    if (activeEl && container) {
      const containerRect = container.getBoundingClientRect();
      const tabRect = activeEl.getBoundingClientRect();
      setIndicator({
        left: tabRect.left - containerRect.left,
        width: tabRect.width,
      });
    }
  }, [activeTab]);

  useEffect(() => {
    updateIndicator();
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [updateIndicator]);

  // Keyboard shortcuts: Cmd+1-5 to switch tabs
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '5') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (TABS[idx]) onChange(TABS[idx].id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onChange]);

  return (
    <div
      ref={containerRef}
      className="relative flex items-center p-1 rounded-xl bg-surface-900/80 border border-surface-700/50 w-fit"
      role="tablist"
    >
      {/* Sliding indicator */}
      <div
        className="absolute top-1 h-[calc(100%-8px)] rounded-lg bg-accent/15 border border-accent/20 shadow-sm transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ left: indicator.left, width: indicator.width }}
        aria-hidden="true"
      />

      {TABS.map((tab) => (
        <button
          key={tab.id}
          ref={(el) => { tabRefs.current[tab.id] = el; }}
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onChange(tab.id)}
          className={`
            relative z-10 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors duration-200
            ${activeTab === tab.id
              ? 'text-accent'
              : 'text-surface-400 hover:text-surface-200'
            }
          `}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
