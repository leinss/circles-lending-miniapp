import { useState } from 'react'

const slides = [
  {
    title: 'Welcome to Raila Lending',
    text: 'Borrow, lend, or relay loans using the Circles trust graph. Lending is uncollateralized — trust is the collateral.',
  },
  {
    title: 'How It Works',
    text: 'Enable the Raila module on your Safe, configure your lending limits and interest rates, and start lending to people you trust — or borrowing from those who trust you.',
  },
]

export function OnboardingCarousel({ onComplete }: { onComplete: () => void }) {
  const [currentSlide, setCurrentSlide] = useState(0)

  const handleNext = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1)
    } else {
      onComplete()
    }
  }

  const slide = slides[currentSlide]

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000]"
      onClick={onComplete}
    >
      <div
        className="bg-white rounded-2xl max-w-[600px] w-[90%] max-h-[90vh] overflow-y-auto p-8 shadow-[0_4px_24px_rgba(0,0,0,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center mb-6">
          <h2 className="mb-4 text-2xl">{slide.title}</h2>
          <p className="text-gray-600">{slide.text}</p>
        </div>

        <div className="flex flex-col gap-6 items-center">
          <div className="flex gap-2">
            {slides.map((_, i) => (
              <div
                key={i}
                className={`h-2 rounded-full transition-all duration-200 ${
                  i === currentSlide
                    ? 'bg-[#ff6b35] w-6'
                    : 'bg-gray-300 w-2'
                }`}
              />
            ))}
          </div>
          <button
            onClick={handleNext}
            className="bg-[#ff6b35] text-white border-none px-8 py-3 rounded-lg text-base font-semibold cursor-pointer hover:bg-[#ff5722] transition-colors whitespace-nowrap"
          >
            {currentSlide < slides.length - 1 ? 'Next' : 'Get Started'}
          </button>
        </div>
      </div>
    </div>
  )
}
