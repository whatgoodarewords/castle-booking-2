import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Home, X, HelpCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { isSameWeek, addWeeks, isAfter, isBefore, format, addMonths, subMonths, startOfDay, isSameDay, addDays, differenceInDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
// import { WeekSelector } from '../components/WeekSelector';
import { SimpleWeekSelector } from '../components/SimpleWeekSelector';
import { formatDateForDisplay, normalizeToUTCDate, doDateRangesOverlap, calculateDurationDiscountWeeks, calculateTotalWeeksDecimal, startOfMonthUTC, addMonthsUTC, subMonthsUTC } from '../utils/dates';
import CabinSelector from '../components/CabinSelector';
import { BookingSummary } from '../components/BookingSummary';
import { MaxWeeksModal } from '../components/MaxWeeksModal';
import { WeekCustomizationModal } from '../components/admin/WeekCustomizationModal';
import { DiscountModal } from '../components/DiscountModal';
import { generateWeeksWithCustomizations, generateSquigglePath, getWeeksInRange } from '../utils/dates';
import { useWeeklyAccommodations } from '../hooks/useWeeklyAccommodations'; // Now using real data
import { useSession } from '../hooks/useSession';
import { motion } from 'framer-motion';
import { convertToUTC1 } from '../utils/timezone';
// import { useCalendar } from '../hooks/useCalendar'; // Not needed for single week
import { Week, WeekStatus } from '../types/calendar';
import { CalendarService } from '../services/CalendarService';
import { CalendarConfigButton } from '../components/admin/CalendarConfigButton';
import { getSeasonalDiscount, getDurationDiscount, getSeasonBreakdown, calculateWeeklyAccommodationPrice } from '../utils/pricing';
import { areSameWeeks } from '../utils/dates';
import { clsx } from 'clsx';
import { calculateDaysBetween } from '../utils/dates';
import { bookingService } from '../services/BookingService';
import * as Tooltip from '@radix-ui/react-tooltip';
import { InfoBox } from '../components/InfoBox';
import { useUserPermissions } from '../hooks/useUserPermissions';
import { Fireflies } from '../components/Fireflies';
import { FireflyPortal } from '../components/FireflyPortal';
import { GardenDecompressionAddon } from '../components/GardenDecompressionAddon';
// Dutch auction imports - DISABLED
// import { useDutchAuctionSimple } from '../hooks/useDutchAuctionSimple';
// import { TrendingDown, Info } from 'lucide-react';
// import { DutchAuctionModal } from '../components/DutchAuctionModal';
// import { DutchAuctionFirstTimeModal } from '../components/DutchAuctionFirstTimeModal';
import { Info } from 'lucide-react'; // Keep Info for other uses

// Define SeasonBreakdown type locally
interface SeasonBreakdown {
  hasMultipleSeasons: boolean;
  seasons: Array<{
    name: string;
    discount: number;
    nights: number;
  }>;
}

// Season legend component (Moved from WeekSelector)
const SeasonLegend = () => {
  return (
    // Decreased bottom margin to bring it closer to the header below
    <div className="flex flex-wrap justify-start gap-4 xs:gap-5 sm:gap-8 mb-4">
      {/* Increased spacing between circle and text */}
      <div className="flex items-center gap-1.5 xs:gap-2">
        {/* Made circle slightly larger */}
        <div className="w-4 h-4 xs:w-4.5 xs:h-4.5 rounded-full bg-season-low"></div>
        {/* Increased font size */}
        <span className="text-lg font-lettra-bold uppercase text-secondary whitespace-nowrap">Low (Nov-May)</span>
      </div>
      {/* Increased spacing between circle and text */}
      <div className="flex items-center gap-1.5 xs:gap-2">
        {/* Made circle slightly larger */}
        <div className="w-4 h-4 xs:w-4.5 xs:h-4.5 rounded-full bg-season-medium"></div>
        {/* Increased font size */}
        <span className="text-lg font-lettra-bold uppercase text-secondary whitespace-nowrap">Medium (Jun, Oct)</span>
      </div>
      {/* Increased spacing between circle and text */}
      <div className="flex items-center gap-1.5 xs:gap-2">
        {/* Made circle slightly larger */}
        <div className="w-4 h-4 xs:w-4.5 xs:h-4.5 rounded-full bg-season-summer"></div>
        {/* Increased font size */}
        <span className="text-lg font-lettra-bold uppercase text-secondary whitespace-nowrap">Summer (Jul-Sep)</span>
      </div>
    </div>
  );
};

export function Book2Page() {
  // console.log(`📊 [BOOK2] Render`); // Debug logging disabled
  const navigate = useNavigate();
  
  // Dutch Auction integration - DISABLED
  // const { isActive: auctionActive, timeToNextDrop, getPricingInfo, auctionStartDate, auctionEndDate, hasStarted } = useDutchAuctionSimple();
  const auctionActive = false; // Dutch auction disabled
  const getPricingInfo = null; // Dutch auction disabled
  
  // Get current date and set the initial month
  const today = new Date();
  
  // [TIMEZONE_FIX] Use UTC-based date initialization to avoid timezone conversion issues
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const initialMonth = new Date(Date.UTC(year, month, 1));

  // Fetch real accommodations from database with images
  const { accommodations, loading: accommodationsLoading } = useWeeklyAccommodations();
  
  // Initialize with pre-selected The Castle week
  const [selectedWeeks, setSelectedWeeks] = useState<Week[]>([{
    id: 'castle-week-sept-2025',
    startDate: new Date('2025-09-21T00:00:00Z'),
    endDate: new Date('2025-09-26T00:00:00Z'),
    name: 'The Castle',
    status: 'available' as WeekStatus,
    isCustom: false,
    isEdgeWeek: false,
    flexibleDates: [],
    checkInDay: 0,
    checkOutDay: 5,
  }]);
  const [selectedAccommodation, setSelectedAccommodation] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(initialMonth);
  const [showMaxWeeksModal, setShowMaxWeeksModal] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [selectedWeekForCustomization, setSelectedWeekForCustomization] = useState<Week | null>(null);
  const [lastRefresh, setLastRefresh] = useState(0);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [selectedGardenAddon, setSelectedGardenAddon] = useState<any>(null);
  const [showAuctionModal, setShowAuctionModal] = useState(false);



  // State for firefly effect
  const [showAccommodationFireflies, setShowAccommodationFireflies] = useState(false);
  const [testMode, setTestMode] = useState(false);




  // Calculate combined discount
  const calculateCombinedDiscount = useCallback((weeks: Week[]): number => {
    // Find the accommodation object first
    const accommodation = selectedAccommodation && accommodations
        ? accommodations.find(a => a.id === selectedAccommodation)
        : null;
    const accommodationTitle = accommodation?.title || '';
    const accommodationPrice = accommodation?.base_price ?? 0;

    if (!accommodation || weeks.length === 0) {
      return 0;
    }

    // === ALIGN DURATION CALCULATION ===
    // Use the consistent utility function
    const completeWeeks = calculateDurationDiscountWeeks(weeks);
    const durationDiscount = getDurationDiscount(completeWeeks);

    // === ALIGN SEASONAL CALCULATION (mimic useDiscounts logic) ===
    let averageSeasonalDiscount = 0;
    // Get breakdown based on the actual selected weeks
    const checkInDate = weeks[0].startDate;
    const checkOutDate = weeks[weeks.length - 1].endDate;
    const seasonBreakdown = getSeasonBreakdown(checkInDate, checkOutDate);
    
    // Determine if seasonal discount applies (same conditions as modal)
    const showSeasonalSection = accommodationPrice > 0 
        && seasonBreakdown.seasons.length > 0 
        && !accommodationTitle.toLowerCase().includes('dorm');

    if (showSeasonalSection) {
       const totalNightsInSeasons = seasonBreakdown.seasons.reduce((sum, season) => sum + season.nights, 0);
       if (totalNightsInSeasons > 0) {
           const preciseDiscount = seasonBreakdown.seasons.reduce((sum, season) => 
              sum + (season.discount * season.nights), 0) / totalNightsInSeasons;
           // CRITICAL FIX: Round to match what's displayed in modal and used in calculations
           averageSeasonalDiscount = Math.round(preciseDiscount * 100) / 100;
       } else {
          averageSeasonalDiscount = 0; 
          console.warn("[Book2Page] Combined Discount - Calculated zero nights in seasons for seasonal discount.");
       }
    } else {
    }
    
    // Calculate combined discount (multiplicative)
    const combined = 1 - (1 - averageSeasonalDiscount) * (1 - durationDiscount);
    
    // Return the combined discount factor (0 to 1)
    return combined;
    // The display logic will handle converting this to a percentage and rounding.
  }, [selectedAccommodation, accommodations, selectedWeeks]); // Added selectedWeeks dependency

  // This state holds the result of the calculation above
  const combinedDiscount = calculateCombinedDiscount(selectedWeeks);

  const { session, isLoading: sessionLoading } = useSession();
  
  const { isAdmin, isLoading: permissionsLoading } = useUserPermissions(session);
  
  const isMobile = window.innerWidth < 768;

  // --- START: Normalize date specifically for the calendar hook ---
  const calendarStartDate = startOfMonthUTC(currentMonth);
  // Calculate end date based on the normalized start date
  const calendarEndDate = addMonthsUTC(calendarStartDate, isMobile ? 3 : 4);

  // --- END: Normalize date ---

  // HARDCODED SINGLE WEEK - No calendar hook needed
  const castleWeek: Week = {
    id: 'castle-week-sept-2025',
    startDate: new Date('2025-09-21T00:00:00Z'),
    endDate: new Date('2025-09-26T00:00:00Z'), // End date at midnight (start of 26th)
    name: 'The Castle',
    status: 'available' as WeekStatus,
    isCustom: false,
    isEdgeWeek: false,
    flexibleDates: [],
    checkInDay: 0, // Sunday
    checkOutDay: 5, // Friday
  };
  
  const weeks: Week[] = [castleWeek];
  
  const calendarLoading = false;
  const setCalendarRefresh = () => {};
 // Track component mounting for debugging
  useEffect(() => {
    // console.log('[BOOK2] Mounted/Updated'); // Debug logging disabled
  });

  // Track loading state changes
  useEffect(() => {
  }, [sessionLoading, permissionsLoading, accommodationsLoading, calendarLoading]);

  // Sync the local refresh state with the useCalendar hook's refresh state
  useEffect(() => {
    // Only sync if lastRefresh is greater than 0 (not the initial state)
    if (lastRefresh > 0) {
      setCalendarRefresh(lastRefresh);
    }
  }, [lastRefresh]); // Removed setCalendarRefresh from dependencies



  // Helper functions
  const isFirstOrLastSelectedHelper = useCallback((week: Week, currentSelection: Week[]) => {
    if (!currentSelection || currentSelection.length === 0) return false;
    
    // Get first and last selected weeks
    const firstWeek = currentSelection[0];
    const lastWeek = currentSelection[currentSelection.length - 1];
    
    // Use our consistent comparison helper
    return areSameWeeks(week, firstWeek) || areSameWeeks(week, lastWeek);
  }, []);
  
  // Original isFirstOrLastSelected function that uses the helper
  const isFirstOrLastSelected = useCallback((week: Week) => {
    return isFirstOrLastSelectedHelper(week, selectedWeeks);
  }, [selectedWeeks, isFirstOrLastSelectedHelper]);

  // Add a wrapped setCurrentMonth function with logging
  const handleMonthChange = useCallback((newMonth: Date) => {
    setCurrentMonth(newMonth); // Set state to the start of the month
  }, [currentMonth, selectedWeeks]);

  // Simplified handleWeekSelect for single week
  const handleWeekSelect = useCallback((week: Week) => {
    setSelectedWeeks(prev => {
      const currentSelection = prev || [];
      
      // Check if already selected
      const isSelected = currentSelection.some(w => w.id === week.id);
      
      // Toggle selection
      if (isSelected) {
        return []; // Deselect
      } else {
        return [week]; // Select (only one week allowed)
      }
    });
  }, []);

  // New handler for deselecting multiple weeks at once
  const handleWeeksDeselect = useCallback((weeksToDeselect: Week[]) => {

    // Filter out all the weeks to deselect in one batch operation
    setSelectedWeeks(prev => {
      // Safety check - if prev is undefined, initialize as empty array
      const currentSelection = prev || [];
      
      // If nothing to deselect, return unchanged
      if (weeksToDeselect.length === 0) return currentSelection;
      
      // Filter out all weeks that should be deselected
      return currentSelection.filter(selectedWeek => 
        !weeksToDeselect.some(weekToDeselect => 
          areSameWeeks(weekToDeselect, selectedWeek)
        )
      );
    });
  }, [setSelectedWeeks]);

  /**
   * Handle clearing all selected weeks at once
   * 
   * This leverages the existing handleWeeksDeselect function to clear everything in one operation.
   * It's attached to the Clear Selection button in the WeekSelector component.
   */
  const handleClearSelection = useCallback(() => {
    // Simply pass all selected weeks to our existing deselection handler
    if (selectedWeeks.length > 0) {
      handleWeeksDeselect(selectedWeeks);
    }
  }, [handleWeeksDeselect, selectedWeeks]);

  /**
   * Handle saving week customization changes
   * 
   * This function is called when a user saves changes in the WeekCustomizationModal.
   * It delegates the actual update/create logic to the CalendarService, which handles
   * all the complex overlap resolution.
   */
  const handleSaveWeekCustomization = async (updates: {
    status: WeekStatus;
    name?: string;
    startDate?: Date;
    endDate?: Date;
    flexibleDates?: Date[];
  }) => {
    if (!selectedWeekForCustomization) return;

    try {
      // Normalize all dates for consistent handling
      const finalStartDate = normalizeToUTCDate(updates.startDate || selectedWeekForCustomization.startDate);
      const finalEndDate = normalizeToUTCDate(updates.endDate || selectedWeekForCustomization.endDate);
      const flexibleDates = updates.flexibleDates?.map(d => normalizeToUTCDate(d));

      // Check if this is an existing customization or a new one
      if (selectedWeekForCustomization.isCustom && selectedWeekForCustomization.id) {
        // Update existing customization
        await CalendarService.updateCustomization(selectedWeekForCustomization.id, {
          ...updates,
          startDate: finalStartDate,
          endDate: finalEndDate,
          flexibleDates
        });
      } else {
        // Create new customization
        await CalendarService.createCustomization({
                startDate: finalStartDate,
                endDate: finalEndDate,
                status: updates.status,
                name: updates.name,
          flexibleDates
        });
      }
      
      // Refresh calendar data and close modal
        const newTimestamp = Date.now();
        setLastRefresh(newTimestamp);
        setSelectedWeekForCustomization(null);
    } catch (error) {
      console.error('[Book2Page] Error saving week customization:', error);
      // Show error to user (you could add a toast notification here)
    }
  };

  /**
   * Handle deleting a week customization (resetting to default)
   * 
   * This function is called when a user clicks the "Reset to Default" button in the WeekCustomizationModal.
   * It deletes the customization from the database, which effectively resets the week to its default state.
   */
  const handleDeleteWeekCustomization = async (weekId: string) => {
    try {
      
      // Delete the customization
      const success = await CalendarService.deleteCustomization(weekId);
      
      if (success) {
      } else {
        console.error('[Book2Page] Failed to delete week customization');
      }
      
      // Refresh calendar data and close modal
      const newTimestamp = Date.now();
      setLastRefresh(newTimestamp);
      setSelectedWeekForCustomization(null);
    } catch (error) {
      console.error('[Book2Page] Error deleting week customization:', error);
    }
  };

  useEffect(() => {
    if (!isAdmin && selectedWeeks.length > 0) {
      const today = normalizeToUTCDate(new Date());
      const filteredWeeks = selectedWeeks.filter(week => {
        const weekStartDate = normalizeToUTCDate(week.startDate);
        return weekStartDate.getTime() >= today.getTime();
      });
      
      if (filteredWeeks.length !== selectedWeeks.length) {
        setSelectedWeeks(filteredWeeks);
      }
    }
  }, [selectedWeeks, isAdmin]);

  const isLoading = accommodationsLoading || calendarLoading;
  
  // Track when loading state changes
  useEffect(() => {
    // Loading state tracking effect
  }, [isLoading, accommodationsLoading, calendarLoading]);

  // Calculate season breakdown for the selected weeks
  const calculateSeasonBreakdown = useCallback((weeks: Week[], accommodationTitle: string): SeasonBreakdown => {
    if (weeks.length === 0) {
      const discount = getSeasonalDiscount(currentMonth, accommodationTitle);
      const seasonName = discount === 0 ? 'Summer Season' : 
                         discount === 0.15 ? 'Medium Season' : 
                         'Low Season';
      return { 
        hasMultipleSeasons: false, 
        seasons: [{ name: seasonName, discount, nights: 0 }] 
      };
    }

    // Sort the weeks to ensure we're processing dates in chronological order
    const sortedWeeks = [...weeks].sort((a, b) => 
      a.startDate.getTime() - b.startDate.getTime()
    );
    
    // Get the overall stay period
    const startDate = sortedWeeks[0].startDate;
    const endDate = sortedWeeks[sortedWeeks.length - 1].endDate;
    
    // Calculate total nights - simple end date minus start date
    const totalNights = differenceInDays(endDate, startDate);
    
    // Group nights by season
    const seasonMap: Record<string, { name: string; discount: number; nights: number }> = {};

    // Manually generate dates in UTC to avoid timezone issues with eachDayOfInterval
    const allDates: Date[] = [];
    // Clone start date to avoid modifying the original
    let currentDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())); 
    // We want to iterate up to, but not including, the endDate
    const finalExclusiveEndDate = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));

    // Loop while the current date is strictly before the final end date
    while (currentDate.getTime() < finalExclusiveEndDate.getTime()) {
        // Add a clone of the current UTC date to the array
        allDates.push(new Date(currentDate)); 
        
        // Increment the day in UTC for the next iteration
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    // Count the nights per season using the date of each night
    allDates.forEach((date: Date) => {
      const discount = getSeasonalDiscount(date, accommodationTitle);
      const seasonName = discount === 0 ? 'Summer Season' : 
                         discount === 0.15 ? 'Medium Season' : 
                         'Low Season';
      const key = `${seasonName}-${discount}`;
      
      if (!seasonMap[key]) {
        seasonMap[key] = { name: seasonName, discount, nights: 0 };
      }
      
      seasonMap[key].nights++;
    });
    
    // Validate our calculations
    const totalCalculatedNights = Object.values(seasonMap).reduce(
      (sum, season) => sum + season.nights, 0
    );
    
    if (totalCalculatedNights !== totalNights) {
      console.warn(`[Book2Page] Night calculation mismatch: ${totalCalculatedNights} vs expected ${totalNights}`);
    }
    
    const seasons = Object.values(seasonMap).sort((a, b) => b.nights - a.nights);
    const hasMultipleSeasons = seasons.length > 1;
    
    return { hasMultipleSeasons, seasons };
  }, [currentMonth]);

  // PERFORMANCE FIX: Convert seasonBreakdown from state to computed value to eliminate double renders
  const seasonBreakdown = useMemo(() => {
    // Find the selected accommodation first
    const accommodation = selectedAccommodation && accommodations
        ? accommodations.find(a => a.id === selectedAccommodation)
        : null;
    const accommodationPrice = accommodation?.base_price ?? 0;
    const accommodationTitle = accommodation?.title ?? '';

    // Only calculate breakdown if weeks are selected, price > 0, AND it's not a Dorm
    if (selectedWeeks.length > 0 && accommodationPrice > 0 && accommodationTitle !== 'Dorm') {
      return calculateSeasonBreakdown(selectedWeeks, accommodationTitle);
    } else {
      return undefined;
    }
  }, [selectedWeeks, selectedAccommodation, accommodations, calculateSeasonBreakdown]);

  // Fix the isWeekSelected function to safely handle undefined selectedWeeks
  const isWeekSelected = useCallback((week: Week) => {
    if (!selectedWeeks || selectedWeeks.length === 0) return false;
    
    return selectedWeeks.some(selectedWeek => areSameWeeks(week, selectedWeek));
  }, [selectedWeeks]);

  // FlexibleCheckInModal needs to pass both the week and the selected date
  const handleFlexDateSelect = useCallback((date: Date, week: Week) => {
    // --- Use the date directly from the modal --- 
    // It should already be normalized by the modal.
    const normalizedDate = date; // Reverted: Use the input date directly
    
    if (!week) {
      console.error('[Book2Page] No week provided to handleFlexDateSelect');
      return;
    }
    
    // --- Explicitly construct the new week object ---
    // Use the date from the modal (which should be normalized UTC).
    const selectedWeek: Week = {
      id: week.id, // Preserve original ID
      startDate: normalizedDate, // Use the date from modal as the actual start date
      endDate: week.endDate, // Preserve original end date
      status: 'visible', // Explicitly set status
      name: week.name, // Preserve original name (if any)
      isCustom: true, // Mark as custom due to flex selection changing start date
      isEdgeWeek: week.isEdgeWeek, // Preserve edge status
      flexibleDates: week.flexibleDates, // Preserve the original list of flex dates
      selectedFlexDate: normalizedDate, // Store the chosen flex date
      isFlexibleSelection: true // Add flag
      // Ensure any other essential properties from 'Week' type are preserved if needed
    };
    
    // Use a direct state update for the first selection to avoid any stale closures
    if (selectedWeeks.length === 0) {
      setSelectedWeeks([selectedWeek]);
    } else {
      // For subsequent selections, use the normal handler
      // Make sure handleWeekSelect correctly preserves the selectedWeek object details
      handleWeekSelect(selectedWeek);
    }
  }, [handleWeekSelect, selectedWeeks.length]); 

  // Calculates the accommodation title based on the selected accommodation ID
  const accommodationTitle = useMemo(() => {
    const accommodation = selectedAccommodation && accommodations
        ? accommodations.find(a => a.id === selectedAccommodation)
        : null;
    return accommodation?.title || '';
  }, [selectedAccommodation, accommodations]); // Dependencies

  // Calculates the accommodation details based on the selected accommodation ID
  const selectedAccommodationDetails = useMemo(() => {
    const accommodation = selectedAccommodation && accommodations
        ? accommodations.find(a => a.id === selectedAccommodation)
        : null;
    // Return price and title for easy access
    return {
        // object: accommodation, // Keep this commented unless needed elsewhere
        title: accommodation?.title || '',
        price: accommodation?.base_price ?? 0
    };
  }, [selectedAccommodation, accommodations]); // Dependencies

  // Memoize the selected accommodation object to prevent unnecessary re-renders
  const selectedAccommodationObject = useMemo(() => {
    if (!selectedAccommodation || !accommodations) return null;
    return accommodations.find(a => a.id === selectedAccommodation) || null;
  }, [selectedAccommodation, accommodations]);

  // PERFORMANCE FIX: Convert weekly accommodation info from state to computed value
  const weeklyAccommodationInfo = useMemo(() => {
    

    
    const normalizedCurrentMonth = normalizeToUTCDate(currentMonth);
    const newInfo: Record<string, { price: number | null; avgSeasonalDiscount: number | null }> = {};

    if (accommodations && accommodations.length > 0) {
      accommodations.forEach(acc => {
        if ((acc as any).parent_accommodation_id) return;


        try {
          // 2. Calculate average seasonal discount separately FIRST (for both display and calculation)
          let avgSeasonalDiscount: number = 0; // Default to number, handle null later if needed
          if (selectedWeeks.length > 0 && !acc.title.toLowerCase().includes('dorm') && acc.base_price > 0) {
            const breakdown = getSeasonBreakdown(selectedWeeks[0].startDate, selectedWeeks[selectedWeeks.length - 1].endDate);
            const totalNightsInSeasons = breakdown.seasons.reduce((sum, season) => sum + season.nights, 0);
            if (totalNightsInSeasons > 0) {
              // Weighted average based on nights in each season
              const preciseDiscount = breakdown.seasons.reduce((sum, season) => 
                sum + (season.discount * season.nights), 0) / totalNightsInSeasons;
              // CRITICAL FIX: Round to match what's displayed in modal (consistent rounding)
              avgSeasonalDiscount = Math.round(preciseDiscount * 100) / 100;
            } else {
               avgSeasonalDiscount = 0; // Or handle as needed if no nights found
            }
          } else if (!acc.title.toLowerCase().includes('dorm') && acc.base_price > 0) {
            // Fallback for no selected weeks - use reference date
             avgSeasonalDiscount = getSeasonalDiscount(normalizedCurrentMonth, acc.title);
          } else {
            // Dorms or free accommodations have no seasonal discount
            avgSeasonalDiscount = 0;
          }

          // 1. Calculate final weekly price using the pre-calculated seasonal discount
          const weeklyPrice = calculateWeeklyAccommodationPrice(
            acc, 
            selectedWeeks,
            // Pass the calculated avgSeasonalDiscount here
            avgSeasonalDiscount 
          );
          
          // Store both the final price and the definitive seasonal discount used
          newInfo[acc.id] = { price: weeklyPrice, avgSeasonalDiscount };

        } catch (error) {
          console.error(`[Book2Page] Error calculating info for ${acc.title} (ID: ${acc.id}):`, error);
          newInfo[acc.id] = { price: null, avgSeasonalDiscount: null }; // Set defaults on error
        }
      });
    } else {
    }
    
    return newInfo;

  }, [selectedWeeks, accommodations, currentMonth]); 

  // NEW: Memoized lookup function returns the info object
  const getDisplayInfo = useCallback((accommodationId: string): { price: number | null; avgSeasonalDiscount: number | null } | null => {
    const info = weeklyAccommodationInfo[accommodationId];
    return info ?? null;
  }, [weeklyAccommodationInfo]); // <-- REMOVE isAdmin FROM DEPENDENCIES

  // ---> ADD LOG HERE INSTEAD <--- 

  // Handle accommodation selection with firefly effect
  const handleAccommodationSelect = useCallback((accommodationId: string) => {

    // Only trigger fireflies if actually selecting (not deselecting)
    if (accommodationId && accommodationId !== selectedAccommodation) {
      setShowAccommodationFireflies(true);
      setTimeout(() => {
        setShowAccommodationFireflies(false);
      }, 2000);
    }
    
    setSelectedAccommodation(accommodationId);
  }, [selectedAccommodation]);

  // ---> LOADING CHECK HERE <--- 
  
  // Removed early loading return - let individual components handle their own loading states

  
  return (
    <div className="min-h-screen">
      {/* Dutch Auction Banner - DISABLED */}
      {/* {auctionActive && (
        <div className="bg-gradient-to-r from-amber-50 via-amber-50/90 to-amber-50/80 border-b border-amber-200/50 px-4 py-2.5">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <TrendingDown className="w-4 h-4 text-amber-700" />
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">
                    {hasStarted ? 'Next reduction:' : 'Auction starts:'}
                  </span>
                  <span className="font-mono text-sm font-semibold text-amber-700">
                    {timeToNextDrop || '—'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="hidden sm:block text-xs text-gray-600">
                  Tower: €15k→€4k • Noble: €10k→€2k • Standard: €4.8k→€800
                </span>
                <button
                  onClick={() => setShowAuctionModal(true)}
                  className="p-1.5 rounded-md hover:bg-amber-100 transition-colors"
                  aria-label="Auction details"
                >
                  <Info className="w-4 h-4 text-amber-700" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )} */}
      <FireflyPortal />
      
      
      {/* Accommodation selection fireflies */}
      {showAccommodationFireflies && (
        <Fireflies 
          count={40}
          color="#ffd700"
          minSize={1}
          maxSize={3}
          fadeIn={true}
          fadeOut={true}
          duration={2000}
          clickTrigger={false}
          ambient={false}
          className="pointer-events-none z-50"
        />
      )}
      
      <div className="container mx-auto py-4 xs:py-6 sm:py-8 px-4">
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 xs:gap-5 sm:gap-6">
          {/* Left Column - Calendar and Cabin Selector */}
          <div className="lg:col-span-2">
            {/* == START: New wrapper div with horizontal padding == */}
            <div>
              {/* Moved h1 inside wrapper - REMOVING px-* padding now */}
              <h1 className="text-4xl lg:text-[78px] font-display mb-3 xs:mb-4 text-primary pt-14 leading-[1.1] tracking-[-0.02em]">THE GATES BECKON</h1>
              
              {/* Closed Container Notice */}
              <div className="bg-amber-900/20 border border-amber-700/30 rounded-sm p-3 mb-4">
                <p className="text-sm text-amber-200 font-mono">
                  The Castle is a closed container. We ask that everyone stays on-site throughout the experience.
                </p>
              </div>

              {/* == END: Moved Admin controls inside wrapper == */}

              {/* Add the admin controls block here */}
              {isAdmin && (
                <div className="flex justify-end mb-3 xs:mb-4">
                  <div className="flex items-center gap-2 xs:gap-3">
                    {/* Test Mode Toggle - Always visible for admins */}
                    <button
                      onClick={() => setTestMode(!testMode)}
                      className={clsx(
                        "flex items-center gap-1.5 xs:gap-2 px-3 xs:px-4 py-1.5 xs:py-2 rounded-sm text-sm font-medium font-mono transition-all duration-200 border",
                        testMode 
                          ? "bg-orange-600/80 text-white hover:bg-orange-500/90 border-orange-500 shadow-lg" 
                          : "bg-orange-900/30 text-white hover:bg-orange-700/40 border-orange-700/50"
                      )}
                      title={testMode ? "Disable test mode (allows selecting past weeks & unavailable accommodations)" : "Enable test mode (allows selecting past weeks & unavailable accommodations)"}
                    >
                      <svg 
                        className="h-4 w-4 xs:h-5 xs:w-5" 
                        xmlns="http://www.w3.org/2000/svg" 
                        viewBox="0 0 24 24" 
                        fill="none" 
                        stroke="currentColor" 
                        strokeWidth="2" 
                        strokeLinecap="round" 
                        strokeLinejoin="round"
                      >
                        <path d="M9 12l2 2 4-4"></path>
                        <path d="M21 12c-1 0-3-1-3-3s2-3 3-3 3 1 3 3-2 3-3 3"></path>
                        <path d="M3 12c1 0 3-1 3-3s-2-3-3-3-3 1-3 3 2 3 3 3"></path>
                        <path d="M12 3c0 1-1 3-3 3s-3-2-3-3 1-3 3-3 3 2 3 3"></path>
                        <path d="M12 21c0-1 1-3 3-3s3 2 3 3-1 3-3 3-3-2-3-3"></path>
                      </svg>
                      <span>{testMode ? 'Test Mode ON' : 'Test Mode'}</span>
                    </button>

                    {isAdminMode ? (
                      <>
                        <button
                          onClick={() => setIsAdminMode(false)}
                          className="flex items-center gap-1.5 xs:gap-2 px-3 xs:px-4 py-1.5 xs:py-2 rounded-sm text-sm font-medium font-mono transition-colors duration-200 bg-emerald-600/80 text-white hover:bg-emerald-500/90 border-emerald-500 shadow-lg"
                        >
                          <svg 
                            className="h-4 w-4 xs:h-5 xs:w-5" 
                            xmlns="http://www.w3.org/2000/svg" 
                            viewBox="0 0 24 24" 
                            fill="none" 
                            stroke="currentColor" 
                            strokeWidth="2" 
                            strokeLinecap="round" 
                            strokeLinejoin="round"
                          >
                            <path d="M18 6L6 18M6 6l12 12"></path>
                          </svg>
                          <span>Exit Edit Mode</span>
                        </button>
                        
                        <CalendarConfigButton 
                          onConfigChanged={() => {
                            // Refresh data when config changes
                            const newTimestamp = Date.now();
                            setLastRefresh(newTimestamp);
                          }} 
                        />
                      </>
                    ) : (
                      <button
                        onClick={() => setIsAdminMode(true)}
                        className="flex items-center gap-1.5 xs:gap-2 px-3 xs:px-4 py-1.5 xs:py-2 rounded-sm text-sm bg-emerald-900/30 text-white hover:bg-emerald-700/40 border border-emerald-700/50 transition-all duration-200 font-medium font-mono"
                      >
                        <svg 
                          className="h-4 w-4 xs:h-5 xs:w-5" 
                          xmlns="http://www.w3.org/2000/svg" 
                          viewBox="0 0 24 24" 
                          fill="none" 
                          stroke="currentColor" 
                          strokeWidth="2" 
                          strokeLinecap="round" 
                          strokeLinejoin="round"
                        >
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                        <span>Edit Mode</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Adding the custom SVG divider here - Setting vertical margins to 32px (my-8) */}
              <img 
                src="/images/horizontal-line.svg" 
                alt="Decorative divider" 
                className="w-full max-w-3xl my-8 block mx-auto" 
              />

              {/* Moved Calendar card inside wrapper - CHANGING p-* to py-* now */}
              <div className="rounded-sm shadow-sm py-3 xs:py-4 sm:py-6 mb-4 xs:mb-5 sm:mb-6">
                {/* REMOVING px-* padding from this inner div */}
                <div className="flex flex-col gap-3 mb-4">
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    {/* Increased font size for the header */}
                    <h2 className="text-2xl sm:text-3xl font-display font-light text-primary text-center">
                      The Castle · September 21-26, 2025
                    </h2>
                  </div>

                </div>

                {isLoading ? (
                  <div className="h-48 xs:h-56 sm:h-64 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 xs:h-10 xs:w-10 border-t-2 border-b-2 border-accent-primary"></div>
                  </div>
                ) : (
                  <>
                  <SimpleWeekSelector 
                    weeks={weeks}
                    selectedWeeks={selectedWeeks}
                    onWeekSelect={() => {}} // Disable selection - it's always selected
                  />
                  </>
                )}
              </div> {/* Closing Calendar card div */}
              
              {/* Castle Map */}
              <div className="w-full flex justify-center mb-4 xs:mb-5 sm:mb-6">
                <img 
                  src="/images/castle-map.jpg" 
                  alt="Castle Map" 
                  className="w-full max-w-5xl rounded-sm"
                />
              </div>
              
              {/* Cabin Selector with heading inside, matching Calendar card structure */}
              <div className="rounded-sm shadow-sm py-3 xs:py-4 sm:py-6 mb-4 xs:mb-5 sm:mb-6">
                <div className="flex flex-col gap-3 mb-4">
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <h2 className="text-2xl sm:text-3xl font-display font-light text-primary text-center">
                      Pick your nest
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center justify-center">
                    <p className="text-base sm:text-lg font-display font-light text-secondary text-center">
                      Post-Castle Decompression @ Bottom
                    </p>
                  </div>
                </div>
                <CabinSelector 
                  accommodations={accommodations || []}
                  selectedAccommodationId={selectedAccommodation}
                  onSelectAccommodation={handleAccommodationSelect}
                  // Dutch auction props removed
                  // auctionActive={auctionActive}
                  // getPricingInfo={getPricingInfo}
                  selectedWeeks={selectedWeeks}
                  currentMonth={currentMonth}
                  isLoading={accommodationsLoading}
                  isDisabled={selectedWeeks.length === 0}
                  displayWeeklyAccommodationPrice={getDisplayInfo}
                  testMode={testMode}
                />
              </div> {/* Closing Cabin Selector div */}
              
              {/* Garden Decompression Addon - MOVED AFTER accommodations */}
              <GardenDecompressionAddon
                castleEndDate={new Date('2025-09-26T00:00:00Z')}
                onSelectAddon={setSelectedGardenAddon}
                selectedAddon={selectedGardenAddon}
              />
            </div> {/* == END: New wrapper div == */}
          </div> {/* Closing lg:col-span-2 div */}

          {/* Right Column - Booking Summary (becomes a top section on mobile) */}
          <div className="order-first lg:order-last">
            {/* Re-add sticky, add max-height and overflow for independent scrolling on large screens */}
            <div className="lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto">
              {/* This inner div now just handles the styling */}
              <div className="rounded-sm shadow-sm p-3 xs:p-4 sm:p-6 mb-4 xs:mb-5 sm:mb-6" id="booking-summary">
                {selectedWeeks.length > 0 ? (
                  <BookingSummary 
                    selectedWeeks={selectedWeeks}
                    selectedAccommodation={selectedAccommodationObject}
                    onClearWeeks={() => setSelectedWeeks([])}
                    onClearAccommodation={() => setSelectedAccommodation(null)}
                    seasonBreakdown={seasonBreakdown}
                    calculatedWeeklyAccommodationPrice={selectedAccommodation ? (weeklyAccommodationInfo[selectedAccommodation]?.price ?? selectedAccommodationObject?.base_price ?? 0) : null}
                    gardenAddon={selectedGardenAddon}
                    onClearGardenAddon={() => setSelectedGardenAddon(null)}
                  />
                ) : (
                  <div className="text-secondary text-sm xs:text-sm font-mono">
                    <p>Select your dates to see booking details</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showMaxWeeksModal && (
        <MaxWeeksModal 
          isOpen={showMaxWeeksModal} 
          onClose={() => setShowMaxWeeksModal(false)} 
        />
      )}
      
      {isAdmin && isAdminMode && selectedWeekForCustomization && (
        <WeekCustomizationModal
          week={selectedWeekForCustomization}
          onClose={() => setSelectedWeekForCustomization(null)}
          onSave={handleSaveWeekCustomization}
          onDelete={handleDeleteWeekCustomization}
        />
      )}

      {showDiscountModal && (
        <DiscountModal
          isOpen={showDiscountModal}
          onClose={() => setShowDiscountModal(false)}
          checkInDate={selectedWeeks[0]?.startDate || new Date()}
          checkOutDate={selectedWeeks[selectedWeeks.length - 1]?.endDate || new Date()}
          accommodationName={selectedAccommodationDetails?.title || ''}
          basePrice={selectedAccommodationDetails?.price || 0}
          calculatedWeeklyPrice={selectedAccommodation ? weeklyAccommodationInfo[selectedAccommodation]?.price ?? null : null}
          averageSeasonalDiscount={selectedAccommodation ? weeklyAccommodationInfo[selectedAccommodation]?.avgSeasonalDiscount ?? null : null}
          selectedWeeks={selectedWeeks}
        />
      )}
      
      {/* Dutch Auction Modals - DISABLED */}
      {/* <DutchAuctionFirstTimeModal userId={session?.user?.id} /> */}
      {/* <DutchAuctionModal
        isOpen={showAuctionModal}
        onClose={() => setShowAuctionModal(false)}
        auctionStartDate={auctionStartDate}
        auctionEndDate={auctionEndDate}
        hasStarted={hasStarted}
      /> */}
      
      {/* Mobile Sticky Summary Bar */}
      {selectedWeeks.length > 0 && selectedAccommodation && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-surface border-t border-border p-3 z-40 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="text-xs text-secondary mb-1">Total Price</div>
              <div className="text-lg font-bold text-primary">
                €{Math.round(seasonBreakdown?.finalPrice || 0)}
              </div>
            </div>
            <button
              onClick={() => {
                const element = document.getElementById('booking-summary');
                element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="bg-accent-primary hover:bg-accent-primary-hover text-white px-4 py-2 rounded-sm font-medium text-sm transition-colors"
            >
              View Details & Pay
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
