import React from 'react';
import { format, parseISO, isAfter, isBefore, addMonths, isSameDay } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { calculateTotalWeeksDecimal, formatDateForDisplay, normalizeToUTCDate, calculateTotalNights, calculateDurationDiscountWeeks, isWeekSelectable, calculateDisplayWeeks, formatWeeksForDisplay, calculateAndFormatDisplayWeeks, calculateTotalDays } from '../utils/dates';
import { getSeasonBreakdown, getDurationDiscount, calculateWeeklyAccommodationPrice } from '../utils/pricing';
import { bookingService } from '../services/BookingService';
import { motion, AnimatePresence } from 'framer-motion';
import { ExternalLink, X, Info, Tag, ChevronLeft, ChevronRight, BedDouble } from 'lucide-react';
import { useSession } from '../hooks/useSession';
import type { Booking, Accommodation } from '../types';
import type { AppliedDiscount } from './BookingSummary/BookingSummary.types';
import type { Week } from '../types/calendar';
import { useWeeklyAccommodations } from '../hooks/useWeeklyAccommodations';
import { WeekSelector } from './WeekSelector';
import { useCalendar } from '../hooks/useCalendar';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

import { StripeCheckoutForm } from './StripeCheckoutForm';
import { supabase } from '../lib/supabase';
import * as Tooltip from '@radix-ui/react-tooltip';
import { calculateBaseFoodCost } from './BookingSummary/BookingSummary.utils';
import { OptimizedSlider } from './shared/OptimizedSlider';
import { useCredits } from '../hooks/useCredits';
import { CreditsSection } from './BookingSummary/components/CreditsSection';
import { formatPriceDisplay } from './BookingSummary/BookingSummary.utils';
import { MasonryGallery } from './shared/MasonryGallery';

// Extend Stay is retired for 2026: the booking-open gate locks post-purchase
// price/date rewrites (the permissive bookings UPDATE policy it relied on was
// dropped in 20260610_booking_open_gate.sql). UI hidden, service code kept.
const EXTEND_STAY_ENABLED = false;

// Interface for accommodation images
interface AccommodationImage {
  id: string;
  accommodation_id: string;
  image_url: string;
  display_order: number;
  is_primary: boolean;
  created_at: string;
}

// Extend accommodation type to include images
interface ExtendedAccommodation extends Accommodation {
  images?: AccommodationImage[];
}

// Helper function to get all images sorted by display order
const getAllImages = (accommodation: ExtendedAccommodation): AccommodationImage[] => {
  if (!accommodation.images || accommodation.images.length === 0) {
    // Fallback: if no images array but has image_url, create a single image entry
    if (accommodation.image_url) {
      return [{
        id: `${accommodation.id}-primary`,
        accommodation_id: accommodation.id,
        image_url: accommodation.image_url,
        display_order: 0,
        is_primary: true,
        created_at: new Date().toISOString()
      }];
    }
    return [];
  }
  return [...accommodation.images].sort((a, b) => a.display_order - b.display_order);
};

