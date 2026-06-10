import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calendar } from 'lucide-react';
import { useSchedulingRules } from '../hooks/useSchedulingRules';
import { getSeasonBreakdown } from '../utils/pricing';
import { normalizeToUTCDate } from '../utils/dates';
import { format, addDays } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { bookingService } from '../services/BookingService';
import { supabase } from '../lib/supabase';
import { StripeCheckoutForm } from './StripeCheckoutForm';
import { useSession } from '../hooks/useSession';
import { formatInTimeZone } from 'date-fns-tz';
import { CancellationPolicyModal } from './CancellationPolicyModal';
import { useUserPermissions } from '../hooks/useUserPermissions';
import { useCredits } from '../hooks/useCredits';
import { calculateTotalNights, calculateTotalDays } from '../utils/dates';
import { Fireflies } from './Fireflies';

// Import types
import type { BookingSummaryProps, SeasonBreakdown } from './BookingSummary/BookingSummary.types';
import type { PaymentBreakdown } from '../types/payment';

// Import hooks
import { usePricing } from './BookingSummary/BookingSummary.hooks';

// Import components
import { StayDetails } from './BookingSummary/components/StayDetails';
import { AccommodationSection } from './BookingSummary/components/AccommodationSection';
import { GardenAddonSection } from './BookingSummary/components/GardenAddonSection';
import { CreditsSection } from './BookingSummary/components/CreditsSection';
import { ConfirmButtons } from './BookingSummary/components/ConfirmButtons';

// Import utils
import { formatPriceDisplay } from './BookingSummary/BookingSummary.utils';

// 2026 booking-open gate: the bookings table trigger raises BOOKING_NOT_OPEN
// before booking_opens_at for non-patrons — surface it as friendly copy.
const BOOKING_NOT_OPEN_MESSAGE = "Booking isn't open yet — rooms open for booking on July 19.";
const isBookingNotOpenError = (err: unknown): boolean =>
  String((err as { message?: unknown } | null)?.message ?? err ?? '').includes('BOOKING_NOT_OPEN');

