import React from 'react';

interface ConfirmButtonsProps {
  isBooking: boolean;
  selectedAccommodation: any | null;
  selectedWeeks: any[];
  gardenAddon: any | null;
  finalAmountAfterCredits: number;
  creditsToUse: number;
  isAdmin: boolean;
  permissionsLoading: boolean;
  bookingLocked?: boolean; // 2026 booking-open gate: browse mode until booking_opens_at
  onConfirm: () => void;
  onAdminConfirm: () => void;
}

export function ConfirmButtons({
  isBooking,
  selectedAccommodation,
  selectedWeeks,
  gardenAddon,
  finalAmountAfterCredits,
  creditsToUse,
  isAdmin,
  permissionsLoading,
  bookingLocked = false,
  onConfirm,
  onAdminConfirm
}: ConfirmButtonsProps) {
  // Allow booking if either accommodation is selected OR garden addon is selected
  const canProceed = (selectedAccommodation || gardenAddon) && selectedWeeks.length > 0;

  return (
    <div className="mt-6 font-mono sm:mt-8">
      <button
        onClick={onConfirm}
        disabled={isBooking || !canProceed || bookingLocked}
        className={`w-full flex items-center justify-center pixel-corners--wrapper relative overflow-hidden px-6 py-2.5 sm:py-3 text-lg font-medium rounded-sm transition-colors duration-200
          ${
            isBooking || !canProceed || bookingLocked
              ? 'bg-transparent text-shade-3 cursor-not-allowed'
              : 'text-stone-800 bg-accent-primary hover:bg-accent-secondary focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring,var(--color-accent-primary))] focus:ring-offset-2 focus:ring-offset-[var(--color-focus-offset,var(--color-bg-main))]'
          }`}
      >
        <span className="pixel-corners--content 2xl:text-2xl">
          {bookingLocked ? 'Booking opens July 19' : isBooking ? 'PROCESSING...' : finalAmountAfterCredits === 0 ? 'CONFIRM BOOKING' : 'CONFIRM & DONATE'}

        </span>
      </button>
      
      {!permissionsLoading && isAdmin && (
        <button
          onClick={onAdminConfirm}
          disabled={isBooking || !canProceed}
          className={`w-full mt-3 flex items-center justify-center pixel-corners--wrapper relative overflow-hidden px-6 py-2.5 sm:py-3 text-lg font-medium rounded-sm transition-colors duration-200
            ${isBooking || !canProceed
                ? 'bg-transparent text-shade-3 cursor-not-allowed'
                : 'bg-secondary-muted text-white hover:bg-secondary-muted-hover focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring,var(--color-accent-primary))] focus:ring-offset-2 focus:ring-offset-[var(--color-focus-offset,var(--color-bg-main))]'
            }`}
        >
          <span className="pixel-corners--content 2xl:text-2xl">
             {isBooking ? 'CONFIRMING...' : <span>Admin Confirm<br />(No Payment)</span>}
          </span>
        </button>
      )}
    </div>
  );
}