// Image Gallery Component
const ImageGallery: React.FC<{ 
  accommodation: ExtendedAccommodation;
  currentImageIndices: Record<string, number>;
  setCurrentImageIndices: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  onImageClick?: (imageUrl: string) => void;
}> = ({ accommodation, currentImageIndices, setCurrentImageIndices, onImageClick }) => {
  const allImages = getAllImages(accommodation);
  const currentIndex = currentImageIndices[accommodation.id] || 0;
  
  // Helper function to get current image
  const getCurrentImage = (): string | null => {
    if (allImages.length === 0) return null;
    const validIndex = Math.min(currentIndex, allImages.length - 1);
    return allImages[validIndex]?.image_url || null;
  };
  
  const currentImageUrl = getCurrentImage();

  if (allImages.length === 0) {
    return (
      <div className="w-32 h-32 flex items-center justify-center text-secondary bg-surface/50 rounded-lg">
        <BedDouble size={32} />
      </div>
    );
  }

  const handlePrevious = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentImageIndices(prev => {
      const currentIdx = prev[accommodation.id] || 0;
      const newIndex = currentIdx === 0 ? allImages.length - 1 : currentIdx - 1;
      return {
        ...prev,
        [accommodation.id]: newIndex
      };
    });
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentImageIndices(prev => {
      const currentIdx = prev[accommodation.id] || 0;
      const newIndex = (currentIdx + 1) % allImages.length;
      return {
        ...prev,
        [accommodation.id]: newIndex
      };
    });
  };

  const handleDotClick = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setCurrentImageIndices(prev => ({
      ...prev,
      [accommodation.id]: index
    }));
  };

  return (
    <div className="relative w-32 h-32 group/gallery">
      {/* Main Image */}
      <button
        onClick={() => onImageClick?.(currentImageUrl || '')}
        className="w-full h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 rounded-lg transition-opacity hover:opacity-80"
      >
        <img 
          src={currentImageUrl || ''} 
          alt={`${accommodation.title} ${currentIndex + 1}`} 
          className="w-full h-full object-cover rounded-lg cursor-pointer"
          loading="lazy"
        />
      </button>

      {/* Navigation arrows - show on hover when more than 1 image */}
      {allImages.length > 1 && (
        <>
          <button
            onClick={handlePrevious}
            className="absolute left-1 top-1/2 transform -translate-y-1/2 bg-black/80 hover:bg-black/90 text-white rounded-md p-0.5 transition-all duration-200 hover:scale-110 shadow-lg z-20 opacity-0 group-hover/gallery:opacity-100"
            aria-label="Previous image"
          >
            <ChevronLeft size={12} />
          </button>
          <button
            onClick={handleNext}
            className="absolute right-1 top-1/2 transform -translate-y-1/2 bg-black/80 hover:bg-black/90 text-white rounded-md p-0.5 transition-all duration-200 hover:scale-110 shadow-lg z-20 opacity-0 group-hover/gallery:opacity-100"
            aria-label="Next image"
          >
            <ChevronRight size={12} />
          </button>
        </>
      )}

      {/* Dots indicator - only show if more than 1 image */}
      {allImages.length > 1 && (
        <div className="absolute bottom-1 left-1/2 transform -translate-x-1/2 flex space-x-0.5 z-10">
          {allImages.map((_, index) => (
            <button
              key={index}
              onClick={(e) => handleDotClick(e, index)}
              className={clsx(
                "w-1.5 h-1.5 rounded-full transition-all duration-200 border border-white/30",
                index === currentIndex 
                  ? "bg-white shadow-sm scale-110" 
                  : "bg-white/30 hover:bg-white/60 hover:scale-105"
              )}
              aria-label={`Go to image ${index + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export function MyBookings() {
  const navigate = useNavigate();
  const [bookings, setBookings] = React.useState<Booking[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [currentImageIndices, setCurrentImageIndices] = React.useState<Record<string, number>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [enlargedImageUrl, setEnlargedImageUrl] = React.useState<string | null>(null);
  const [enlargedAccommodation, setEnlargedAccommodation] = React.useState<ExtendedAccommodation | null>(null);
  const [originalCheckOut, setOriginalCheckOut] = React.useState<Date | null>(null);
  const [extendingBooking, setExtendingBooking] = React.useState<Booking | null>(null);
  const [extensionWeeks, setExtensionWeeks] = React.useState<any[]>([]);
  
  // Masonry gallery state
  const [galleryOpen, setGalleryOpen] = React.useState(false);
  const [galleryImages, setGalleryImages] = React.useState<AccommodationImage[]>([]);
  const [galleryTitle, setGalleryTitle] = React.useState<string>('');

  const [showPaymentModal, setShowPaymentModal] = React.useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = React.useState(false);
  const [showDiscountModal, setShowDiscountModal] = React.useState(false);
  const [authToken, setAuthToken] = React.useState('');
  const [foodContribution, setFoodContribution] = React.useState<number | null>(null);
  const [displayFoodContribution, setDisplayFoodContribution] = React.useState<number | null>(null);
  const isDraggingSliderRef = React.useRef(false);
  const [showCustomWeeks, setShowCustomWeeks] = React.useState(false);
  const [extensionError, setExtensionError] = React.useState<string | null>(null);
  const MAX_WEEKS_ALLOWED = 12;
  const session = useSession();
  useWeeklyAccommodations();

  // Credits functionality for extensions
  const { credits: availableCredits, loading: creditsLoading, refresh: refreshCredits } = useCredits();
  const [creditsEnabled, setCreditsEnabled] = React.useState(false);
  const [creditsToUse, setCreditsToUse] = React.useState(0);
  const [userHasMadeCreditsChoice, setUserHasMadeCreditsChoice] = React.useState(false);

  // Discount code functionality for extensions
  // No discount codes needed anymore
  const appliedDiscount = null; // No discounts in simplified version

  // Credits functionality for extensions - allows users to use their available credits
  // to reduce the amount they need to pay for their booking extension

  // Derive checkIn and checkOut from the extending booking if available
  const checkIn = extendingBooking 
    ? (typeof extendingBooking.check_in === 'string' 
        ? normalizeToUTCDate(extendingBooking.check_in) 
        : extendingBooking.check_in)
    : new Date();
    
  const checkOut = extendingBooking
    ? (typeof extendingBooking.check_out === 'string' 
        ? normalizeToUTCDate(extendingBooking.check_out) 
        : extendingBooking.check_out)
    : addMonths(new Date(), 1);

  const calendar = useCalendar({
    startDate: checkIn,
    endDate: addMonths(checkOut, 6),
    isAdminMode: false
  });
  const extensionWeeksData = calendar.weeks;
  const extensionWeeksLoading = calendar.isLoading;

  React.useEffect(() => {
    console.log('[MyBookings] Component mounted, loading bookings...');
    loadBookings();
  }, []);

  // Get auth token for payment
  React.useEffect(() => {
    supabase.auth.getSession().then(res => {
      const token = res?.data?.session?.access_token;
      if (token) {
        setAuthToken(token);
      }
    });
  }, []);






  const loadBookings = async () => {
    try {
      setLoading(true);
      const data = await bookingService.getUserBookings();
      console.log('[DEBUG] Raw booking data:', data);
      setBookings(data || []);
    } catch (err) {
      console.error('Error loading bookings:', err);
      setError(err instanceof Error ? err.message : 'Failed to load bookings');
    } finally {
      setLoading(false);
    }
  };

  const handleExtensionWeekSelect = (week: any) => {
    if (!originalCheckOut) return;
    if (isAfter(week.startDate, originalCheckOut)) {
      setExtensionWeeks(prev => {
        if (!prev.some(w => w.startDate.getTime() === week.startDate.getTime())) {
          return [...prev, week].sort((a, b) => a.startDate - b.startDate);
        }
        return prev;
      });
    }
  };

  const handleExtensionWeeksDeselect = (weeksToDeselect: any[]) => {
    if (!originalCheckOut) return;
    setExtensionWeeks(prev => prev.filter(w => isBefore(w.startDate, originalCheckOut) || !weeksToDeselect.some(d => d.startDate.getTime() === w.startDate.getTime())));
  };

  const extensionOnlyWeeks = React.useMemo(() => {
    if (!originalCheckOut) return [];
    return extensionWeeks.filter(w => isAfter(w.startDate, originalCheckOut));
  }, [extensionWeeks, originalCheckOut]);





  // Helper to get the original booking's weeks - reconstruct directly from booking dates
  const getOriginalWeeks = () => {
    console.log('[DEBUG] getOriginalWeeks called - extendingBooking:', extendingBooking);
    if (!extendingBooking) {
      console.log('[DEBUG] getOriginalWeeks - no extendingBooking, returning empty array');
      return [];
    }
    
    const checkIn = typeof extendingBooking.check_in === 'string' ? normalizeToUTCDate(extendingBooking.check_in) : extendingBooking.check_in;
    const checkOut = typeof extendingBooking.check_out === 'string' ? normalizeToUTCDate(extendingBooking.check_out) : extendingBooking.check_out;
    
    console.log('[DEBUG] getOriginalWeeks - checkIn:', checkIn, 'checkOut:', checkOut);
    
    // Calculate original weeks directly from booking dates instead of relying on calendar data
    // This ensures we get the correct count even if the original booking is in the past
    const tempWeek = { startDate: checkIn, endDate: checkOut, status: 'default' as const };
    const totalNights = calculateTotalNights([tempWeek]);
    const originalWeeksDecimal = totalNights / 7;
    const originalWeeksCount = Math.ceil(originalWeeksDecimal); // Use ceil for pricing calculations to ensure we don't undercharge
    
    // Create mock week objects for duration discount calculation
    // We only need the count and date range for pricing calculations
    const originalWeeks: Week[] = [];
    for (let i = 0; i < originalWeeksCount; i++) {
      const weekStart = new Date(checkIn.getTime() + (i * 7 * 24 * 60 * 60 * 1000));
      const weekEnd = new Date(weekStart.getTime() + (7 * 24 * 60 * 60 * 1000));
      originalWeeks.push({
        id: `original-week-${i}`,
        startDate: weekStart,
        endDate: weekEnd > checkOut ? checkOut : weekEnd,
        status: 'default' as const
      });
    }
    
    console.log('[DEBUG] getOriginalWeeks - calculation details:', {
      checkIn: formatDateForDisplay(checkIn),
      checkOut: formatDateForDisplay(checkOut),
      totalNights,
      originalWeeksDecimal: originalWeeksDecimal.toFixed(2),
      originalWeeksCount: originalWeeksCount,
      calculationMethod: 'Math.ceil(totalNights / 7) for pricing, but display shows decimal'
    });
    console.log('[DEBUG] getOriginalWeeks - reconstructed weeks:', {
      weekCount: originalWeeks.length,
      weeks: originalWeeks.map(w => ({
        id: w.id,
        startDate: formatDateForDisplay(w.startDate),
        endDate: formatDateForDisplay(w.endDate)
      }))
    });
    
    return originalWeeks;
  };
  const originalWeeks = getOriginalWeeks();

  // Helper function to calculate actual decimal weeks for display
  const getActualWeeks = (startDate: Date, endDate: Date) => {
    console.log('[getActualWeeks] === DEBUGGING WEEK CALCULATION ===');
    console.log('[getActualWeeks] Input dates:', {
      startDate: startDate.toISOString(),
      startDateLocal: startDate.toString(),
      endDate: endDate.toISOString(), 
      endDateLocal: endDate.toString()
    });
    
    // OLD METHOD: Manual calculation using days
    const tempWeek = { startDate, endDate, status: 'default' as const };
    const totalDays = calculateTotalDays([tempWeek]);
    const weeksDecimal = totalDays / 7;
    
    console.log('[getActualWeeks] OLD METHOD - Calculation breakdown:', {
      totalDays,
      weeksDecimal,
      weeksDecimalRounded: Math.round(weeksDecimal * 10) / 10,
      manualDaysCheck: Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
      timeDiffMs: endDate.getTime() - startDate.getTime(),
      msPerDay: 1000 * 60 * 60 * 24
    });
    
    // NEW METHOD: Using helper function with business logic
    const displayWeeks = calculateDisplayWeeks(startDate, endDate);
    
    console.log('[getActualWeeks] NEW METHOD - Using calculateDisplayWeeks:', {
      displayWeeks,
      oldMethod: weeksDecimal,
      difference: displayWeeks - weeksDecimal,
      usingNewMethod: true
    });
    
    // Let's also manually verify the date range
    console.log('[getActualWeeks] Manual date verification:', {
      startDateFormatted: formatDateForDisplay(startDate),
      endDateFormatted: formatDateForDisplay(endDate),
      startDateUTCComponents: {
        year: startDate.getUTCFullYear(),
        month: startDate.getUTCMonth() + 1, // +1 for human readable
        day: startDate.getUTCDate()
      },
      endDateUTCComponents: {
        year: endDate.getUTCFullYear(), 
        month: endDate.getUTCMonth() + 1, // +1 for human readable
        day: endDate.getUTCDate()
      }
    });
    
    return displayWeeks; // Use the new method with business logic
  };

  // Calculate actual decimal weeks for display
  const originalWeeksDecimal = extendingBooking 
    ? (() => {
        console.log('[originalWeeksDecimal] === BOOKING DATE PARSING DEBUG ===');
        console.log('[originalWeeksDecimal] Raw booking data:', {
          check_in_raw: extendingBooking.check_in,
          check_in_type: typeof extendingBooking.check_in,
          check_out_raw: extendingBooking.check_out,
          check_out_type: typeof extendingBooking.check_out
        });
        
        const checkInDate = typeof extendingBooking.check_in === 'string' 
          ? normalizeToUTCDate(extendingBooking.check_in) 
          : extendingBooking.check_in;
        const checkOutDate = typeof extendingBooking.check_out === 'string' 
          ? normalizeToUTCDate(extendingBooking.check_out) 
          : extendingBooking.check_out;
          
        console.log('[originalWeeksDecimal] Parsed dates:', {
          checkInDate: checkInDate.toISOString(),
          checkOutDate: checkOutDate.toISOString(),
          checkInFormatted: formatDateForDisplay(checkInDate),
          checkOutFormatted: formatDateForDisplay(checkOutDate)
        });
        
        return getActualWeeks(checkInDate, checkOutDate);
      })()
    : 0;

  const totalWeeksDecimal = originalWeeksDecimal + extensionOnlyWeeks.length;

  console.log('[DEBUG] originalWeeks length:', originalWeeks.length);
  console.log('[DEBUG] originalWeeks IDs:', originalWeeks.map(w => w.id));
  console.log('[DEBUG] Display weeks - original:', originalWeeksDecimal.toFixed(2), 'total:', totalWeeksDecimal.toFixed(2));

  // Fixed food contribution range - no discounts
  const foodContributionRange = React.useMemo(() => {
    if (extensionOnlyWeeks.length === 0) return null;
    // Simple fixed range without any discount calculations
    return { min: 345, max: 390, defaultValue: 367 };
  }, [extensionOnlyWeeks]);
  
  // Handle display value changes during drag
  const handleDisplayValueChange = React.useCallback((value: number) => {
    isDraggingSliderRef.current = true;
    // Ensure value is within bounds
    if (foodContributionRange) {
      const clampedValue = Math.max(foodContributionRange.min, Math.min(foodContributionRange.max, value));
      setDisplayFoodContribution(clampedValue);
    } else {
      setDisplayFoodContribution(value);
    }
    
    // Reset dragging flag shortly after (but don't reset display value)
    setTimeout(() => {
      isDraggingSliderRef.current = false;
    }, 200);
  }, [foodContributionRange]);

  // Initialize food contribution for extension using duration discount from TOTAL stay
  React.useEffect(() => {
    if (foodContributionRange) {
      // Only set to default if not already set or if current value is outside the valid range
      setFoodContribution(current => {
        const newValue = current === null || current < foodContributionRange.min || current > foodContributionRange.max
          ? foodContributionRange.defaultValue
          : current;
          
        if (newValue !== current) {
          console.log('[EXTENSION_PRICING] Food contribution reset to default:', {
            previousValue: current,
            newValue,
            reason: current === null ? 'not set' : 'outside range',
            validRange: `${foodContributionRange.min}-${foodContributionRange.max}`
          });
          // Also update display value (only if not dragging)
          if (!isDraggingSliderRef.current) {
            setDisplayFoodContribution(newValue);
        }
        } else {
        console.log('[EXTENSION_PRICING] Keeping existing food contribution:', current);
          // Sync display value (only if not dragging)
          if (!isDraggingSliderRef.current) {
            setDisplayFoodContribution(current);
          }
        }
        
        return newValue;
      });
    } else {
      setFoodContribution(null);
      setDisplayFoodContribution(null);
    }
  }, [foodContributionRange]);



  // Calculate extension pricing
  const extensionPricing = React.useMemo(() => {
    console.log('[EXTENSION_PRICING] === PRICING CALCULATION TRIGGERED ===');
    console.log('[EXTENSION_PRICING] Dependencies changed:', {
      hasExtendingBooking: !!extendingBooking,
      extensionOnlyWeeksLength: extensionOnlyWeeks.length,
      foodContribution,
      hasAppliedDiscount: !!appliedDiscount,
      creditsToUse
    });
    
    if (!extendingBooking || extensionOnlyWeeks.length === 0) {
      console.log('[EXTENSION_PRICING] No extension data, returning default pricing');
      return {
        totalWeeks: 0,
        extensionWeeks: 0,
        totalNights: 0,
        extensionNights: 0,
        weeklyAccommodationRate: 0,
        totalPrice: 0,
        extensionPrice: 0,
        accommodationBasePrice: 0,
        extensionAccommodationPrice: 0,
        extensionFoodCost: 0,
        discountAmount: 0,
        finalExtensionPrice: 0,
        finalAmountAfterCredits: 0
      };
    }

    const totalWeeks = originalWeeks.length + extensionOnlyWeeks.length;
    const extensionWeeks = extensionOnlyWeeks.length;
    const totalNights = calculateTotalNights([...originalWeeks, ...extensionOnlyWeeks]);
    const extensionNights = calculateTotalNights(extensionOnlyWeeks);
    
    // Get the accommodation's base price from database
    const accommodationBasePrice = extendingBooking.accommodation?.base_price || 0;
    const accommodationTitle = extendingBooking.accommodation?.title || '';
    
    // Calculate proper accommodation pricing using the same logic as CabinSelector
    const extensionStartDate = extensionOnlyWeeks[0]?.startDate;
    const extensionEndDate = extensionOnlyWeeks[extensionOnlyWeeks.length - 1]?.endDate;
    
    if (!extensionStartDate || !extensionEndDate) {
      return {
        totalWeeks: 0,
        extensionWeeks: 0,
        totalNights: 0,
        extensionNights: 0,
        weeklyAccommodationRate: 0,
        totalPrice: 0,
        extensionPrice: 0,
        accommodationBasePrice: 0,
        extensionAccommodationPrice: 0,
        extensionFoodCost: 0,
        discountAmount: 0,
        finalExtensionPrice: 0
      };
    }
    
    // LOG: Extension period and original booking period for seasonal breakdown sanity check
    console.log('[SEASONAL_BREAKDOWN] Extension period for seasonal breakdown:', {
      extensionStartDate: extensionStartDate?.toISOString(),
      extensionEndDate: extensionEndDate?.toISOString(),
      originalCheckIn: extendingBooking?.check_in,
      originalCheckOut: extendingBooking?.check_out,
      extensionOnlyWeeks: extensionOnlyWeeks.map(w => ({
        id: w.id,
        start: w.startDate.toISOString(),
        end: w.endDate.toISOString()
      }))
    });
    
    // Calculate seasonal discount based on EXTENSION PERIOD ONLY
    // This ensures the extension pricing reflects the seasons of the extension period
    const seasonBreakdown = getSeasonBreakdown(extensionStartDate, extensionEndDate);
    const averageSeasonalDiscount = seasonBreakdown.seasons.reduce((sum, season) => 
      sum + (season.discount * season.nights), 0) / 
      seasonBreakdown.seasons.reduce((sum, season) => sum + season.nights, 0);
    
    // Round seasonal discount for consistency with BookingSummary
    const roundedAverageSeasonalDiscount = Math.round(averageSeasonalDiscount * 100) / 100;
    
    // CRITICAL FIX: Dorms don't get seasonal discounts
    const effectiveSeasonalDiscount = accommodationTitle.toLowerCase().includes('dorm') 
      ? 0 
      : roundedAverageSeasonalDiscount;
    
    // LOG: Seasonal breakdown result
    console.log('[SEASONAL_BREAKDOWN] getSeasonBreakdown result:', {
      seasonBreakdown,
      averageSeasonalDiscount,
      roundedAverageSeasonalDiscount,
      effectiveSeasonalDiscount,
      isDorm: accommodationTitle.toLowerCase().includes('dorm')
    });
    
    // Calculate duration discount based on TOTAL stay (original + extension)
    const combinedWeeksForDiscount = [...originalWeeks, ...extensionOnlyWeeks];
    console.log('[EXTENSION_PRICING] Combined weeks array for discount calculation:', {
      originalCount: originalWeeks.length,
      extensionCount: extensionOnlyWeeks.length,
      combinedCount: combinedWeeksForDiscount.length,
      combinedWeeks: combinedWeeksForDiscount.map(w => ({
        id: w.id,
        start: formatDateForDisplay(w.startDate),
        end: formatDateForDisplay(w.endDate)
      }))
    });
    
    const totalNightsForDiscount = calculateTotalNights(combinedWeeksForDiscount);
    const completeWeeksForDiscount = calculateDurationDiscountWeeks(combinedWeeksForDiscount);
    
    console.log('[EXTENSION_PRICING] Duration discount calculation inputs:', {
      totalNightsForDiscount,
      completeWeeksForDiscount,
      calculationNote: 'completeWeeksForDiscount = calculateDurationDiscountWeeks(combinedWeeks)'
    });
    
    const durationDiscountPercent = getDurationDiscount(completeWeeksForDiscount);
    
    console.log('[EXTENSION_PRICING] Duration discount calculation result:', {
      inputWeeks: completeWeeksForDiscount,
      outputPercent: durationDiscountPercent,
      outputPercentFormatted: (durationDiscountPercent * 100).toFixed(1) + '%'
    });
    
    // Calculate weekly accommodation rate using same logic as CabinSelector
    const mockAccommodation = {
      base_price: accommodationBasePrice,
      title: accommodationTitle
    } as Accommodation;
    
    // Use the rounded (and dorm-checked) effectiveSeasonalDiscount for all calculations
    const weeklyAccommodationRate = calculateWeeklyAccommodationPrice(
      mockAccommodation,
      [...originalWeeks, ...extensionOnlyWeeks],
      effectiveSeasonalDiscount // <-- always rounded
    );
    
    // Calculate extension accommodation cost
    const extensionAccommodationPrice = weeklyAccommodationRate * extensionWeeks;
    
    // Calculate food and facilities cost for extension
    const { totalBaseFoodCost: extensionFoodCost } = calculateBaseFoodCost(
      extensionNights,
      extensionWeeks,
      foodContribution
    );
    
    // Calculate subtotal before discount codes
    const subtotalBeforeDiscount = extensionAccommodationPrice + extensionFoodCost;
    
            // No discount codes in simplified version
        let discountAmount = 0;
    
    // Calculate final extension price after discount (use precise discount amount)
    const finalExtensionPrice = Math.max(0, subtotalBeforeDiscount - discountAmount);
    
    // Calculate final amount after credits
    const finalAmountAfterCredits = Math.max(0, finalExtensionPrice - creditsToUse);

    console.log('[EXTENSION_PRICING] ===== DETAILED PRICING CALCULATION =====');
    console.log('[EXTENSION_PRICING] Original booking weeks:', {
      count: originalWeeks.length,
      weeks: originalWeeks.map(w => ({
        id: w.id,
        start: formatDateForDisplay(w.startDate),
        end: formatDateForDisplay(w.endDate)
      }))
    });
    console.log('[EXTENSION_PRICING] Extension weeks:', {
      count: extensionOnlyWeeks.length,
      weeks: extensionOnlyWeeks.map(w => ({
        id: w.id,
        start: formatDateForDisplay(w.startDate),
        end: formatDateForDisplay(w.endDate)
      }))
    });
    console.log('[EXTENSION_PRICING] Combined weeks for discount calculation:', {
      totalWeeksCount: originalWeeks.length + extensionOnlyWeeks.length,
      totalNightsForDiscount,
      completeWeeksForDiscount,
      durationDiscountPercent: (durationDiscountPercent * 100).toFixed(1) + '%',
      note: 'Duration discount is calculated based on TOTAL stay (original + extension), but seasonal discount is based on extension period only'
    });
    console.log('[EXTENSION_PRICING] Accommodation pricing breakdown:', {
      accommodationBasePrice,
      accommodationTitle,
      extensionPeriod: `${formatDateForDisplay(extensionStartDate)} to ${formatDateForDisplay(extensionEndDate)}`,
      calculatedSeasonalDiscount: (averageSeasonalDiscount * 100).toFixed(1) + '%',
      effectiveSeasonalDiscount: (effectiveSeasonalDiscount * 100).toFixed(1) + '%',
      isDorm: accommodationTitle.toLowerCase().includes('dorm'),
      weeklyAccommodationRate: `€${weeklyAccommodationRate} (base: €${accommodationBasePrice} * (1 - ${(effectiveSeasonalDiscount * 100).toFixed(1)}%) * (1 - ${(durationDiscountPercent * 100).toFixed(1)}%))`,
      extensionWeeks,
      extensionAccommodationPrice: `€${extensionAccommodationPrice} (€${weeklyAccommodationRate} * ${extensionWeeks})`
    });
    console.log('[EXTENSION_PRICING] Final pricing summary:', {
      extensionAccommodationPrice,
      extensionFoodCost,
      subtotalBeforeDiscount,
      discountAmount,
      finalExtensionPrice,
      creditsToUse,
      finalAmountAfterCredits
    });
    console.log('[EXTENSION_PRICING] ===== END CALCULATION =====');

    return {
      totalWeeks,
      extensionWeeks,
      totalNights,
      extensionNights,
      weeklyAccommodationRate,
      totalPrice: 0, // Not needed for extensions
      extensionPrice: subtotalBeforeDiscount, // Keep original for display
      accommodationBasePrice,
      extensionAccommodationPrice,
      extensionAccommodationOriginalPrice: accommodationBasePrice * extensionWeeks, // Original price before discounts - passed directly to avoid reverse calculations
      extensionFoodCost,
      discountAmount,
      finalExtensionPrice,
      finalAmountAfterCredits,
      averageSeasonalDiscount: effectiveSeasonalDiscount
    };
  }, [extendingBooking, originalWeeks, extensionOnlyWeeks, foodContribution, appliedDiscount, creditsToUse]);

  // Initialize credits to max available when extension pricing is calculated
  // BUT ONLY if credits are currently enabled or haven't been manually set
  React.useEffect(() => {
    console.log('[EXTENSION_PRICING] === CREDITS INITIALIZATION EFFECT TRIGGERED ===');
    console.log('[EXTENSION_PRICING] Effect dependencies changed:', {
      extendingBooking: !!extendingBooking,
      extensionOnlyWeeksLength: extensionOnlyWeeks.length,
      availableCredits,
      creditsLoading,
      finalExtensionPrice: extensionPricing.finalExtensionPrice,
      creditsEnabled,
      creditsToUse
    });
    
    if (extendingBooking && extensionOnlyWeeks.length > 0 && !creditsLoading && availableCredits > 0) {
      const maxCreditsToUse = Math.min(availableCredits, extensionPricing.finalExtensionPrice);
      
      console.log('[EXTENSION_PRICING] Conditions met for credit initialization:', {
        maxCreditsToUse,
        availableCredits,
        finalExtensionPrice: extensionPricing.finalExtensionPrice
      });
      
              if (maxCreditsToUse > 0) {
          // Only auto-set credits if they're currently enabled OR if user hasn't made a choice yet
          if (creditsEnabled || !userHasMadeCreditsChoice) {
            console.log('[EXTENSION_PRICING] ✅ Setting credits to max by default:', {
              availableCredits,
              finalExtensionPrice: extensionPricing.finalExtensionPrice,
              maxCreditsToUse,
              creditsEnabled,
              currentCreditsToUse: creditsToUse,
              userHasMadeCreditsChoice,
              reason: creditsEnabled ? 'credits are enabled' : 'first time (userHasMadeCreditsChoice === false)'
            });
            setCreditsEnabled(true);
            setCreditsToUse(maxCreditsToUse);
          } else {
            console.log('[EXTENSION_PRICING] ❌ Skipping auto-credit setting - user has made a choice:', {
              creditsEnabled,
              creditsToUse,
              maxCreditsToUse,
              userHasMadeCreditsChoice,
              reason: 'user explicitly made a choice about credits'
            });
          }
      } else {
        console.log('[EXTENSION_PRICING] No credits to set - maxCreditsToUse <= 0');
      }
    } else {
      console.log('[EXTENSION_PRICING] Conditions not met for credit initialization:', {
        hasExtendingBooking: !!extendingBooking,
        extensionOnlyWeeksLength: extensionOnlyWeeks.length,
        creditsLoading,
        availableCredits
      });
    }
  }, [extendingBooking, extensionOnlyWeeks.length, availableCredits, creditsLoading, extensionPricing.finalExtensionPrice, creditsEnabled, userHasMadeCreditsChoice]); // REMOVED creditsToUse from dependencies



  const handleExtensionPaymentSuccess = React.useCallback(async (paymentIntentId?: string) => {
    console.log('[EXTENSION_FLOW] === STEP 3: Extension payment success handler called ===');
    console.log('[EXTENSION_FLOW] Payment Intent ID:', paymentIntentId || 'N/A');
    console.log('[EXTENSION_FLOW] Extension payment details:', {
      paymentIntentId,
      creditsToUse,
      finalAmountAfterCredits: extensionPricing.finalAmountAfterCredits,
      originalExtensionPrice: extensionPricing.finalExtensionPrice,
      creditsEnabled,
      availableCredits,
      extendingBookingId: extendingBooking?.id,
      extensionWeeksCount: extensionOnlyWeeks.length
    });

    setIsProcessingPayment(true);
    
    try {
      if (!extendingBooking || extensionOnlyWeeks.length === 0) {
        throw new Error('Missing extension data');
      }

      // Calculate new check-out date
      const newCheckOut = extensionOnlyWeeks[extensionOnlyWeeks.length - 1].endDate;
      const formattedCheckOut = format(newCheckOut, 'yyyy-MM-dd');

      const extensionPayload = {
        bookingId: extendingBooking.id,
        newCheckOut: formattedCheckOut,
        extensionWeeks: extensionOnlyWeeks.length,
        extensionPrice: extensionPricing.finalExtensionPrice, // Full value for booking total
        paymentAmount: extensionPricing.finalAmountAfterCredits, // Amount paid after credits
        paymentIntentId: paymentIntentId || '',
        appliedDiscountCode: appliedDiscount?.code,
        discountCodePercent: appliedDiscount?.percentage_discount ? appliedDiscount.percentage_discount / 100 : undefined, // Store as decimal (0.5 for 50%)
        discountCodeAppliesTo: appliedDiscount?.applies_to,
        discountAmount: extensionPricing.discountAmount,
        discountCodeAmount: extensionPricing.discountAmount, // FIXED: Pass exact discount code amount
        accommodationPrice: extensionPricing.extensionAccommodationPrice,
        accommodationOriginalPrice: extensionPricing.extensionAccommodationOriginalPrice, // Original price before discounts - no more reverse calculations!
        foodContribution: extensionPricing.extensionFoodCost,
        creditsUsed: creditsToUse || 0, // NEW: Pass credits used
        seasonalDiscountPercent: (() => {
          // Calculate seasonal discount for EXTENSION PERIOD ONLY (for payment breakdown)
          if (extensionOnlyWeeks.length === 0) return 0;
          const extensionStartDate = extensionOnlyWeeks[0]?.startDate;
          const extensionEndDate = extensionOnlyWeeks[extensionOnlyWeeks.length - 1]?.endDate;
          if (!extensionStartDate || !extensionEndDate) return 0;
          
          // CRITICAL FIX: Dorms don't get seasonal discounts
          if (extendingBooking.accommodation?.title?.toLowerCase().includes('dorm')) {
            return 0;
          }
          
          const extensionSeasonBreakdown = getSeasonBreakdown(extensionStartDate, extensionEndDate);
          if (extensionSeasonBreakdown.seasons.length === 0) return 0;
          
          const extensionAvgDiscount = extensionSeasonBreakdown.seasons.reduce((sum, season) => 
            sum + (season.discount * season.nights), 0) / 
            extensionSeasonBreakdown.seasons.reduce((sum, season) => sum + season.nights, 0);
          
          // Always round to two decimals for storage and display
          return Math.round(extensionAvgDiscount * 100) / 100;
        })(),
        durationDiscountPercent: (() => {
          // Calculate duration discount for TOTAL STAY (original + extension) for payment breakdown
          const totalWeeksAfterExtension = originalWeeksDecimal + extensionOnlyWeeks.length;
          const durationDiscount = getDurationDiscount(totalWeeksAfterExtension);
          return durationDiscount; // Return as decimal (0.16 for 16%)
        })()
      };

      console.log('[EXTENSION_FLOW] === STEP 4: Calling BookingService.extendBooking ===');
      console.log('[EXTENSION_FLOW] EXTENSION PAYLOAD:', JSON.stringify(extensionPayload, null, 2));
      
      // Call the extension booking service
      const result = await bookingService.extendBooking(extensionPayload);
      
      console.log('[EXTENSION_FLOW] STEP 4 SUCCESS: BookingService.extendBooking completed');
      console.log('[EXTENSION_FLOW] Extension result:', result);

      console.log('[EXTENSION_FLOW] === STEP 5: Cleaning up extension UI state ===');
      setShowPaymentModal(false);
      setExtendingBooking(null);
      setExtensionWeeks([]);
      setShowCustomWeeks(false);
      setExtensionError(null);
      setCreditsEnabled(false);
      setCreditsToUse(0);
      setUserHasMadeCreditsChoice(false);
      handleRemoveDiscount();
      
      console.log('[EXTENSION_FLOW] === STEP 6: Refreshing bookings and credits data ===');
      await Promise.all([
        loadBookings(),
        refreshCredits()
      ]);
      
      console.log('[EXTENSION_FLOW] STEP 6 SUCCESS: Extension process completed successfully');
    } catch (err) {
      console.error('[EXTENSION_FLOW] === STEP 4 FAILED: Extension process failed ===');
      console.error('[EXTENSION_FLOW] Error details:', {
        error: err,
        creditsToUse,
        creditsEnabled,
        extensionPrice: extensionPricing.finalExtensionPrice,
        paymentAmount: extensionPricing.finalAmountAfterCredits
      });
      setExtensionError(err instanceof Error ? err.message : 'Extension failed');
      setShowPaymentModal(false);
    } finally {
      setIsProcessingPayment(false);
    }
  }, [extendingBooking, originalWeeksDecimal, extensionOnlyWeeks, foodContribution, appliedDiscount, creditsToUse, extensionPricing, creditsEnabled, availableCredits, refreshCredits]);

  const handleConfirmExtension = () => {
    console.log('[EXTENSION_FLOW] === STEP 1: Extension confirm button clicked ===');
    if (extensionOnlyWeeks.length === 0) {
      console.warn('[EXTENSION_FLOW] STEP 1 FAILED: No weeks selected for extension');
      setExtensionError('Please select weeks to extend');
      return;
    }

    const finalAmountAfterCredits = extensionPricing.finalAmountAfterCredits || 0;
    
    console.log('[EXTENSION_FLOW] STEP 1 SUCCESS: Extension details validated');
    console.log('[EXTENSION_FLOW] Extension pricing breakdown:', {
      finalAmountAfterCredits,
      originalPrice: extensionPricing.finalExtensionPrice,
      creditsUsed: creditsToUse,
      creditsEnabled,
      availableCredits,
      isCreditsOnlyTransaction: finalAmountAfterCredits < 0.5,
      extensionWeeks: extensionOnlyWeeks.length,
      bookingId: extendingBooking?.id
    });

    // If the amount after credits is very small (less than $0.50), treat as credits-only transaction
    if (finalAmountAfterCredits < 0.5) {
      console.log('[EXTENSION_FLOW] === STEP 2A: Credits-only extension, skipping Stripe ===');
      // Generate a fake payment intent ID for credits-only transactions
      const creditsOnlyPaymentId = `credits_only_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      handleExtensionPaymentSuccess(creditsOnlyPaymentId);
      return;
    }

    // Otherwise, proceed with Stripe payment
    console.log('[EXTENSION_FLOW] === STEP 2B: Opening Stripe modal for extension ===');
    console.log('[EXTENSION_FLOW] Stripe payment details:', {
      creditsToUse,
      creditsEnabled,
      finalAmountAfterCredits,
      willPassCreditsToStripe: creditsEnabled && creditsToUse > 0
    });
    setShowPaymentModal(true);
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="flex justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-primary"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="bg-error-muted text-error p-4 rounded-lg">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto py-6 sm:py-8">
                          <div className="grid grid-cols-1">
                      <div className="px-3 xs:px-4 sm:px-6">
                        <div className="flex items-center justify-between h-10 sm:h-14 mb-8">
            <div>
              <h1 className="text-xl sm:text-2xl font-display font-light text-primary">My Account</h1>
              <div className="text-primary">
                <p className="text-sm font-mono">{session?.session?.user?.email}</p>
              </div>
            </div>
          </div>
          
          {bookings.length === 0 ? (
            <div className="text-center font-mono text-primary">
              No bookings found. Book your stay first!
            </div>
          ) : (
            <div className="space-y-6">
              {bookings.map((booking) => (
                <motion.div
                  key={booking.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-surface p-6 rounded-sm shadow-sm"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-xl font-display font-light mb-2 text-primary">
                        {booking.accommodation?.title || 'Accommodation'}
                      </h3>
                      <div className="space-y-1 text-sm font-mono">
                        <p>
                          <span className="text-primary">Check-in:</span>{' '}
                          <span className="text-primary">{format(parseISO(booking.check_in), 'PPP')}</span>
                        </p>
                        <p>
                          <span className="text-primary">Check-out:</span>{' '}
                          <span className="text-primary">
                            {(() => {
                              const parsedDate = parseISO(booking.check_out);
                              console.log('[DEBUG] Check-out display - raw:', booking.check_out, 'parsed:', parsedDate);
                              return format(parsedDate, 'PPP');
                            })()}
                          </span>
                        </p>
                        <p>
                          <span className="text-primary">Total Donated:</span>{' '}
                          <span className="text-primary">
                            €{(() => {
                              const totalPaid = (booking as any).total_amount_paid || 0;
                              return totalPaid % 1 === 0 ? totalPaid.toFixed(0) : totalPaid.toFixed(2);
                            })()}
                          </span>
                        </p>
                      </div>
                    </div>
                    {booking.accommodation && (
                      <ImageGallery
                        accommodation={booking.accommodation as ExtendedAccommodation}
                        currentImageIndices={currentImageIndices}
                        setCurrentImageIndices={setCurrentImageIndices}
                        onImageClick={(imageUrl) => {
                          // Open masonry gallery with all images
                          const accommodation = booking.accommodation as ExtendedAccommodation;
                          const images = getAllImages(accommodation);
                          if (images.length > 0) {
                            setGalleryImages(images);
                            setGalleryTitle(accommodation.title);
                            setGalleryOpen(true);
                          } else {
                            // Fallback to old behavior if no images
                            setEnlargedImageUrl(imageUrl);
                            setEnlargedAccommodation(accommodation);
                          }
                        }}
                      />
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>

      {enlargedImageUrl && enlargedAccommodation && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => {
            setEnlargedImageUrl(null);
            setEnlargedAccommodation(null);
          }}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const allImages = getAllImages(enlargedAccommodation);
              const currentIndex = currentImageIndices[enlargedAccommodation.id] || 0;
              const currentImage = allImages[currentIndex];
              
              const handlePrevious = () => {
                setCurrentImageIndices(prev => {
                  const currentIdx = prev[enlargedAccommodation.id] || 0;
                  const newIndex = currentIdx === 0 ? allImages.length - 1 : currentIdx - 1;
                  const newImageUrl = allImages[newIndex]?.image_url;
                  if (newImageUrl) setEnlargedImageUrl(newImageUrl);
                  return {
                    ...prev,
                    [enlargedAccommodation.id]: newIndex
                  };
                });
              };

              const handleNext = () => {
                setCurrentImageIndices(prev => {
                  const currentIdx = prev[enlargedAccommodation.id] || 0;
                  const newIndex = (currentIdx + 1) % allImages.length;
                  const newImageUrl = allImages[newIndex]?.image_url;
                  if (newImageUrl) setEnlargedImageUrl(newImageUrl);
                  return {
                    ...prev,
                    [enlargedAccommodation.id]: newIndex
                  };
                });
              };

              return (
                <>
                  <img
                    src={enlargedImageUrl}
                    alt={`${enlargedAccommodation.title} ${currentIndex + 1}`}
                    className="max-w-full max-h-[80vh] w-auto h-auto object-contain rounded-lg shadow-2xl"
                  />
                  
                  {/* Navigation arrows for enlarged view */}
                  {allImages.length > 1 && (
                    <>
                      <button
                        onClick={handlePrevious}
                        className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-black/80 hover:bg-black/90 text-white rounded-full p-2 transition-all duration-200 hover:scale-110 shadow-lg"
                        aria-label="Previous image"
                      >
                        <ChevronLeft size={24} />
                      </button>
                      <button
                        onClick={handleNext}
                        className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-black/80 hover:bg-black/90 text-white rounded-full p-2 transition-all duration-200 hover:scale-110 shadow-lg"
                        aria-label="Next image"
                      >
                        <ChevronRight size={24} />
                      </button>
                    </>
                  )}

                  {/* Dots indicator for enlarged view */}
                  {allImages.length > 1 && (
                    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex space-x-2 z-10">
                      {allImages.map((_, index) => (
                        <button
                          key={index}
                          onClick={() => {
                            setCurrentImageIndices(prev => ({
                              ...prev,
                              [enlargedAccommodation.id]: index
                            }));
                            const newImageUrl = allImages[index]?.image_url;
                            if (newImageUrl) setEnlargedImageUrl(newImageUrl);
                          }}
                          className={clsx(
                            "w-2 h-2 rounded-full transition-all duration-200 border border-white/50",
                            index === currentIndex 
                              ? "bg-white shadow-lg scale-125" 
                              : "bg-white/40 hover:bg-white/70 hover:scale-110"
                          )}
                          aria-label={`Go to image ${index + 1}`}
                        />
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
            
            {/* Close button */}
            <button
              onClick={() => {
                setEnlargedImageUrl(null);
                setEnlargedAccommodation(null);
              }}
              className="absolute -top-2 -right-2 bg-surface rounded-full p-1 text-secondary hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
              aria-label="Close enlarged image"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Extend Stay modal — retired for 2026 (EXTEND_STAY_ENABLED) */}
      {EXTEND_STAY_ENABLED && extendingBooking && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-overlay backdrop-blur-sm flex items-center justify-center z-[100] p-4"
            onClick={() => {
              console.log('[EXTENSION_DECREASE] === MODAL CLOSED ===');
              console.log('[EXTENSION_DECREASE] User closed extension modal');
              console.log('[EXTENSION_DECREASE] Final extension state before closing:', {
                extensionOnlyWeeksCount: extensionOnlyWeeks.length,
                extensionOnlyWeeksIds: extensionOnlyWeeks.map(w => w.id),
                extensionOnlyWeeksDates: extensionOnlyWeeks.map(w => ({
                  start: format(w.startDate, 'MMM d, yyyy'),
                  end: format(w.endDate, 'MMM d, yyyy')
                })),
                showCustomWeeks,
                extensionError,
                creditsEnabled,
                creditsToUse
              });
              setExtendingBooking(null);
              setExtensionWeeks([]);
              setShowCustomWeeks(false);
              setExtensionError(null);
              setCreditsEnabled(false);
              setCreditsToUse(0);
              setUserHasMadeCreditsChoice(false);
              handleRemoveDiscount();
              console.log('[EXTENSION_DECREASE] Extension modal state reset');
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[var(--color-bg-surface)] rounded-sm max-w-md w-full p-4 sm:p-6 border border-gray-500/30 text-text-primary shadow-xl relative max-h-[85vh] overflow-y-auto backdrop-blur-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  console.log('[EXTENSION_DECREASE] === MODAL CLOSED VIA X BUTTON ===');
                  console.log('[EXTENSION_DECREASE] User closed extension modal via X button');
                  console.log('[EXTENSION_DECREASE] Final extension state before closing:', {
                    extensionOnlyWeeksCount: extensionOnlyWeeks.length,
                    extensionOnlyWeeksIds: extensionOnlyWeeks.map(w => w.id),
                    extensionOnlyWeeksDates: extensionOnlyWeeks.map(w => ({
                      start: format(w.startDate, 'MMM d, yyyy'),
                      end: format(w.endDate, 'MMM d, yyyy')
                    })),
                    showCustomWeeks,
                    extensionError,
                    creditsEnabled,
                    creditsToUse
                  });
                  setExtendingBooking(null);
                  setExtensionWeeks([]);
                  setShowCustomWeeks(false);
                  setExtensionError(null);
                  setCreditsEnabled(false);
                  setCreditsToUse(0);
                  setUserHasMadeCreditsChoice(false);
                  handleRemoveDiscount();
                  console.log('[EXTENSION_DECREASE] Extension modal state reset via X button');
                }}
                className="absolute top-2 sm:top-4 right-2 sm:right-4 text-text-secondary hover:text-text-primary transition-colors z-[1]"
              >
                <X className="w-5 h-5" />
              </button>
              
              {/* Header */}
              <div className="mb-4">
                <h3 className="text-lg sm:text-xl font-display">Extend Your Stay</h3>
                <p className="text-sm text-text-secondary mt-1">
                  at {extendingBooking.accommodation?.title || 'your accommodation'}
                </p>
              </div>
              
              {/* Current Booking Summary - Simplified */}
              <div className="bg-surface-dark/30 rounded-sm p-3 mb-4 border border-border/30">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-secondary font-mono">Current stay</span>
                  <span className="text-primary font-mono">
                    {format(checkIn, 'MMM d')} → {format(checkOut, 'MMM d')} ({formatWeeksForDisplay(originalWeeksDecimal)}w)
                  </span>
                </div>
              </div>
              
              {/* Show loading state */}
              {extensionWeeksLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-primary"></div>
                </div>
              ) : (() => {
                // Check if there are any selectable weeks available at all
                // Simple logic: if checkout is before Sep 23, don't show any weeks from Sep 23 onwards
                const secretEventStartDate = new Date('2025-09-23');
                const shouldBlockFromSecretEvent = isBefore(checkOut, secretEventStartDate);
                
                const selectableWeeks = extensionWeeksData
                  .filter(w => {
                    const isAfterCheckOut = isAfter(w.startDate, checkOut);
                    const isSelectable = isWeekSelectable(w, false, originalWeeks, undefined, false);
                    const isAfterSecretEvent = isAfter(w.startDate, secretEventStartDate) || isSameDay(w.startDate, secretEventStartDate);
                    
                    // If checkout is before Sep 23, block all weeks from Sep 23 onwards
                    if (shouldBlockFromSecretEvent && isAfterSecretEvent) {
                      return false;
                    }
                    
                    return isAfterCheckOut && isSelectable;
                  });
                
                // If no weeks are available at all, show single message
                if (selectableWeeks.length === 0) {
                  return (
                    <div className="text-center py-8">
                      <p className="text-sm text-secondary font-mono">
                        {originalWeeksDecimal >= MAX_WEEKS_ALLOWED 
                          ? `Maximum stay of ${MAX_WEEKS_ALLOWED} weeks reached`
                          : 'No dates available for extension'
                        }
                      </p>
                    </div>
                  );
                }
                
                // If weeks are available, show the extension options
                return (
                  <>
                    {/* Quick Extension Options */}
                    <div className="mb-4">
                      <p className="text-xs text-secondary font-mono mb-2 uppercase">Quick extend by:</p>
                      {(() => {
                        // Calculate which options are actually available
                        const availableOptions = [1, 2, 4].filter(weeks => {
                          // Check if within max weeks limit
                          if ((originalWeeksDecimal + weeks) > MAX_WEEKS_ALLOWED) return false;
                          
                          // Check if enough weeks are available
                          const secretEventStartDate = new Date('2025-09-23');
                          const shouldBlockFromSecretEvent = isBefore(checkOut, secretEventStartDate);
                          
                          const selectableWeeks = extensionWeeksData
                            .filter(w => {
                              const isAfterCheckOut = isAfter(w.startDate, checkOut);
                              const isSelectable = isWeekSelectable(w, false, originalWeeks, undefined, false);
                              const isAfterSecretEvent = isAfter(w.startDate, secretEventStartDate) || isSameDay(w.startDate, secretEventStartDate);
                              
                              // If checkout is before Sep 23, block all weeks from Sep 23 onwards
                              if (shouldBlockFromSecretEvent && isAfterSecretEvent) {
                                return false;
                              }
                              
                              return isAfterCheckOut && isSelectable;
                            })
                            .slice(0, weeks);
                          
                          return selectableWeeks.length >= weeks;
                        });
                        
                        if (availableOptions.length === 0) {
                          return (
                            <div className="p-3 border border-border/30 rounded-sm text-center">
                              <p className="text-xs text-secondary font-mono">No quick extensions available</p>
                              <p className="text-xs text-secondary/70 font-mono mt-1">
                                Try using the calendar below
                              </p>
                            </div>
                          );
                        }
                        
                        return (
                          <div className={`grid gap-2 ${availableOptions.length === 1 ? 'grid-cols-1' : availableOptions.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                            {availableOptions.map(weeks => (
                              <button
                                key={weeks}
                                onClick={() => {
                                  console.log('[EXTENSION_DECREASE] === QUICK SELECTION TRIGGERED ===');
                                  console.log('[EXTENSION_DECREASE] User clicked quick selection button:', {
                                    requestedWeeks: weeks,
                                    currentExtensionWeeks: extensionOnlyWeeks.length,
                                    wouldIncrease: weeks > extensionOnlyWeeks.length,
                                    wouldDecrease: weeks < extensionOnlyWeeks.length,
                                    wouldStaySame: weeks === extensionOnlyWeeks.length
                                  });
                                  
                                  console.log('[EXTENSION_DECREASE] Previous extension state:', {
                                    extensionOnlyWeeksCount: extensionOnlyWeeks.length,
                                    extensionOnlyWeeksIds: extensionOnlyWeeks.map(w => w.id),
                                    extensionOnlyWeeksDates: extensionOnlyWeeks.map(w => ({
                                      start: format(w.startDate, 'MMM d, yyyy'),
                                      end: format(w.endDate, 'MMM d, yyyy')
                                    }))
                                  });
                                  
                                  setExtensionError(null);
                                  const secretEventStartDate = new Date('2025-09-23');
                                  const shouldBlockFromSecretEvent = isBefore(checkOut, secretEventStartDate);
                                  
                                  const selectableWeeks = extensionWeeksData
                                    .filter(w => {
                                      const isAfterCheckOut = isAfter(w.startDate, checkOut);
                                      const isSelectable = isWeekSelectable(w, false, originalWeeks, undefined, false);
                                      const isAfterSecretEvent = isAfter(w.startDate, secretEventStartDate) || isSameDay(w.startDate, secretEventStartDate);
                                      
                                      // If checkout is before Sep 23, block all weeks from Sep 23 onwards
                                      if (shouldBlockFromSecretEvent && isAfterSecretEvent) {
                                        return false;
                                      }
                                      
                                      return isAfterCheckOut && isSelectable;
                                    })
                                    .slice(0, weeks);
                                  
                                  console.log('[EXTENSION_DECREASE] New selection created:', {
                                    newSelectionCount: selectableWeeks.length,
                                    newSelectionIds: selectableWeeks.map(w => w.id),
                                    newSelectionDates: selectableWeeks.map(w => ({
                                      start: format(w.startDate, 'MMM d, yyyy'),
                                      end: format(w.endDate, 'MMM d, yyyy')
                                    }))
                                  });
                                  
                                  setExtensionWeeks(selectableWeeks);
                                  console.log('[EXTENSION_DECREASE] Quick selection completed');
                                }}
                                className={`
                                  p-3 rounded-sm border font-mono text-sm transition-all
                                  ${extensionOnlyWeeks.length === weeks
                                    ? 'border-accent-primary bg-accent-primary/20 text-accent-primary'
                                    : 'border-border hover:border-accent-primary/50 text-primary hover:bg-surface-dark/50'
                                  }
                                `}
                              >
                                +{weeks} week{weeks > 1 ? 's' : ''}
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                      
                      {/* Error message */}
                      {extensionError && (
                        <div className="mt-2 p-2 bg-red-900/20 border border-red-600/30 rounded-sm">
                          <p className="text-xs text-red-400 font-mono">{extensionError}</p>
                        </div>
                      )}
                      
                      {/* Custom selection toggle - only show if user hasn't reached maximum weeks */}
                      {originalWeeksDecimal < MAX_WEEKS_ALLOWED && (
                        <button
                          onClick={() => {
                            setShowCustomWeeks(!showCustomWeeks);
                            setExtensionError(null); // Clear error when toggling
                          }}
                          className="w-full mt-2 text-xs text-accent-primary hover:underline font-mono"
                        >
                          {showCustomWeeks ? 'Hide calendar' : 'Choose specific dates →'}
                        </button>
                      )}
                    </div>
                  
                  {/* Custom Week Selection (collapsible) */}
                  <AnimatePresence>
                    {showCustomWeeks && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mb-4 pt-2">
                          <WeekSelector
                            weeks={extensionWeeksData
                              .filter(w => {
                                const isAfterCheckOut = isAfter(w.startDate, checkOut);
                                const isSelectable = isWeekSelectable(w, false, originalWeeks, undefined, false);
                                const secretEventStartDate = new Date('2025-09-23');
                                const shouldBlockFromSecretEvent = isBefore(checkOut, secretEventStartDate);
                                const isAfterSecretEvent = isAfter(w.startDate, secretEventStartDate) || isSameDay(w.startDate, secretEventStartDate);
                                
                                // If checkout is before Sep 23, block all weeks from Sep 23 onwards
                                if (shouldBlockFromSecretEvent && isAfterSecretEvent) {
                                  return false;
                                }
                                
                                return isAfterCheckOut && isSelectable;
                              })
                              .slice(0, MAX_WEEKS_ALLOWED - Math.ceil(originalWeeksDecimal))}
                            selectedWeeks={[...originalWeeks, ...extensionWeeks]}
                            extensionWeeks={extensionOnlyWeeks}
                                    onWeekSelect={(week) => {
                    console.log('[EXTENSION_DECREASE] === WEEK SELECTION TRIGGERED ===');
                    console.log('[EXTENSION_DECREASE] Clicked week details:', {
                      weekId: week.id,
                      weekStart: format(week.startDate, 'MMM d, yyyy'),
                      weekEnd: format(week.endDate, 'MMM d, yyyy'),
                      isCustom: week.isCustom,
                      status: week.status
                    });
                    
                    console.log('[EXTENSION_DECREASE] Current extension state:', {
                      extensionOnlyWeeksCount: extensionOnlyWeeks.length,
                      extensionOnlyWeeksIds: extensionOnlyWeeks.map(w => w.id),
                      extensionOnlyWeeksDates: extensionOnlyWeeks.map(w => ({
                        start: format(w.startDate, 'MMM d, yyyy'),
                        end: format(w.endDate, 'MMM d, yyyy')
                      }))
                    });
                    
                    const isCurrentCheckoutWeek = extensionOnlyWeeks.length > 0 && 
                      extensionOnlyWeeks[extensionOnlyWeeks.length - 1].id === week.id;
                    
                    console.log('[EXTENSION_DECREASE] Checkout week analysis:', {
                      isCurrentCheckoutWeek,
                      lastSelectedWeekId: extensionOnlyWeeks.length > 0 ? extensionOnlyWeeks[extensionOnlyWeeks.length - 1].id : 'none',
                      clickedWeekId: week.id,
                      wouldTriggerDecrease: isCurrentCheckoutWeek
                    });
                    
                    if (isCurrentCheckoutWeek) {
                      console.log('[EXTENSION_DECREASE] === DECREASING BOOKING TRIGGERED ===');
                      console.log('[EXTENSION_DECREASE] User clicked on current checkout week, clearing extension selection');
                      console.log('[EXTENSION_DECREASE] Previous extension weeks:', {
                        count: extensionOnlyWeeks.length,
                        weeks: extensionOnlyWeeks.map(w => ({
                          id: w.id,
                          start: format(w.startDate, 'MMM d, yyyy'),
                          end: format(w.endDate, 'MMM d, yyyy')
                        }))
                      });
                      setExtensionWeeks([]);
                      console.log('[EXTENSION_DECREASE] Extension weeks cleared - booking decreased');
                      return;
                    }
                    
                    console.log('[EXTENSION_DECREASE] === INCREASING BOOKING TRIGGERED ===');
                    console.log('[EXTENSION_DECREASE] User clicked on future week, extending booking');
                    
                    const secretEventStartDate = new Date('2025-09-23');
                    const shouldBlockFromSecretEvent = isBefore(checkOut, secretEventStartDate);
                    
                    const selectableWeeks = extensionWeeksData
                      .filter(w => {
                        const isAfterCheckOut = isAfter(w.startDate, checkOut);
                        const isSelectable = isWeekSelectable(w, false, originalWeeks, undefined, false);
                        const isAfterSecretEvent = isAfter(w.startDate, secretEventStartDate) || isSameDay(w.startDate, secretEventStartDate);
                        
                        // If checkout is before Sep 23, block all weeks from Sep 23 onwards
                        if (shouldBlockFromSecretEvent && isAfterSecretEvent) {
                          return false;
                        }
                        
                        return isAfterCheckOut && isSelectable;
                      })
                      .slice(0, MAX_WEEKS_ALLOWED - Math.ceil(originalWeeksDecimal));
                    
                    console.log('[EXTENSION_DECREASE] Available selectable weeks:', {
                      totalSelectable: selectableWeeks.length,
                      maxAllowed: MAX_WEEKS_ALLOWED - Math.ceil(originalWeeksDecimal),
                      selectableWeekIds: selectableWeeks.map(w => w.id),
                      selectableWeekDates: selectableWeeks.map(w => ({
                        start: format(w.startDate, 'MMM d, yyyy'),
                        end: format(w.endDate, 'MMM d, yyyy')
                      }))
                    });
                    
                    const clickedWeekIndex = selectableWeeks.findIndex(w => w.id === week.id);
                    console.log('[EXTENSION_DECREASE] Week position analysis:', {
                      clickedWeekIndex,
                      foundInSelectable: clickedWeekIndex !== -1,
                      totalSelectableWeeks: selectableWeeks.length
                    });
                    
                    if (clickedWeekIndex !== -1) {
                      const newSelection = selectableWeeks.slice(0, clickedWeekIndex + 1);
                      console.log('[EXTENSION_DECREASE] Creating new extension selection:', {
                        newSelectionCount: newSelection.length,
                        newSelectionIds: newSelection.map(w => w.id),
                        newSelectionDates: newSelection.map(w => ({
                          start: format(w.startDate, 'MMM d, yyyy'),
                          end: format(w.endDate, 'MMM d, yyyy')
                        })),
                        previousSelectionCount: extensionOnlyWeeks.length,
                        isIncreasing: newSelection.length > extensionOnlyWeeks.length,
                        isDecreasing: newSelection.length < extensionOnlyWeeks.length,
                        isSameLength: newSelection.length === extensionOnlyWeeks.length
                      });
                      
                      setExtensionWeeks(newSelection);
                      setExtensionError(null); // Clear error on success
                      console.log('[EXTENSION_DECREASE] Extension weeks updated successfully');
                    } else {
                      console.warn('[EXTENSION_DECREASE] Clicked week not found in selectable weeks - this should not happen');
                    }
                  }}
                  onWeeksDeselect={() => {
                    console.log('[EXTENSION_DECREASE] === MANUAL DESELECTION TRIGGERED ===');
                    console.log('[EXTENSION_DECREASE] User manually deselected extension weeks');
                    console.log('[EXTENSION_DECREASE] Previous extension state:', {
                      extensionOnlyWeeksCount: extensionOnlyWeeks.length,
                      extensionOnlyWeeksIds: extensionOnlyWeeks.map(w => w.id),
                      extensionOnlyWeeksDates: extensionOnlyWeeks.map(w => ({
                        start: format(w.startDate, 'MMM d, yyyy'),
                        end: format(w.endDate, 'MMM d, yyyy')
                      }))
                    });
                    setExtensionWeeks([]);
                    setExtensionError(null);
                    console.log('[EXTENSION_DECREASE] Extension weeks cleared via manual deselection');
                  }}
                  onClearSelection={undefined}
                  currentMonth={undefined}
                  isMobile={false}
                  isAdmin={false}
                            isLoading={false}
                  onMonthChange={undefined}
                  onDateSelect={() => {}}
                  accommodationTitle={extendingBooking.accommodation?.title || ''}
                  columns={2}
                  disableFireflies={true}
                />
                  </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  
                  {/* Selected Extension Summary */}
                  {extensionOnlyWeeks.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mb-4 p-3 bg-accent-primary/10 rounded-sm border border-accent-primary/30"
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="text-xs text-accent-primary font-mono uppercase">New checkout</p>
                          <p className="text-lg text-primary font-mono">
                            {format(extensionOnlyWeeks[extensionOnlyWeeks.length - 1].endDate, 'MMM d, yyyy')}
                          </p>
              </div>
                        <div className="text-right">
                          <p className="text-xs text-secondary font-mono">Total stay</p>
                          <p className="text-lg text-primary font-mono">
                            {formatWeeksForDisplay(totalWeeksDecimal)} weeks
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                  
                                        {/* Price Breakdown - Always visible when extension selected */}
              {extensionOnlyWeeks.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="space-y-4"
                    >
                      {/* Pricing Details */}
                                              <div className="p-4 bg-surface-dark rounded-sm border border-border">
                  <div className="flex items-center justify-between mb-3">
                          <h4 className="text-base font-mono text-primary">Extension Cost</h4>
                    <Tooltip.Provider>
                      <Tooltip.Root delayDuration={50}>
                        <Tooltip.Trigger asChild>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowDiscountModal(true);
                            }}
                                  className="p-1 text-[var(--color-accent-primary)] hover:text-[var(--color-accent-secondary)] rounded transition-colors"
                          >
                            <Info className="w-4 h-4" />
                          </button>
                        </Tooltip.Trigger>
                        <Tooltip.Portal>
                                <Tooltip.Content className="tooltip-content !font-mono z-[110]" sideOffset={5}>
                                  View discount details
                            <Tooltip.Arrow className="tooltip-arrow" />
                          </Tooltip.Content>
                        </Tooltip.Portal>
                      </Tooltip.Root>
                    </Tooltip.Provider>
                  </div>
                  
                        <div className="space-y-2 text-sm font-mono">
                      <div className="flex justify-between">
                            <span className="text-secondary">Accommodation ({extensionOnlyWeeks.length}w)</span>
                        <span className="text-primary">€{Math.round(extensionPricing.extensionAccommodationPrice)}</span>
                    </div>

                          <div className="flex justify-between">
                            <span className="text-secondary">Food & Facilities</span>
                            <span className="text-primary">€{Math.round(extensionPricing.extensionFoodCost)}</span>
                      </div>
                      
                                                    {/* Food Contribution Slider - Inline */}
                          {foodContribution !== null && foodContributionRange && (
                            <div className="pt-2 pb-1">
                          <OptimizedSlider
                            id="extension-food-contribution"
                                min={foodContributionRange.min}
                                max={foodContributionRange.max}
                                value={foodContribution}
                            onChange={setFoodContribution}
                                onDisplayValueChange={handleDisplayValueChange}
                              />
                              <div className="flex justify-between text-[10px] text-secondary mt-1">
                                <span>€{foodContributionRange.min}/w</span>
                                <span className="text-accent-primary">€{displayFoodContribution || foodContribution}/week</span>
                                <span>€{foodContributionRange.max}/w</span>
                          </div>
                        </div>
                      )}

                          {/* Discount if applied */}
                    {appliedDiscount && extensionPricing.discountAmount > 0 && (
                            <>
                              <div className="border-t border-border/50 my-2" />
                      <div className="flex justify-between">
                                <span className="text-secondary">Subtotal</span>
                        <span className="text-primary">€{Math.round(extensionPricing.extensionPrice)}</span>
                      </div>
                      <div className="flex justify-between text-emerald-600">
                                <span>{appliedDiscount.code} (-{appliedDiscount.percentage_discount}%)</span>
                                <span>-€{extensionPricing.discountAmount.toFixed(2)}</span>
                      </div>
                            </>
                          )}
                          
                          <div className="border-t border-border pt-2 mt-2">
                            <div className="flex justify-between text-base">
                              <span className="text-primary font-medium">Total</span>
                              <span className="text-primary font-medium">€{extensionPricing.finalExtensionPrice.toFixed(2)}</span>
                            </div>
                          </div>
                    </div>
                  </div>

                      {/* Credits Section */}
                      <CreditsSection
                        availableCredits={availableCredits}
                        creditsLoading={creditsLoading}
                        creditsEnabled={creditsEnabled}
                        setCreditsEnabled={(enabled) => {
                          console.log('[EXTENSION_PRICING] User toggled credits:', { enabled, previousValue: creditsEnabled });
                          setCreditsEnabled(enabled);
                          setUserHasMadeCreditsChoice(true);
                        }}
                        creditsToUse={creditsToUse}
                        setCreditsToUse={setCreditsToUse}
                        pricing={{
                          totalNights: extensionPricing.extensionNights || 0,
                          nightlyAccommodationRate: (extensionPricing.weeklyAccommodationRate || 0) / 7,
                          baseAccommodationRate: extensionPricing.accommodationBasePrice || 0,
                          effectiveBaseRate: extensionPricing.weeklyAccommodationRate || 0,
                          totalAccommodationCost: extensionPricing.extensionAccommodationPrice || 0,
                          totalFoodAndFacilitiesCost: extensionPricing.extensionFoodCost || 0,
                          subtotal: extensionPricing.extensionPrice || 0,
                          durationDiscountAmount: (extensionPricing.extensionPrice || 0) - (extensionPricing.extensionAccommodationPrice || 0) - (extensionPricing.extensionFoodCost || 0),
                          durationDiscountPercent: extensionPricing.averageSeasonalDiscount || 0,
                          weeksStaying: extensionPricing.extensionWeeks || 0,
                          totalAmount: extensionPricing.finalExtensionPrice || 0,
                          appliedCodeDiscountValue: extensionPricing.discountAmount || 0,
                          seasonalDiscount: extensionPricing.averageSeasonalDiscount || 0,
                          vatAmount: 0,
                          totalWithVat: extensionPricing.finalExtensionPrice || 0
                        }}
                        finalAmountAfterCredits={extensionPricing.finalAmountAfterCredits || 0}
                      />

                      {/* Discount Code Section - Simplified */}
                      <div className="space-y-2">
                        {!appliedDiscount ? (
                          <div className="flex gap-2">
                            <input 
                              type="text"
                              value={discountCodeInput}
                              onChange={(e) => setDiscountCodeInput(e.target.value.toUpperCase())}
                              className="flex-1 px-3 py-2 bg-surface-dark border border-border rounded-sm focus:outline-none focus:ring-1 focus:ring-accent-primary text-primary placeholder:text-secondary text-sm font-mono"
                              placeholder="Discount code"
                              disabled={isApplyingDiscount}
                            />
                            <button
                              onClick={handleApplyDiscount}
                              disabled={isApplyingDiscount || !discountCodeInput.trim()}
                              className="px-3 py-2 bg-surface-dark border border-border rounded-sm text-primary text-sm font-mono hover:border-accent-primary/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              {isApplyingDiscount ? '...' : 'Apply'}
                            </button>
                          </div>
                        ) : (
                                                      <div className="flex items-center justify-between p-2.5 bg-emerald-900/20 rounded-sm border border-emerald-600/30">
                            <div className="flex items-center gap-2 text-sm">
                              <Tag className="w-3.5 h-3.5 text-emerald-500" />
                              <span className="text-emerald-400 font-mono">{appliedDiscount.code} (-{appliedDiscount.percentage_discount}%)</span>
                            </div>
                            <button 
                              onClick={handleRemoveDiscount}
                              className="p-1 text-emerald-500 hover:text-red-400 rounded transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        {discountError && (
                          <p className="text-xs text-red-400 font-mono">{discountError}</p>
                        )}
                  </div>
                  
                      {/* Action Button */}
                  <button
                    onClick={handleConfirmExtension}
                    disabled={isProcessingPayment}
                        className="w-full px-4 py-2.5 bg-accent-primary text-stone-800 font-mono text-sm rounded-sm transition-all hover:bg-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                      >
                        {isProcessingPayment ? (
                          <span className="flex items-center justify-center gap-2">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-stone-800"></div>
                            Processing...
                          </span>
                        ) : (
                          <span className="flex items-center justify-center gap-2">
                            Continue to Payment
                            <span className="opacity-90">€{(extensionPricing.finalAmountAfterCredits || 0).toFixed(2)}</span>
                          </span>
                        )}
                  </button>
                    </motion.div>
                  )}
                  

                </>
              )})()}
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

      {/* Payment Modal */}
      {showPaymentModal && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-overlay backdrop-blur-sm flex items-center justify-center z-[110] p-4"
            onClick={() => setShowPaymentModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[var(--color-bg-surface)] rounded-sm max-w-md w-full p-4 sm:p-6 border border-gray-500/30 text-text-primary shadow-xl relative backdrop-blur-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setShowPaymentModal(false)}
                className="absolute top-2 sm:top-4 right-2 sm:right-4 text-text-secondary hover:text-text-primary transition-colors z-[1]"
              >
                <X className="w-5 h-5" />
              </button>
              
              <div className="mb-4 sm:mb-6">
                <h3 className="text-lg sm:text-xl font-display">Complete Extension Donation</h3>
                <p className="text-sm text-text-secondary mt-2">
                  Extend your stay by {extensionOnlyWeeks.length} week{extensionOnlyWeeks.length > 1 ? 's' : ''}${appliedDiscount ? ` (${appliedDiscount.code} applied)` : ''}${creditsToUse > 0 ? ` (${creditsToUse} credits used)` : ''}
                </p>
              </div>

              <StripeCheckoutForm
                authToken={authToken}
                userEmail={session?.session?.user?.email || ''}
                total={(() => {
                  const paymentAmount = extensionPricing.finalAmountAfterCredits || 0;
                  console.log('[EXTENSION_FLOW] StripeCheckoutForm payment amount:', {
                    paymentAmount,
                    originalPrice: extensionPricing.finalExtensionPrice,
                    creditsToUse,
                    creditsEnabled,
                    calculation: `${extensionPricing.finalExtensionPrice} - ${creditsToUse} = ${paymentAmount}`
                  });
                  return paymentAmount;
                })()}
                description={`Booking extension for ${extendingBooking?.accommodation?.title || 'Accommodation'} - ${extensionOnlyWeeks.length} week${extensionOnlyWeeks.length > 1 ? 's' : ''}${appliedDiscount ? ` (${appliedDiscount.code} applied)` : ''}${creditsToUse > 0 ? ` (${creditsToUse} credits used)` : ''}`}
                bookingMetadata={{
                  accommodationId: extendingBooking?.accommodation_id,
                  originalTotal: extensionPricing.finalAmountAfterCredits,
                  discountCode: appliedDiscount?.code,
                  creditsUsed: creditsToUse || 0
                }}
                onSuccess={handleExtensionPaymentSuccess}
                onClose={() => setShowPaymentModal(false)}
              />
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

      {/* Discount Modal for Extension — retired for 2026 (EXTEND_STAY_ENABLED) */}
      {EXTEND_STAY_ENABLED && extendingBooking && extensionOnlyWeeks.length > 0 && (
        <DiscountModal
          isOpen={showDiscountModal}
          onClose={() => setShowDiscountModal(false)}
          checkInDate={extensionOnlyWeeks[0]?.startDate || new Date()}
          checkOutDate={extensionOnlyWeeks[extensionOnlyWeeks.length - 1]?.endDate || new Date()}
          durationCheckInDate={originalWeeks[0]?.startDate || new Date()}
          durationCheckOutDate={extensionOnlyWeeks[extensionOnlyWeeks.length - 1]?.endDate || new Date()}
          accommodationName={extendingBooking.accommodation?.title || ''}
          basePrice={extendingBooking.accommodation?.base_price || 0}
          calculatedWeeklyPrice={extensionPricing.weeklyAccommodationRate} // Price AFTER discounts (seasonal + duration) - this is what the user actually pays per week
          averageSeasonalDiscount={(() => {
            // Calculate seasonal discount for EXTENSION PERIOD ONLY
            // This shows what seasons the extension covers
            if (extensionOnlyWeeks.length === 0) return null;
            const extensionStartDate = extensionOnlyWeeks[0]?.startDate;
            const extensionEndDate = extensionOnlyWeeks[extensionOnlyWeeks.length - 1]?.endDate;
            if (!extensionStartDate || !extensionEndDate) return null;
            
            // CRITICAL FIX: Dorms don't get seasonal discounts
            if (extendingBooking.accommodation?.title?.toLowerCase().includes('dorm')) {
              return 0;
            }
            
            const extensionSeasonBreakdown = getSeasonBreakdown(extensionStartDate, extensionEndDate);
            if (extensionSeasonBreakdown.seasons.length === 0) return null;
            
            const extensionAvgDiscount = extensionSeasonBreakdown.seasons.reduce((sum, season) => 
              sum + (season.discount * season.nights), 0) / 
              extensionSeasonBreakdown.seasons.reduce((sum, season) => sum + season.nights, 0);
            
            // Always round to two decimals for display
            return Math.round(extensionAvgDiscount * 100) / 100;
          })()}
          selectedWeeks={[...originalWeeks, ...extensionOnlyWeeks]}
          customSeasonBreakdown={(() => {
            // Pass the extension period season breakdown
            if (extensionOnlyWeeks.length === 0) return undefined;
            const extensionStartDate = extensionOnlyWeeks[0]?.startDate;
            const extensionEndDate = extensionOnlyWeeks[extensionOnlyWeeks.length - 1]?.endDate;
            if (!extensionStartDate || !extensionEndDate) return undefined;
            
            return getSeasonBreakdown(extensionStartDate, extensionEndDate);
          })()}
        />
      )}
      
      {/* Masonry Gallery Modal */}
      <MasonryGallery
        images={galleryImages}
        isOpen={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        title={galleryTitle}
      />
    </div>
  );
}

// Extension feature removed
