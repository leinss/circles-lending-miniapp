import { OnboardingCarousel } from './OnboardingCarousel.tsx'

interface HelpModalProps {
  isOpen: boolean
  onClose: () => void
}

export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  if (!isOpen) return null

  return <OnboardingCarousel onComplete={onClose} />
}

export function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="w-10 h-10 rounded-full bg-[#ff6b35] text-white text-xl font-bold border-none cursor-pointer hover:bg-[#ff5722] transition-colors shadow"
      onClick={onClick}
      title="Help"
    >
      ?
    </button>
  )
}
