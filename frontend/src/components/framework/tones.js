// Shared tone system for the Rules-page framework panels. One literal map
// (Tailwind JIT needs literal class strings) that every panel used to copy —
// tone keys are semantic (good/info/warn/bad/purple), and each entry carries
// the full set of class fragments a card / chip / ladder row needs, plus the
// raw hex for SVG scene accents.

export const TONE = {
  good: { text: 'text-accent', border: 'border-accent/40', bgSoft: 'bg-accent/[0.04]', bar: 'bg-accent', chip: 'bg-accent/10 text-accent border-accent/30', hex: '#10B981' },
  info: { text: 'text-cyan', border: 'border-cyan/40', bgSoft: 'bg-cyan/[0.04]', bar: 'bg-cyan', chip: 'bg-cyan/10 text-cyan border-cyan/30', hex: '#06B6D4' },
  warn: { text: 'text-warning', border: 'border-warning/40', bgSoft: 'bg-warning/[0.05]', bar: 'bg-warning', chip: 'bg-warning/10 text-warning border-warning/30', hex: '#F59E0B' },
  bad: { text: 'text-danger', border: 'border-danger/40', bgSoft: 'bg-danger/[0.05]', bar: 'bg-danger', chip: 'bg-danger/10 text-danger border-danger/30', hex: '#EF4444' },
  purple: { text: 'text-purple', border: 'border-purple/40', bgSoft: 'bg-purple/[0.04]', bar: 'bg-purple', chip: 'bg-purple/10 text-purple border-purple/30', hex: '#8B5CF6' },
}

export const SIGNAL_LABEL = { confirm: 'CONFIRM', caution: 'CAUTION', context: 'CONTEXT' }
