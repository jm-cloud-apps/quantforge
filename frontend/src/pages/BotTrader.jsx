export default function BotTrader() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">
          Bot Trader
        </h1>
        <p className="text-surface-400 text-[13px] mt-1">
          Run and monitor your automated trading bot.
        </p>
      </div>

      <div className="rounded-[16px] bg-surface-900 border border-surface-700/50 border-dashed p-16 text-center">
        <div className="w-12 h-12 rounded-full bg-surface-800/80 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="text-surface-300 text-[15px] font-medium">Coming Soon</p>
        <p className="text-surface-500 text-[13px] mt-1">
          You'll be able to run and control your trading bot from here.
        </p>
      </div>
    </div>
  )
}
