export default function PageLoader() {
  return (
    <div className="flex items-center justify-center w-full min-h-[60vh]">
      <div className="relative flex items-center justify-center">

        {/* Outer slow ring */}
        <div className="absolute w-20 h-20 rounded-full border-2 border-violet-500/20 border-t-violet-400/60 animate-spin"
          style={{ animationDuration: '2s' }} />

        {/* Middle ring */}
        <div className="absolute w-14 h-14 rounded-full border-2 border-indigo-500/20 border-t-indigo-400 animate-spin"
          style={{ animationDuration: '1s' }} />

        {/* Inner fast ring */}
        <div className="absolute w-8 h-8 rounded-full border-2 border-purple-400/30 border-b-purple-300 animate-spin"
          style={{ animationDuration: '0.6s', animationDirection: 'reverse' }} />

        {/* Centre dot */}
        <div className="w-2 h-2 rounded-full bg-violet-300 shadow-[0_0_8px_2px_rgba(167,139,250,0.6)]" />
      </div>
    </div>
  )
}
