import { useState, useRef, useEffect } from 'react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { UserLoyaltyStatus } from '../../services/loyaltyService';
import PointsAndTierCard from './PointsAndTierCard';
import TransactionList from './TransactionList';
import { PointsTransaction } from '../../services/loyaltyService';

interface LoyaltyCarouselProps {
  loyaltyStatus: UserLoyaltyStatus;
  transactions: PointsTransaction[];
}

export default function LoyaltyCarousel({ loyaltyStatus, transactions }: LoyaltyCarouselProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [touchStart, setTouchStart] = useState(0);
  const [touchEnd, setTouchEnd] = useState(0);
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  const pointsCardRef = useRef<HTMLDivElement>(null);

  // Measure the PointsAndTierCard height
  useEffect(() => {
    if (pointsCardRef.current) {
      const height = pointsCardRef.current.offsetHeight;
      setCardHeight(height);
    }
  }, [loyaltyStatus]);

  const slides = [
    {
      id: 'points-tier',
      component: (
        <div ref={pointsCardRef}>
          <PointsAndTierCard loyaltyStatus={loyaltyStatus} />
        </div>
      )
    },
    {
      id: 'transactions',
      component: <TransactionList transactions={transactions} isLoading={false} />
    }
  ];

  const totalSlides = slides.length;

  // Minimum swipe distance (in px) to trigger slide change
  const minSwipeDistance = 50;

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(0); // Reset to detect new swipe
    setTouchStart(e.targetTouches[0]?.clientX ?? 0);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0]?.clientX ?? 0);
  };

  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) {
      return;
    }

    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && currentSlide < totalSlides - 1) {
      setCurrentSlide(currentSlide + 1);
    }

    if (isRightSwipe && currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
    }
  };

  const goToSlide = (index: number) => {
    setCurrentSlide(index);
  };

  const goToPrevious = () => {
    setCurrentSlide((prev) => (prev > 0 ? prev - 1 : prev));
  };

  const goToNext = () => {
    setCurrentSlide((prev) => (prev < totalSlides - 1 ? prev + 1 : prev));
  };

  return (
    <div className="relative">
      {/* Carousel Container */}
      <div
        className="overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={cardHeight ? { height: `${cardHeight}px` } : undefined}
      >
        <div
          className="flex transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${currentSlide * 100}%)`, height: '100%' }}
        >
          {slides.map((slide) => (
            <div
              key={slide.id}
              className="w-full flex-shrink-0 h-full"
              style={{ minWidth: '100%' }}
            >
              {slide.component}
            </div>
          ))}
        </div>
      </div>

      {/* Navigation Buttons - Hidden on mobile, shown on desktop */}
      <button
        onClick={goToPrevious}
        disabled={currentSlide === 0}
        className={`hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-10
          items-center justify-center w-10 h-10 rounded-full bg-white shadow-lg
          ${currentSlide === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}`}
        aria-label="Previous slide"
      >
        <FiChevronLeft className="w-6 h-6 text-gray-600" />
      </button>

      <button
        onClick={goToNext}
        disabled={currentSlide === totalSlides - 1}
        className={`hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10
          items-center justify-center w-10 h-10 rounded-full bg-white shadow-lg
          ${currentSlide === totalSlides - 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}`}
        aria-label="Next slide"
      >
        <FiChevronRight className="w-6 h-6 text-gray-600" />
      </button>

      {/* Pagination Dots */}
      <div className="flex justify-center items-center space-x-2 mt-6">
        {slides.map((slide, index) => (
          <button
            key={slide.id}
            onClick={() => goToSlide(index)}
            className={`transition-all duration-300 rounded-full
              ${currentSlide === index
                ? 'w-8 h-2 bg-primary-600'
                : 'w-2 h-2 bg-gray-300 hover:bg-gray-400'
              }`}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>

      {/* Slide Counter - Mobile only */}
      <div className="md:hidden text-center mt-2 text-sm text-gray-600">
        {currentSlide + 1} / {totalSlides}
      </div>
    </div>
  );
}