export function BookingSummary({
  selectedWeeks,
  selectedAccommodation,
  onClearWeeks,
  onClearAccommodation,
  seasonBreakdown: initialSeasonBreakdown,
  calculatedWeeklyAccommodationPrice,
  gardenAddon,
  onClearGardenAddon,
  bookingLocked = false
}: BookingSummaryProps) {
  // --- REMOVED: Track component renders (no longer needed) ---
  // Helper function to format dates consistently (needed for the modal)
  const formatDateForDisplay = (date: Date): string => {
    return formatInTimeZone(date, 'UTC', 'MMM d, yyyy');
  };

  // --- REMOVED: Debug logging ---

  // --- REMOVED: Debug logging ---

  const [isBooking, setIsBooking] = useState(false);
  
  const [error, setError] = useState<string | null>(null);
  
  const [showStripeModal, setShowStripeModal] = useState(false);
  
  // --- REMOVED: Flickering debug state setters ---
  const setIsBookingWithLogging = useCallback((value: boolean) => {
    setIsBooking(value);
  }, []);
  
  const setErrorWithLogging = useCallback((value: string | null) => {
    setError(value);
  }, []);
  
  const setShowStripeModalWithLogging = useCallback((value: boolean) => {
    setShowStripeModal(value);
  }, []);
  
  const [authToken, setAuthToken] = useState('');
  
  const [selectedCheckInDate, setSelectedCheckInDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  
  // New state for food and facilities contribution
  const [foodContribution, setFoodContribution] = useState<number | null>(null);
  const [showDiscountDetails, setShowDiscountDetails] = useState(false);
  const [testPaymentAmount, setTestPaymentAmount] = useState<number | null>(null);
  const [showCancellationModal, setShowCancellationModal] = useState(false);
  
  // State for celebration fireflies
  const [showCelebrationFireflies, setShowCelebrationFireflies] = useState(false);

  // No discount codes needed

  // --- State for Credits ---
  const [creditsToUse, setCreditsToUse] = useState<number>(0);
  const [creditsEnabled, setCreditsEnabled] = useState<boolean>(true); // Default to using credits
  const { credits: availableCredits, loading: creditsLoading, refresh: refreshCredits } = useCredits();
  
  // --- ADDED: Track if user has manually adjusted credits ---
  const [userHasManuallyAdjustedCredits, setUserHasManuallyAdjustedCredits] = useState<boolean>(false);
  // --- END ADDED: Track if user has manually adjusted credits ---
  
  // --- REMOVED: Render cycle tracking debug ---
  
  // --- REMOVED: Credit tracking debug ---
  
  // --- REMOVED: Track component mount (no longer needed) ---
  
  // --- REMOVED: Track credit changes (no longer needed) ---
  
  // --- REMOVED: Credit change history tracking ---
  
  // Clear error when accommodation changes
  useEffect(() => {
    if (error) {
      setErrorWithLogging(null);
    }
  }, [selectedAccommodation?.id]);
  
  // Track when credits are set
  const setCreditsToUseWithLogging = useCallback((value: number) => {
    setCreditsToUse(value);
  }, []);
  
  // --- Manual credit adjustment function ---
  const setCreditsToUseManually = useCallback((value: number) => {
    setCreditsToUse(value);
    setUserHasManuallyAdjustedCredits(true);
  }, []);
  
  // Track refreshCredits calls
  const refreshCreditsWithLogging = useCallback(async () => {
    try {
      await refreshCredits();
    } catch (error) {
      console.error('refreshCredits failed:', error);
    }
  }, [refreshCredits]);
  
  // --- End Credits State ---

  // State for internally calculated season breakdown
  const [seasonBreakdownState, setSeasonBreakdownState] = useState<SeasonBreakdown | undefined>(initialSeasonBreakdown);
  const [accommodations, setAccommodations] = useState<any[]>([]);

  // --- REMOVED: Track selectedAccommodation prop changes (no longer needed) ---

  // Hooks
  const navigate = useNavigate();
  const session = useSession();
  const { isAdmin, isLoading: permissionsLoading } = useUserPermissions(session?.session);
  const userEmail = session?.session?.user?.email; // Also update this to use session.session

  // Get flexible dates from the first week if available
  const flexibleDates = selectedWeeks[0]?.flexibleDates;
  const hasFlexibleDates = flexibleDates && flexibleDates.length > 0;

  // Season Breakdown Calculation Effect

  // Update season breakdown when selected weeks or accommodation change
  useEffect(() => {
    // Get details directly from prop
    const accommodationPrice = selectedAccommodation?.base_price ?? 0;
    const accommodationTitle = selectedAccommodation?.title ?? '';

    // --- Where does the 'accommodations' state list come from? ---
    // If you still need to look up something in the `accommodations` list, log it here:
    // const foundAccommodationInState = accommodations.find(a => a.id === selectedAccommodation?.id);
    //   found: !!foundAccommodationInState,
    //   stateListCount: accommodations.length
    // });
    // If the lookup IS still needed, restore 'accommodations' to dependency array below.


    // Calculation Logic
    if (selectedWeeks.length > 0 && accommodationPrice > 0 && !accommodationTitle.toLowerCase().includes('dorm')) {
      if (selectedWeeks[0]?.startDate && selectedWeeks[selectedWeeks.length - 1]?.endDate) {
        const startDate = selectedWeeks[0].startDate;
        const endDate = selectedWeeks[selectedWeeks.length - 1].endDate;
        const breakdown = getSeasonBreakdown(startDate, endDate);

        // Avoid unnecessary state update
        if (JSON.stringify(breakdown) !== JSON.stringify(seasonBreakdownState)) {
            setSeasonBreakdownState(breakdown);
        }
      } else {
        if (seasonBreakdownState !== undefined) {
           setSeasonBreakdownState(undefined);
        }
      }
    } else {
      if (seasonBreakdownState !== undefined) {
          setSeasonBreakdownState(undefined);
      }
    }
    // Dependencies: Rely only on props/values directly used in the effect's logic
    // Removed 'accommodations' unless it's re-added for the lookup. Added seasonBreakdownState for comparison.
  }, [selectedWeeks, selectedAccommodation, getSeasonBreakdown, seasonBreakdownState]);

  // Calculate pricing details - MEMOIZED using custom hook
  
  const pricing = usePricing({
    selectedWeeks,
    selectedAccommodation,
    calculatedWeeklyAccommodationPrice,
    foodContribution,
    gardenAddon,
    appliedDiscount: null
  });
  

  // --- REMOVED: Log pricing changes (no longer needed) ---

  const isStateOfTheArtist = useMemo(() => {
    if (selectedWeeks.length === 1) {
      const weekName = selectedWeeks[0]?.name?.toLowerCase() || '';
      const targetName = 'state of the art[ist]';
      const isMatch = weekName.includes(targetName);
      return isMatch;
    }
    return false;
  }, [selectedWeeks]);

  // Calculate final amount after credits
  const finalAmountAfterCredits = useMemo(() => {
    const afterCredits = Math.max(0, pricing.totalAmount - creditsToUse);
    return afterCredits;
  }, [pricing.totalAmount, creditsToUse]);

  // Always update the check-in date when selectedWeeks changes
  useEffect(() => {
    if (selectedWeeks.length > 0) {
      // Check if the first week has a selectedFlexDate property (from flexible check-in)
      if (selectedWeeks[0].selectedFlexDate) {
        setSelectedCheckInDate(selectedWeeks[0].selectedFlexDate);
      } else {
        // Otherwise use the week's start date
        setSelectedCheckInDate(selectedWeeks[0].startDate);
      }
    } else {
      setSelectedCheckInDate(null);
    }
  }, [selectedWeeks]); // Only depend on selectedWeeks changing

  // Initialize food contribution based on number of nights/weeks with duration discount applied
  useEffect(() => {
    if (selectedWeeks.length > 0) {
      const totalNights = calculateTotalNights(selectedWeeks);
      
      // Use the utility function to get the discounted range
      // No food contribution calculations needed
      setFoodContribution(0);
    } else {
      setFoodContribution(null);
    }
  }, [selectedWeeks, pricing.durationDiscountPercent]);

  // Track when food contribution changes
  useEffect(() => {
    // Food contribution changed
  }, [foodContribution]);

  // Monitor error state changes
  useEffect(() => {
    // Error state changed
  }, [error]);

  // Auto-set credits to use when pricing or available credits change
  useEffect(() => {
    // Only auto-set if user hasn't manually adjusted credits
    if (!userHasManuallyAdjustedCredits && creditsEnabled && !creditsLoading && pricing.totalAmount > 0) {
      // Automatically set credits to use (min of available credits or total amount)
      const maxCreditsToUse = Math.min(availableCredits, pricing.totalAmount);
      setCreditsToUseWithLogging(maxCreditsToUse);
    } else if (!creditsEnabled) {
      setCreditsToUseWithLogging(0);
    }
  }, [pricing.totalAmount, availableCredits, creditsEnabled, creditsLoading, setCreditsToUseWithLogging, userHasManuallyAdjustedCredits]);

  // Only reset manual adjustment flag when pricing changes, not accommodation
  useEffect(() => {
    // Only reset manual adjustment flag when pricing changes significantly
    // This allows auto-setting to work again when user changes dates, but preserves credit selection when swapping accommodations
    if (userHasManuallyAdjustedCredits) {
      setUserHasManuallyAdjustedCredits(false);
    }
  }, [pricing.totalAmount]); // Only reset when total amount changes, not accommodation

  // Validate that a check-in date is selected
  const validateCheckInDate = useCallback(() => {
    if (!selectedCheckInDate) {
      setError('Please select a check-in date');
      return false;
    }

    // Use UTC comparison for the actual validation check
    if (hasFlexibleDates && !flexibleDates?.some(date => 
        normalizeToUTCDate(date).getTime() === normalizeToUTCDate(selectedCheckInDate).getTime()
      )) {
      setError('Please select a valid check-in date from the available options');
      return false;
    }
    return true;
  }, [selectedCheckInDate, hasFlexibleDates, flexibleDates]);

  useEffect(() => {
    supabase.auth.getSession().then(res => {
      const token = res?.data?.session?.access_token;
      if(token && token !== '') {
        setAuthToken(token);
      } else {
        setError('Authentication required. Please sign in again.');
      }
    }).catch(err => {
      console.error('Error getting session:', err);
      setError('Failed to authenticate. Please try again.');
    });
  }, []);

  // Validate availability before showing Stripe modal
  const validateAvailability = async () => {
    console.log('[Booking Summary] Validating availability...');
    
    // If only garden addon is selected (no accommodation), skip availability check
    if (!selectedAccommodation && gardenAddon) {
      console.log('[Booking Summary] Only Garden addon selected, skipping accommodation availability check');
      return true;
    }
    
    if (!selectedAccommodation || selectedWeeks.length === 0) {
      console.warn('[Booking Summary] Missing accommodation or weeks for validation');
      setError('Please select accommodation and dates first.');
      return false;
    }

    const startDate = selectedWeeks[0].startDate;
    const endDate = selectedWeeks[selectedWeeks.length - 1].endDate;
    
    console.log('[Booking Summary] Checking availability for:', {
      accommodation: selectedAccommodation?.title || 'Accommodation',
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    });

    // If accommodation is unlimited, it's always available
    if (selectedAccommodation.is_unlimited) {
      console.log('[Booking Summary] Accommodation is unlimited, skipping availability check');
      return true;
    }

    try {
      const availability = await bookingService.getAvailability(startDate, endDate);
      const accommodationAvailability = availability.find(a => a.accommodation_id === selectedAccommodation.id);
      const isAvailable = accommodationAvailability?.is_available ?? false;
      console.log('[Booking Summary] Availability check result:', {
        isAvailable,
        accommodationId: selectedAccommodation.id
      });
      return isAvailable;
    } catch (err) {
      console.error('[Booking Summary] Error checking availability:', err);
      return false;
    }
  };

  // State for pending payment row
  const [pendingPaymentRowId, setPendingPaymentRowId] = useState<string | null>(null);
  const [pendingBookingId, setPendingBookingId] = useState<string | null>(null);

  const handleBookingSuccess = useCallback(async (paymentIntentId?: string, paymentRowIdOverride?: string) => {
    // Added optional paymentIntentId
    console.log('[BOOKING_FLOW] === STEP 5: handleBookingSuccess called ===');
    console.log('[BOOKING_FLOW] Payment Intent ID:', paymentIntentId || 'N/A');
    console.log('[BOOKING_FLOW] Checking required info:', {
      selectedAccommodation: !!selectedAccommodation,
      selectedAccommodationTitle: selectedAccommodation?.title,
      selectedWeeksLength: selectedWeeks.length,
      selectedCheckInDate: !!selectedCheckInDate,
      selectedCheckInDateISO: selectedCheckInDate?.toISOString()
    });
    try {
      // For Garden-only bookings, we still need dates but not accommodation
      if ((!selectedAccommodation && !gardenAddon) || selectedWeeks.length === 0 || !selectedCheckInDate) {
        console.error('[Booking Summary] Missing required info for booking success:', { 
          selectedAccommodation: !!selectedAccommodation, 
          gardenAddon: !!gardenAddon,
          selectedWeeks: selectedWeeks.length > 0, 
          selectedCheckInDate: !!selectedCheckInDate 
        });
        throw new Error('Missing required booking information');
      }
      
      // Calculate check-out date based on the selected check-in date
      const totalDays = calculateTotalDays(selectedWeeks);
      const checkOut = addDays(selectedCheckInDate, totalDays-1);

      setIsBookingWithLogging(true);
      setErrorWithLogging(null);
      
      try {
        // (Pricing should already be rounded to 2 decimal places)
        const roundedTotal = pricing.totalAmount;

        const formattedCheckIn = formatInTimeZone(selectedCheckInDate, 'UTC', 'yyyy-MM-dd');
        const formattedCheckOut = formatInTimeZone(checkOut, 'UTC', 'yyyy-MM-dd');
        
        // Calculate the base accommodation price BEFORE any discounts
        // Use pricing.baseAccommodationRate which is the actual base rate, not selectedAccommodation.base_price
        const baseAccommodationPrice = pricing.baseAccommodationRate * pricing.weeksStaying;
        
        
        // Calculate seasonal discount amount for accommodation
        let seasonalDiscountAmount = 0;
        let avgSeasonalDiscountPercent = 0; // Store percentage for saving to DB
        if (seasonBreakdownState && selectedAccommodation && !selectedAccommodation.title.toLowerCase().includes('dorm')) {
          const preciseDiscount = seasonBreakdownState.seasons.reduce((sum, season) => 
            sum + (season.discount * season.nights), 0) / 
            seasonBreakdownState.seasons.reduce((sum, season) => sum + season.nights, 0);
          
          // Store as decimal (e.g., 0.08 for 8%) to match the expected format
          avgSeasonalDiscountPercent = Math.round(preciseDiscount * 100) / 100;
          
          // Calculate the actual discount amount: base price * weeks * seasonal discount % (already in decimal)
          seasonalDiscountAmount = baseAccommodationPrice * avgSeasonalDiscountPercent;
        }
        
        // Calculate duration discount amount for accommodation
        const accommodationDurationDiscountAmount = baseAccommodationPrice * (pricing.durationDiscountPercent / 100);
        
        // Use the already-calculated accommodation price from pricing hook (avoids rounding discrepancies)
        const accommodationAfterSeasonalDuration = pricing.totalAccommodationCost;
        
        // Calculate subtotal after discount code (but before credits)
        const subtotalAfterDiscountCode = pricing.totalAmount; // This is already calculated in usePricing hook
        
        // FIXED: Use the exact discount code amount from pricing hook to avoid rounding issues
        const exactDiscountCodeAmount = pricing.appliedCodeDiscountValue;
        
        // Log the breakdown for debugging
        console.log('[Booking Summary] Accommodation pricing breakdown:', {
          baseWeeklyRate: selectedAccommodation.base_price,
          weeksStaying: pricing.weeksStaying,
          baseAccommodationPrice: baseAccommodationPrice,
          seasonalDiscountAmount: seasonalDiscountAmount,
          seasonalDiscountPercent: avgSeasonalDiscountPercent * 100, // Convert to percentage
          durationDiscountPercent: pricing.durationDiscountPercent,
          accommodationDurationDiscountAmount: accommodationDurationDiscountAmount,
          accommodationAfterSeasonalDuration: accommodationAfterSeasonalDuration,
          finalAccommodationPrice: pricing.totalAccommodationCost,
          exactDiscountCodeAmount: exactDiscountCodeAmount, // FIXED: Use exact amount
          // Note: Now using pricing.totalAccommodationCost directly to avoid rounding discrepancies
          usingPricingHookValue: true
        });
        
        console.log('[Booking Summary] CRITICAL: Accommodation price values being sent:', {
          accommodationPrice: parseFloat(baseAccommodationPrice.toFixed(2)), // Should be base price BEFORE discounts
          accommodationPricePaid: pricing.totalAccommodationCost // Should be actual price AFTER discounts
        });
        
        const paymentRowIdToUse = paymentRowIdOverride || pendingPaymentRowId;
        
        // Handle Garden-only bookings
        const accommodationId = selectedAccommodation?.id || null;
        const bookingTitle = selectedAccommodation?.title || (gardenAddon ? `Garden Decompression: ${gardenAddon.name}` : 'Booking');
        
        const bookingPayload: any = {
          accommodationId: accommodationId,
          checkIn: formattedCheckIn,
          checkOut: formattedCheckOut,
          totalPrice: roundedTotal, // Send the final price calculated by the frontend
          // Add price breakdown for future bookings
          accommodationPrice: parseFloat(baseAccommodationPrice.toFixed(2)), // Base price BEFORE discounts
          foodContribution: pricing.totalFoodAndFacilitiesCost,
          seasonalAdjustment: parseFloat(seasonalDiscountAmount.toFixed(2)),
          seasonalDiscountPercent: Math.round(avgSeasonalDiscountPercent * 100), // Store as percentage (e.g., 8 for 8%)
          durationDiscountPercent: pricing.durationDiscountPercent,
          // FIXED: Use exact discount amounts to avoid rounding issues
          discountAmount: parseFloat((accommodationDurationDiscountAmount + pricing.durationDiscountAmount + exactDiscountCodeAmount + seasonalDiscountAmount).toFixed(2)),
          // NEW: Store the actual accommodation amount paid (after all discounts)
          accommodationPricePaid: pricing.totalAccommodationCost,
          // NEW: Store accommodation price after seasonal/duration but before discount codes
          accommodationPriceAfterSeasonalDuration: parseFloat(accommodationAfterSeasonalDuration.toFixed(2)),
          // NEW: Store subtotal after discount code but before credits
          subtotalAfterDiscountCode: parseFloat(pricing.totalAmount.toFixed(2)),
          // FIXED: Store exact discount code amount for payment breakdown
          discountCodeAmount: parseFloat(exactDiscountCodeAmount.toFixed(2)),
          paymentRowId: paymentRowIdToUse,
        };

        // No discount codes

        // Add credits used if any
        if (creditsToUse > 0) {
          bookingPayload.creditsUsed = creditsToUse;
          console.log("[Booking Summary] Adding credits used to booking payload:", creditsToUse);
        }

        // --- ADDED: Detailed credit logging before booking creation ---
        console.log('[CREDIT_TRACKING] 🔍 PRE-BOOKING CREDIT ANALYSIS:', {
          creditsToUse,
          availableCredits,
          creditsEnabled,
          bookingPayloadCreditsUsed: bookingPayload.creditsUsed,
          willTriggerCreditDeduction: bookingPayload.creditsUsed > 0,
          userEmail,
          accommodationTitle: selectedAccommodation.title,
          totalPrice: bookingPayload.totalPrice,
          finalAmountAfterCredits
        });
        
        // Log the exact payload being sent to the database
        console.log('[CREDIT_TRACKING] 📦 BOOKING PAYLOAD FOR DATABASE:', {
          ...bookingPayload,
          // Add human-readable fields for debugging
          creditsUsedForDatabase: bookingPayload.creditsUsed,
          willDatabaseTriggerFire: bookingPayload.creditsUsed > 0,
          expectedNewCreditBalance: availableCredits - (bookingPayload.creditsUsed || 0)
        });
        // --- END ADDED: Detailed credit logging ---

        // Add payment intent ID if available (for webhook coordination)
        if (paymentIntentId) {
          bookingPayload.paymentIntentId = paymentIntentId;
          console.log("[Booking Summary] Adding payment intent ID to booking payload:", paymentIntentId);
        }

        // Check if we have a pending booking to update or need to create a new one
        let booking;
        let bookingIdToUpdate = pendingBookingId;
        
        // If we don't have pendingBookingId in state (e.g., after page refresh), 
        // try to retrieve it from the payment record
        if (!bookingIdToUpdate && paymentRowIdToUse) {
          console.log("[BOOKING_FLOW] No pendingBookingId in state, checking payment record:", paymentRowIdToUse);
          const existingBooking = await bookingService.getBookingByPaymentId(paymentRowIdToUse);
          if (existingBooking && existingBooking.status === 'pending') {
            bookingIdToUpdate = existingBooking.id;
            console.log("[BOOKING_FLOW] Found pending booking from payment record:", bookingIdToUpdate);
          }
        }
        
        if (bookingIdToUpdate) {
          console.log("[BOOKING_FLOW] === STEP 6: Updating PENDING booking to CONFIRMED ===");
          console.log("[BOOKING_FLOW] Updating booking ID:", bookingIdToUpdate);
          console.log("[BOOKING_FLOW] With payment intent ID:", paymentIntentId);
          
          // Update the existing pending booking to confirmed status
          booking = await bookingService.updateBookingStatus(
            bookingIdToUpdate,
            'confirmed',
            {
              paymentIntentId: paymentIntentId || undefined,
              paymentRowId: paymentRowIdToUse || undefined
            }
          );
          
          console.log("[BOOKING_FLOW] STEP 6 SUCCESS: Booking updated to confirmed:", booking.id);
        } else {
          // Fallback: Create a new booking if no pending booking exists
          console.log("[BOOKING_FLOW] === STEP 6: Creating booking in database (fallback) ===");
          console.log("[BOOKING_FLOW] BOOKING PAYLOAD:", JSON.stringify(bookingPayload, null, 2));
          
          // --- ADDED: Log credits state right before database call ---
          console.log('[CREDIT_TRACKING] 🎯 MOMENT OF TRUTH - Credits before database call:', {
            availableCredits,
            creditsToUse,
            creditsUsedInPayload: bookingPayload.creditsUsed,
            expectedDeduction: bookingPayload.creditsUsed || 0,
            expectedNewBalance: availableCredits - (bookingPayload.creditsUsed || 0)
          });
          // --- END ADDED: Log credits state right before database call ---
          
          booking = await bookingService.createBooking(bookingPayload);

          console.log("[BOOKING_FLOW] STEP 6 SUCCESS: Booking created:", booking.id);
        }
        
        // --- ADDED: Log credits state immediately after booking creation ---
        console.log('[CREDIT_TRACKING] ✅ BOOKING CREATED - Credits should have been deducted by trigger:', {
          bookingId: booking.id,
          creditsUsedInBooking: booking.credits_used,
          creditsUsedInPayload: bookingPayload.creditsUsed,
          triggerShouldHaveFired: bookingPayload.creditsUsed > 0,
          // Note: availableCredits here is still the old value since refreshCredits hasn't been called yet
          availableCreditsBeforeRefresh: availableCredits
        });
        // --- END ADDED: Log credits state immediately after booking creation ---
        
        // Update the pending payment row with booking_id and stripe_payment_id
        if (typeof paymentRowIdToUse === 'string' && booking.id) {
          // For credits-only bookings, use a special payment ID
          const effectivePaymentId = paymentIntentId || 
            (creditsToUse > 0 && finalAmountAfterCredits === 0 ? 'credits-only-' + booking.id : 'admin-booking-' + booking.id);
          
          console.log('[BOOKING_FLOW] === STEP 7: Updating payment record ===');
          console.log('[BOOKING_FLOW] Payment update details:', {
            pendingPaymentRowId: paymentRowIdToUse,
            bookingId: booking.id,
            creditsToUse,
            finalAmountAfterCredits,
            effectivePaymentId,
            isCreditsOnly: creditsToUse > 0 && finalAmountAfterCredits === 0
          });
          try {
            const updateResult = await bookingService.updatePaymentAfterBooking({
              paymentRowId: paymentRowIdToUse,
              bookingId: booking.id,
              stripePaymentId: effectivePaymentId
            });
            console.log('[BOOKING_FLOW] STEP 7 SUCCESS: Payment record updated');
          } catch (err) {
            console.error('[BOOKING_FLOW] STEP 7 FAILED: Payment update failed:', err);
          }
        }
        
        // Trigger celebration fireflies
        setShowCelebrationFireflies(true);
        setPendingPaymentRowId(null); // Clear after booking completes
        setShowStripeModalWithLogging(false); // Close the Stripe modal
        setIsBookingWithLogging(false); // Clear booking state
        
        // Refresh credits manually to ensure UI updates immediately
        if (creditsToUse > 0) {
          console.log("[BOOKING_FLOW] === STEP 8: Refreshing credits after use ===");
          console.log('[CREDIT_TRACKING] 🔄 ABOUT TO REFRESH CREDITS - Current state:', {
            creditsToUse,
            availableCredits,
            bookingId: booking.id,
            creditsUsedInBooking: booking.credits_used,
            expectedNewBalance: availableCredits - creditsToUse
          });
          
          try {
            await refreshCreditsWithLogging();
            console.log("[BOOKING_FLOW] STEP 8 SUCCESS: Credits refreshed");
            console.log('[CREDIT_TRACKING] ✅ CREDITS REFRESHED - Check next render for updated availableCredits');
          } catch (err) {
            console.error("[Booking Summary] Error refreshing credits:", err);
            console.error('[CREDIT_TRACKING] ❌ CREDITS REFRESH FAILED:', err);
            console.error('[FLICKER_DEBUG] ❌ CREDITS REFRESH FAILED:', err);
          }
        } else {
          console.log('[CREDIT_TRACKING] ⏭️ SKIPPING CREDITS REFRESH - No credits used');
        }
        
        // Delay navigation slightly to show fireflies
        setTimeout(async () => {
          console.log("[BOOKING_FLOW] === STEP 9: Navigating to confirmation ===");
          // Calculate actual amount donated (after credits)
          const actualDonationAmount = Math.max(0, booking.total_price - (creditsToUse || 0));
          
          // --- ADDED: Final credit state check after booking completion ---
          console.log('[CREDIT_TRACKING] 🎯 FINAL CREDIT STATE CHECK:', {
            bookingId: booking.id,
            creditsUsedInBooking: booking.credits_used,
            creditsUsedInPayload: bookingPayload.creditsUsed,
            availableCreditsAfterAllRefreshes: availableCredits,
            expectedNewBalance: availableCredits - (bookingPayload.creditsUsed || 0),
            creditsActuallyDeducted: availableCredits < (creditChangeHistory.current[0]?.availableCredits || availableCredits),
            creditChangeHistory: creditChangeHistory.current.slice(-10), // Last 10 changes
            triggerShouldHaveFired: bookingPayload.creditsUsed > 0,
            finalAssessment: bookingPayload.creditsUsed > 0 && availableCredits >= (creditChangeHistory.current[0]?.availableCredits || availableCredits) 
              ? '❌ CREDITS NOT DEDUCTED - DATABASE TRIGGER MAY HAVE FAILED' 
              : bookingPayload.creditsUsed > 0 
                ? '✅ CREDITS APPEAR TO BE DEDUCTED' 
                : '⏭️ NO CREDITS USED'
          });
          // --- END ADDED: Final credit state check ---
          
          // Retrieve accommodation details from the booking if selectedAccommodation is null
          let accommodationTitle = selectedAccommodation?.title;
          let guests = selectedAccommodation?.inventory;
          
          if (!accommodationTitle && booking.accommodation_id) {
            // Try to get accommodation info from the database
            const { data: accommodationData } = await supabase
              .from('accommodations')
              .select('title, inventory')
              .eq('id', booking.accommodation_id)
              .single();
            
            if (accommodationData) {
              accommodationTitle = accommodationData.title;
              guests = accommodationData.inventory;
              console.log('[BOOKING_FLOW] Retrieved accommodation from database:', accommodationTitle);
            }
          }
          
          navigate('/confirmation', { 
            state: { 
              booking: {
                ...booking,
                accommodation: accommodationTitle || 'Accommodation',
                guests: guests || 1,
                totalPrice: actualDonationAmount, // Show actual amount donated after credits
                checkIn: selectedCheckInDate || booking.check_in,
                checkOut: checkOut || booking.check_out
              }
            } 
          });
          console.log("[BOOKING_FLOW] STEP 9 SUCCESS: Navigation completed");
        }, 1500);
        
      } catch (err) {
        console.error('[BOOKING_FLOW] === STEP 6 FAILED: Error creating/updating booking ===');
        console.error('[BOOKING_FLOW] Error details:', err);
        
        // IMPORTANT: ALWAYS navigate to confirmation page when payment succeeded
        // This ensures user sees confirmation even if booking creation had issues
        
        // Track status for admin alert
        let confirmationEmailSent = false;
        let creditsWereDeducted = false;
        
        // CRITICAL: Log detailed error for payment without booking
        const errorDetails = {
          paymentIntentId: paymentIntentId || undefined,
          userEmail: userEmail || 'Unknown',
          error: err instanceof Error ? err.message : 'Unknown error',
          errorStack: err instanceof Error ? err.stack : undefined,
          bookingDetails: {
            accommodation: selectedAccommodation?.title || 'Accommodation',
            checkIn: formatInTimeZone(selectedCheckInDate, 'UTC', 'yyyy-MM-dd'),
            checkOut: formatInTimeZone(addDays(selectedCheckInDate, calculateTotalDays(selectedWeeks)-1), 'UTC', 'yyyy-MM-dd'),
            totalPaid: Math.max(0, pricing.totalAmount - (creditsToUse || 0)), // Actual payment amount after credits
            originalTotal: pricing.totalAmount, // Include original total for admin reference
            creditsUsed: creditsToUse > 0 ? creditsToUse : undefined,
            discountCode: undefined
          },
          // CRITICAL STATUS TRACKING
          systemStatus: {
            confirmationEmailSent, // Will be updated after email attempt
            creditsWereDeducted, // Credits only deducted on successful booking insert
            userWillSeeConfirmationPage: true // We navigate to confirmation page anyway
          },
          timestamp: new Date().toISOString()
        };
        
        console.error('[CRITICAL] PAYMENT WITHOUT BOOKING:', errorDetails);
        
        // Try to send confirmation email even though booking failed
        if (userEmail && paymentIntentId) {
          try {
            const formattedCheckIn = formatInTimeZone(selectedCheckInDate, 'UTC', 'yyyy-MM-dd');
            const formattedCheckOut = formatInTimeZone(checkOut, 'UTC', 'yyyy-MM-dd');
            
            // Calculate actual payment amount (after credits)
            const actualPaymentAmount = Math.max(0, pricing.totalAmount - (creditsToUse || 0));
            
            // Generate a temporary booking ID for email purposes
            const tempBookingId = `temp-${Date.now()}-${paymentIntentId}`;
            
            const { error: emailError } = await supabase.functions.invoke('send-booking-confirmation', {
              body: { 
                email: userEmail,
                bookingId: tempBookingId,
                checkIn: formattedCheckIn,
                checkOut: formattedCheckOut,
                accommodation: selectedAccommodation?.title || 'Accommodation',
                totalPrice: actualPaymentAmount, // Use actual payment amount after credits
                frontendUrl: window.location.origin
              }
            });
            
            if (emailError) {
              console.error('[BookingSummary] Failed to send confirmation email:', emailError);
              confirmationEmailSent = false;
            } else {
              confirmationEmailSent = true;
            }
          } catch (emailErr) {
            console.error('[BookingSummary] Exception while sending confirmation email:', emailErr);
            confirmationEmailSent = false;
          }
        }
        
        // Try to manually deduct credits since payment succeeded but booking failed
        if (creditsToUse > 0) {
          console.log('[CREDIT_TRACKING] 🔧 MANUAL CREDIT DEDUCTION ATTEMPT:', {
            creditsToUse,
            availableCredits,
            paymentIntentId,
            userEmail,
            reason: 'Payment succeeded but booking failed'
          });
          
          try {
            // Get current user for the credit deduction
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              console.log('[CREDIT_TRACKING] 🔧 Calling admin_remove_credits RPC:', {
                userId: user.id,
                amount: creditsToUse,
                note: `Credits deducted for successful payment (Payment Intent: ${paymentIntentId}) - booking creation failed and requires manual resolution`
              });
              
              const { data: newBalance, error: creditError } = await supabase.rpc('admin_remove_credits', {
                p_user_id: user.id,
                p_amount: creditsToUse,
                p_admin_note: `Credits deducted for successful payment (Payment Intent: ${paymentIntentId}) - booking creation failed and requires manual resolution`
              });
              
              if (creditError) {
                console.error('[BookingSummary] Failed to deduct credits manually:', creditError);
                console.error('[CREDIT_TRACKING] ❌ MANUAL DEDUCTION FAILED:', {
                  error: creditError,
                  userId: user.id,
                  amount: creditsToUse
                });
                creditsWereDeducted = false;
              } else {
                console.log('[CREDIT_TRACKING] ✅ MANUAL DEDUCTION SUCCESSFUL:', {
                  userId: user.id,
                  amountDeducted: creditsToUse,
                  newBalance,
                  oldBalance: availableCredits
                });
                creditsWereDeducted = true;
                
                // Refresh credits in the UI to reflect the deduction
                try {
                  await refreshCreditsWithLogging();
                  console.log('[CREDIT_TRACKING] ✅ UI REFRESHED AFTER MANUAL DEDUCTION');
                } catch (refreshErr) {
                  console.error('[BookingSummary] Failed to refresh credits UI:', refreshErr);
                  console.error('[CREDIT_TRACKING] ❌ UI REFRESH FAILED AFTER MANUAL DEDUCTION:', refreshErr);
                }
              }
            } else {
              console.error('[BookingSummary] No user found for manual credit deduction');
              console.error('[CREDIT_TRACKING] ❌ NO USER FOR MANUAL DEDUCTION');
              creditsWereDeducted = false;
            }
          } catch (creditDeductionErr) {
            console.error('[BookingSummary] Exception during manual credit deduction:', creditDeductionErr);
            console.error('[CREDIT_TRACKING] ❌ EXCEPTION DURING MANUAL DEDUCTION:', creditDeductionErr);
            creditsWereDeducted = false;
          }
        } else {
          // No credits to deduct
          console.log('[CREDIT_TRACKING] ⏭️ NO MANUAL DEDUCTION NEEDED - No credits used');
          creditsWereDeducted = false;
        }
        
        // Update the original errorDetails with actual status
        const updatedErrorDetails = {
          ...errorDetails,
          systemStatus: {
            confirmationEmailSent,
            creditsWereDeducted,
            userWillSeeConfirmationPage: true
          }
        };
        
        // Check if webhook has already created the booking before sending alert
        let bookingExistsFromWebhook = false;
        if (paymentIntentId) {
          console.log('[BOOKING_FLOW] Checking if webhook created booking for payment:', paymentIntentId);
          
          // Wait a bit to give webhook time to process
          await new Promise(resolve => setTimeout(resolve, 3000)); // Increased to 3 seconds
          
          try {
            bookingExistsFromWebhook = await bookingService.checkBookingByPaymentIntent(paymentIntentId);
            console.log('[BOOKING_FLOW] Webhook booking check result:', bookingExistsFromWebhook);
          } catch (checkError) {
            console.error('[BOOKING_FLOW] Error checking for webhook booking:', checkError);
            // Continue with alert even if check fails
          }
        }
        
        // Only send admin alert if booking truly doesn't exist
        if (!bookingExistsFromWebhook) {
          
          // NOW send admin alert with updated status
          try {
            const { data, error } = await supabase.functions.invoke('alert-booking-failure', {
              body: updatedErrorDetails
            });
            
            if (error) {
              throw error;
            }
            
            console.log('[Booking Summary] Admin alert email sent successfully');
          } catch (alertErr) {
            console.error('[Booking Summary] Failed to send admin alert:', alertErr);
            // Still try the old bug report method as fallback
            try {
              const bugReportDescription = `CRITICAL: Payment received but booking creation failed!
          
Payment Intent: ${paymentIntentId || 'N/A'}
User Email: ${userEmail || 'Unknown'}
Accommodation: ${selectedAccommodation?.title || 'Accommodation'}
Check-in: ${updatedErrorDetails.bookingDetails.checkIn}
Check-out: ${updatedErrorDetails.bookingDetails.checkOut}
Amount Paid: €${Math.max(0, pricing.totalAmount - (creditsToUse || 0))}
Credits Used: ${creditsToUse}
Discount Code: None

SYSTEM STATUS:
- Confirmation Email Sent: ${confirmationEmailSent ? 'YES' : 'NO'}
- Credits Deducted: ${creditsWereDeducted ? 'YES' : 'NO'}
- User Sees Confirmation Page: YES

Error: ${err instanceof Error ? err.message : 'Unknown error'}

Please manually create the booking for this user or process a refund.`;

              await supabase.functions.invoke('submit-bug-report', {
                body: {
                  description: bugReportDescription,
                  stepsToReproduce: `Automatic report: Booking creation failed after successful payment.`,
                  pageUrl: window.location.href,
                  image_urls: null
                }
              });
              console.log('[Booking Summary] Fallback bug report submitted');
            } catch (fallbackErr) {
              console.error('[Booking Summary] Failed to submit fallback bug report:', fallbackErr);
            }
          }
        } else {
          // Refresh credits since the webhook booking would have used them
          if (creditsToUse > 0) {
            try {
              await refreshCreditsWithLogging();
            } catch (err) {
              console.error('[BookingSummary] Error refreshing credits:', err);
            }
          }
        }
        
        // Create a booking object for the confirmation page
        const actualPaymentAmount = Math.max(0, pricing.totalAmount - (creditsToUse || 0));
        const bookingForConfirmation = {
          id: bookingExistsFromWebhook ? `webhook-booking-${paymentIntentId}` : `pending-booking-${Date.now()}`,
          accommodation: selectedAccommodation?.title || 'Accommodation',
          guests: selectedAccommodation.inventory,
          totalPrice: actualPaymentAmount, // Show actual payment amount after credits
          checkIn: selectedCheckInDate,
          checkOut: checkOut,
          status: 'confirmed',
          created_at: new Date().toISOString(),
          stripe_payment_intent_id: paymentIntentId, // Include payment intent ID for tracking
          // Add flags to indicate status
          isPendingManualCreation: !bookingExistsFromWebhook,
          manualCreationMessage: bookingExistsFromWebhook 
            ? 'Your booking has been confirmed! It should appear in your bookings list shortly.'
            : 'Your payment was successful! Your booking is being finalized. If it doesn\'t appear in your bookings list within a few minutes, please contact support with your payment reference: ' + (paymentIntentId || 'N/A')
        };
        
        // Navigate to confirmation page with the booking data
        navigate('/confirmation', { 
          state: { 
            booking: bookingForConfirmation
          }
        });
        
        // Clear selections after navigation
        setTimeout(() => {
          onClearWeeks();
          onClearAccommodation();
        }, 1000);
        
        // Exit without throwing error since we handled it gracefully
        return;
      }
    } catch (err) {
      console.error('[BookingSummary] CRITICAL ERROR in booking success handler:', err);
      console.error('[BookingSummary] Error details:', {
        message: err instanceof Error ? err.message : 'Unknown error',
        stack: err instanceof Error ? err.stack : undefined,
        type: typeof err,
        err
      });
      // Don't re-throw any errors - we've handled them gracefully above
      setErrorWithLogging(isBookingNotOpenError(err) ? BOOKING_NOT_OPEN_MESSAGE : 'An error occurred. Please try again.');
      setIsBookingWithLogging(false);
    }
  }, [selectedAccommodation, selectedWeeks, selectedCheckInDate, navigate, pricing.totalAmount, creditsToUse, refreshCreditsWithLogging, userEmail, onClearWeeks, onClearAccommodation, bookingService, finalAmountAfterCredits]);

  const handleConfirmClick = async () => {
    console.log('[BOOKING_FLOW] === STEP 1: Confirm button clicked ===');
    
    // Prevent duplicate clicks while processing
    if (isBooking) {
      console.log('[BOOKING_FLOW] Already processing booking, ignoring duplicate click');
      return;
    }
    
    console.log('[BOOKING_FLOW] Button handler reached with:', {
      selectedAccommodation: selectedAccommodation?.title,
      accommodationPrice: pricing.totalAccommodationCost,
      finalAmountAfterCredits,
      selectedWeeksCount: selectedWeeks.length,
      authToken: !!authToken
    });
    
    setErrorWithLogging(null); // Clear previous errors
    setIsBookingWithLogging(true); // Set booking flag immediately

    if (!validateCheckInDate()) {
      console.warn('[BOOKING_FLOW] STEP 1 FAILED: Check-in date validation failed.');
      setIsBookingWithLogging(false); // Reset booking flag
      return;
    }
    // Allow booking if either accommodation OR garden addon is selected
    if (!selectedAccommodation && !gardenAddon) {
      console.warn('[BOOKING_FLOW] STEP 1 FAILED: No accommodation or garden addon selected');
      setError('Please select an accommodation or Garden decompression option');
      setIsBookingWithLogging(false); // Reset booking flag
      return;
    }
    try {
      // Check if the accommodation is still available
      console.log('[BOOKING_FLOW] === STEP 2: Validating availability ===');
      const isAvailable = await validateAvailability();
      if (!isAvailable) {
        console.warn('[BOOKING_FLOW] STEP 2 FAILED: Accommodation no longer available');
        setError('This accommodation is no longer available for the selected dates');
        setIsBookingWithLogging(false); // Reset booking flag
        return;
      }
      console.log('[BOOKING_FLOW] STEP 2 SUCCESS: Availability confirmed');

      // --- NEW: Create pending payment row for ALL bookings (including credits-only) ---
      console.log('[BOOKING_FLOW] === STEP 3: Creating pending payment row ===');
      if (authToken && !pendingPaymentRowId) {
        try {
          const user = await bookingService.getCurrentUser();
          if (!user) throw new Error('User not authenticated');
          const startDate = selectedWeeks[0].startDate;
          const endDate = selectedWeeks[selectedWeeks.length - 1].endDate;
          // Use avgSeasonalDiscountPercent from the calculation above
          let avgSeasonalDiscountPercent = 0;
          if (seasonBreakdownState && selectedAccommodation && !selectedAccommodation.title.toLowerCase().includes('dorm')) {
            const preciseDiscount = seasonBreakdownState.seasons.reduce((sum, season) => 
              sum + (season.discount * season.nights), 0) / 
              seasonBreakdownState.seasons.reduce((sum, season) => sum + season.nights, 0);
            avgSeasonalDiscountPercent = Math.round(preciseDiscount * 100) / 100;
          }
          // Calculate the original accommodation price before all discounts
          const baseAccommodationPrice = pricing.baseAccommodationRate * pricing.weeksStaying;
          
          // FIXED: Define exactDiscountCodeAmount in this scope
          const exactDiscountCodeAmount = pricing.appliedCodeDiscountValue;
          
          const breakdownJson: PaymentBreakdown = {
            accommodation: pricing.totalAccommodationCost,
            food_facilities: pricing.totalFoodAndFacilitiesCost,
            accommodation_original: baseAccommodationPrice, // Original accommodation price before all discounts
            duration_discount_percent: pricing.durationDiscountPercent / 100, // Convert to decimal (e.g., 0.18 for 18%)
            seasonal_discount_percent: avgSeasonalDiscountPercent, // Already in decimal (e.g., 0.08 for 8%)
            discount_code: null,
            discount_code_percent: null,
            discount_code_applies_to: null,
            discount_code_amount: parseFloat(exactDiscountCodeAmount.toFixed(2)), // FIXED: Store exact discount code amount
            credits_used: creditsToUse, // Include credits in the breakdown
            subtotal_before_discounts: pricing.subtotal,
            total_after_discounts: pricing.totalAmount
          };



          const payment = await bookingService.createPendingPayment({
            bookingId: null, // Will be updated after booking creation
            userId: user.id,
            startDate,
            endDate,
            amountPaid: finalAmountAfterCredits, // This will be 0 for credits-only bookings
            breakdownJson,
            discountCode: undefined,
            paymentType: 'initial'
          });

          console.log('[BOOKING_FLOW] STEP 3 SUCCESS: Created pending payment row:', payment.id);
          setPendingPaymentRowId(payment.id);
          
          // NEW: Create booking with 'pending' status BEFORE payment
          console.log('[BOOKING_FLOW] === STEP 3.5: Creating PENDING booking BEFORE payment ===');
          try {
            const checkOut = addDays(selectedCheckInDate, calculateTotalDays(selectedWeeks) - 1);
            const formattedCheckIn = formatInTimeZone(selectedCheckInDate, 'UTC', 'yyyy-MM-dd');
            const formattedCheckOut = formatInTimeZone(checkOut, 'UTC', 'yyyy-MM-dd');
            
            // Calculate base accommodation price (before any discounts)
            const baseAccommodationPrice = pricing.baseAccommodationRate * pricing.weeksStaying;
            
            // Calculate seasonal discount amount for accommodation
            const seasonalDiscountAmount = baseAccommodationPrice * avgSeasonalDiscountPercent;
            
            // Calculate duration discount amount for accommodation
            const accommodationDurationDiscountAmount = baseAccommodationPrice * (pricing.durationDiscountPercent / 100);
            
            const bookingPayload = {
              accommodationId: selectedAccommodation.id,
              checkIn: formattedCheckIn,
              checkOut: formattedCheckOut,
              totalPrice: pricing.totalAmount,
              status: 'pending' as const, // Create as pending, will update to confirmed after payment
              paymentIntentId: null, // Will be updated after Stripe payment
              appliedDiscountCode: null,
              creditsUsed: creditsToUse || 0,
              accommodationPrice: parseFloat(baseAccommodationPrice.toFixed(2)),
              foodContribution: pricing.totalFoodAndFacilitiesCost || 0,
              seasonalAdjustment: parseFloat(seasonalDiscountAmount.toFixed(2)),
              seasonalDiscountPercent: Math.round(avgSeasonalDiscountPercent * 100), // Store as percentage
              durationDiscountPercent: pricing.durationDiscountPercent,
              discountAmount: parseFloat((accommodationDurationDiscountAmount + pricing.durationDiscountAmount + pricing.appliedCodeDiscountValue + seasonalDiscountAmount).toFixed(2)),
              discountCodePercent: null,
              discountCodeAppliesTo: null,
              discountCodeAmount: parseFloat(pricing.appliedCodeDiscountValue.toFixed(2)),
              accommodationPricePaid: pricing.totalAccommodationCost,
              accommodationPriceAfterSeasonalDuration: parseFloat(pricing.totalAccommodationCost.toFixed(2)),
              subtotalAfterDiscountCode: parseFloat(pricing.totalAmount.toFixed(2)),
              paymentRowId: payment.id // Link to the payment row we just created
            };
            
            console.log('[BOOKING_FLOW] Creating pending booking with payload:', bookingPayload);
            const pendingBooking = await bookingService.createBooking(bookingPayload);
            console.log('[BOOKING_FLOW] STEP 3.5 SUCCESS: Created PENDING booking:', pendingBooking.id);
            
            // Store booking ID for later use
            setPendingBookingId(pendingBooking.id);
            
            // Update payment record with booking_id
            await bookingService.updatePaymentAfterBooking({
              paymentRowId: payment.id,
              bookingId: pendingBooking.id,
              stripePaymentId: null // Will be updated after Stripe payment
            });
            
          } catch (bookingErr) {
            console.error('[BOOKING_FLOW] STEP 3.5 WARNING: Could not create pending booking:', bookingErr);
            // 2026 booking-open gate: stop here instead of proceeding to payment
            if (isBookingNotOpenError(bookingErr)) {
              console.warn('[BOOKING_FLOW] STEP 3.5 BLOCKED: booking gate is closed (BOOKING_NOT_OPEN)');
              setErrorWithLogging(BOOKING_NOT_OPEN_MESSAGE);
              setIsBookingWithLogging(false);
              return;
            }
            // Check if this is the no_new_pending_bookings constraint
            if (bookingErr && typeof bookingErr === 'object' && 'code' in bookingErr && bookingErr.code === '23514') {
              console.log('[BOOKING_FLOW] Database constraint preventing pending bookings - will create booking after payment');
            }
            // Continue anyway - we'll create the booking after payment instead
            setPendingBookingId(null);
          }

          // If the final amount is 0 (free accommodation, fully paid with credits, or both), skip payment
          if (finalAmountAfterCredits === 0) {
            console.log('[BOOKING_FLOW] === STEP 4: Free or credits-only booking, skipping Stripe ===');
            console.log('[BOOKING_FLOW] Reason for free booking:', {
              accommodationPrice: pricing.totalAccommodationCost,
              creditsToUse,
              finalAmountAfterCredits,
              isFreeAccommodation: pricing.totalAccommodationCost === 0,
              isCreditsOnly: creditsToUse > 0
            });
            await handleBookingSuccess(undefined, payment.id);
            return;
          }
        } catch (err) {
          console.error('[BOOKING_FLOW] STEP 3 FAILED: Failed to create pending payment:', err);
          console.error('[BOOKING_FLOW] Error details:', {
            error: err,
            message: err instanceof Error ? err.message : 'Unknown error',
            stack: err instanceof Error ? err.stack : undefined
          });
          
          // More specific error message
          const errorMessage = err instanceof Error && err.message.includes('booking_id') 
            ? 'Database schema update needed. Please run the migration to allow null booking_id in payments table.'
            : 'Failed to create pending payment. Please try again.';
          
          setError(errorMessage);
          return;
        }
      }

      // Show Stripe modal after pending payment row is created
      console.log('[BOOKING_FLOW] === STEP 4: Opening Stripe modal ===');
      setShowStripeModalWithLogging(true);
    } catch (err) {
      console.error('[BOOKING_FLOW] Error in handleConfirmClick:', err);
      setErrorWithLogging(isBookingNotOpenError(err) ? BOOKING_NOT_OPEN_MESSAGE : 'An error occurred. Please try again.');
      setIsBookingWithLogging(false); // Reset booking flag on error
      
      // Clean up any pending booking if it was created
      if (pendingBookingId) {
        console.log('[BOOKING_FLOW] Cleaning up pending booking after error:', pendingBookingId);
        try {
          await bookingService.updateBookingStatus(pendingBookingId, 'cancelled');
          setPendingBookingId(null);
        } catch (cancelError) {
          console.error('[BOOKING_FLOW] Error cancelling pending booking:', cancelError);
        }
      }
    }
  };

  const handleAdminConfirm = async () => {
    console.log('[Booking Summary] Admin confirm button clicked.');
    console.log('[Booking Summary] handleAdminConfirm: Initial selectedCheckInDate:', selectedCheckInDate?.toISOString(), selectedCheckInDate); // ADDED LOG
    setErrorWithLogging(null);

    if (!validateCheckInDate()) {
      console.warn('[Booking Summary] Admin Confirm FAILED: Check-in date validation failed.');
      return;
    }
    
    if (!selectedAccommodation) {
      console.warn('[Booking Summary] No accommodation selected');
      setError('Please select an accommodation');
      return;
    }
    
    try {
      // For admin, we skip payment and go straight to booking success
      await handleBookingSuccess();
          } catch (err) {
        console.error('[Booking Summary] Error in admin confirm handler:', err);
        setErrorWithLogging('An error occurred. Please try again.');
      }
  };

  // No discount code handlers needed

  // --- REMOVED: Final render logging ---

  const fallbackDate = normalizeToUTCDate(new Date());



  // Render the component
  return (
    <>
      {/* Celebration fireflies */}
      {showCelebrationFireflies && (
        <Fireflies 
          count={100}
          color="#10b981"
          minSize={1}
          maxSize={4}
          fadeIn={true}
          fadeOut={true}
          duration={3000}
          clickTrigger={false}
          ambient={false}
          className="pointer-events-none z-[70]"
        />
      )}
      
      <AnimatePresence>
        {showStripeModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[60]"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-surface rounded-sm max-w-xl w-full p-6"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-display text-primary">Complete Payment</h3>
                <button
                  onClick={async () => {
                    setShowStripeModalWithLogging(false);
                    
                    // Cancel the pending booking if user closes modal without payment
                    if (pendingBookingId) {
                      console.log('[BOOKING_FLOW] User closed payment modal, cancelling pending booking:', pendingBookingId);
                      try {
                        await bookingService.updateBookingStatus(pendingBookingId, 'cancelled');
                        setPendingBookingId(null);
                      } catch (cancelError) {
                        console.error('[BOOKING_FLOW] Error cancelling pending booking:', cancelError);
                      }
                    }
                  }}
                  className="text-secondary hover:text-secondary-hover"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* --- ADD LOGGING FOR EMAIL BEFORE PASSING --- */}
              <StripeCheckoutForm
                authToken={authToken}
                userEmail={userEmail || ''} // Pass email as prop, default to empty string if undefined
                // --- TEST ACCOMMODATION OVERRIDE FOR PAYMENT --- 
                total={
                  selectedAccommodation?.type === 'test' 
                  ? 0.50 // Force 0.50 if it's the test type (Stripe minimum)
                  : testPaymentAmount !== null && isAdmin 
                    ? testPaymentAmount // Otherwise use admin test amount if set
                    : finalAmountAfterCredits // Use amount after credits
                }
                description={`${selectedAccommodation?.title || (gardenAddon ? `Garden Decompression: ${gardenAddon.name}` : 'Booking')} for 6 days${selectedCheckInDate ? ` from ${formatInTimeZone(selectedCheckInDate, 'UTC', 'd. MMMM')}` : ''}`}
                bookingMetadata={(selectedAccommodation || gardenAddon) && selectedCheckInDate ? {
                  accommodationId: selectedAccommodation?.id || null,
                  checkIn: selectedCheckInDate ? formatInTimeZone(selectedCheckInDate, 'UTC', 'yyyy-MM-dd') : undefined,
                  checkOut: selectedCheckInDate ? formatInTimeZone(addDays(selectedCheckInDate, calculateTotalDays(selectedWeeks)-1), 'UTC', 'yyyy-MM-dd') : undefined,
                  originalTotal: pricing.totalAmount,
                  creditsUsed: creditsToUse > 0 ? creditsToUse : 0,
                  discountCode: null
                } : undefined}
                onSuccess={handleBookingSuccess}
                paymentRowId={pendingPaymentRowId || undefined}
                onClose={() => {
                  console.log('[BOOKING_FLOW] Stripe modal closed by user');
                  setShowStripeModalWithLogging(false);
                  setIsBookingWithLogging(false); // Reset booking flag when modal is closed
                  
                  // Cancel the pending booking if user closes modal without payment
                  if (pendingBookingId) {
                    console.log('[BOOKING_FLOW] Cancelling pending booking after modal close:', pendingBookingId);
                    bookingService.updateBookingStatus(pendingBookingId, 'cancelled')
                      .then(() => {
                        setPendingBookingId(null);
                        console.log('[BOOKING_FLOW] Pending booking cancelled successfully');
                      })
                      .catch((cancelError) => {
                        console.error('[BOOKING_FLOW] Error cancelling pending booking:', cancelError);
                      });
                  }
                }}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Summary of Stay section - Outer sticky wrapper */}
      <div className="w-full max-w-md lg:max-w-lg mx-auto">

        {/* Actual Content Container (Ensure Transparent Background) */}
        <div className="relative p-3 xs:p-4 sm:p-6 bg-transparent"> 
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 mb-6">
            <div className="flex items-center justify-between w-full sm:w-auto">
              <h2 className="text-xl sm:text-2xl lg:text-3xl font-display font-light text-primary">
                Summary of Stay
              </h2>
            </div>
          </div>

          {error && (
            <div className={`mb-6 p-4 rounded-sm flex justify-between items-center font-mono text-xs sm:text-sm ${
              error.includes('payment was successful') 
                ? 'bg-amber-100 text-amber-900 border-2 border-amber-400' 
                : 'bg-error-muted text-error'
            }`}>
              <div>
                {error.includes('payment was successful') && (
                  <div className="font-bold mb-2 text-base">⚠️ Payment Processed - Action Required</div>
                )}
                <span>{error}</span>
              </div>
              <button onClick={() => setError(null)} className="ml-4 flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          
          {selectedWeeks.length > 0 && (selectedAccommodation || gardenAddon) && (
            <div className="">
              {/* Stay Details Section */}
              <StayDetails selectedWeeks={selectedWeeks} />

              {/* Accommodation Section */}
              {selectedAccommodation && (
                <AccommodationSection 
                  selectedAccommodation={selectedAccommodation}
                  onClearAccommodation={onClearAccommodation}
                />
              )}

              {/* Garden Addon Section */}
              {gardenAddon && (
                <GardenAddonSection 
                  gardenAddon={gardenAddon}
                  onClearGardenAddon={onClearGardenAddon}
                />
              )}

              {/* Add thin horizontal line */}
              <hr className="border-t border-[var(--color-text-primary)] my-6 opacity-30" /> {/* Added opacity */}

              {/* NEW Wrapper for Solid Background Sections - Make sure this is TRANSPARENT */}
              <div className="bg-transparent"> {/* Removed mt-6 */}
                {/* Total Donated - Shows value being donated to the garden */}
                <div className="pt-4 mt-4">
                  {/* Total */}
                  <div className="flex font-mono justify-between items-baseline">
                    <span className="uppercase text-primary font-display text-2xl">Total</span>
                    <div className="text-right">
                      <span className="text-2xl font-display text-primary">
                        {formatPriceDisplay(pricing.totalAmount)}
                      </span>
                      {/* BTC/ETH info right under the total */}
                      <div className="text-xs text-secondary mt-1">
                        <a 
                          href="mailto:concierge@castle.community?subject=I%20want%20to%20secure%20a%20room%20with%20crypto"
                          className="underline hover:text-primary transition-colors cursor-pointer"
                        >
                          BTC & ETH accepted →
                        </a>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Credits Section */}
                                  <CreditsSection
                    availableCredits={availableCredits}
                    creditsLoading={creditsLoading}
                    creditsEnabled={creditsEnabled}
                    setCreditsEnabled={setCreditsEnabled}
                    creditsToUse={creditsToUse}
                    setCreditsToUse={setCreditsToUseManually}
                    pricing={pricing}
                    finalAmountAfterCredits={finalAmountAfterCredits}
                  />


                {/* Confirm Buttons */}
                <ConfirmButtons
                  isBooking={isBooking}
                  selectedAccommodation={selectedAccommodation}
                  selectedWeeks={selectedWeeks}
                  gardenAddon={gardenAddon}
                  finalAmountAfterCredits={finalAmountAfterCredits}
                  creditsToUse={creditsToUse}
                  isAdmin={isAdmin}
                  permissionsLoading={permissionsLoading}
                  bookingLocked={bookingLocked}
                  onConfirm={handleConfirmClick}
                  onAdminConfirm={handleAdminConfirm}
                />

                {/* Crypto Payment Option - only show when payment is required */}
                {finalAmountAfterCredits > 0 && (
                  <div className="mt-6 p-4 bg-surface/30 rounded-sm border border-border/50">
                    <div className="text-center">
                      <p className="text-xs text-secondary mb-2 font-mono">
                        <a 
                          href="mailto:concierge@castle.community?subject=I%20want%20to%20secure%20a%20room%20with%20crypto"
                          className="underline hover:text-primary transition-colors cursor-pointer"
                        >
                          BTC & ETH also accepted →
                        </a>
                      </p>
                      <p className="text-xs text-secondary font-mono">
                        Contact: <a 
                          href="mailto:concierge@castle.community" 
                          className="text-accent-primary hover:text-accent-secondary underline"
                        >
                          concierge@castle.community
                        </a>
                      </p>
                    </div>
                  </div>
                )}
              </div> {/* End of Wrapper (now transparent) */}
            </div>
          )}

          {selectedWeeks.length === 0 && (
            <div className="text-center py-10 bg-surface/50 rounded-sm shadow-sm">
              <Calendar className="w-12 h-12 mx-auto text-secondary mb-4" />
              <p className="text-secondary text-sm">Select your dates to see the summary</p>
            </div>
          )}
          
          {selectedWeeks.length > 0 && !selectedAccommodation && !gardenAddon && (
            <div className="text-center py-10 bg-surface/50 rounded-sm shadow-sm">
              <Calendar className="w-12 h-12 mx-auto text-secondary mb-4" />
              <p className="text-secondary text-sm">Select accommodation or Garden decompression to continue</p>
            </div>
          )}
        </div>
      </div>

      {/* Cancellation Policy Modal */}
      <CancellationPolicyModal
        isOpen={showCancellationModal}
        onClose={() => setShowCancellationModal(false)}
      />

      {/* No discount modal needed */}
    </>
  );
}
