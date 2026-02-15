const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'performance', label: 'Performance' },
  { id: 'risk', label: 'Risk' },
  { id: 'timing', label: 'Timing' },
  { id: 'behavior', label: 'Behavior' },
];

export default function TabNavigation({ activeTab, onChange }) {
  return (
    <div className="flex items-center p-1 rounded-xl bg-surface-900/80 border border-surface-700/50 w-fit">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`
            px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200
            ${activeTab === tab.id
              ? 'bg-accent/15 text-accent shadow-sm border border-accent/20'
              : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/50 border border-transparent'
            }
          `}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
