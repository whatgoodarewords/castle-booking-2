import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { getFrontendUrl } from '../lib/environment';

interface Props {
  onComplete: () => void;
}

const ASCII_ART = `████████╗██╗  ██╗███████╗     ██████╗  █████╗ ██████╗ ██████╗ ███████╗███╗   ██╗
╚══██╔══╝██║  ██║██╔════╝    ██╔════╝ ██╔══██╗██╔══██╗██╔══██╗██╔════╝████╗  ██║
   ██║   ███████║█████╗      ██║  ███╗███████║██████╔╝██║  ██║█████╗  ██╔██╗ ██║
   ██║   ██╔══██║██╔══╝      ██║   ██║██╔══██║██╔══██╗██║  ██║██╔══╝  ██║╚██╗██║
   ██║   ██║  ██║███████╗    ╚██████╔╝██║  ██║██║  ██║██████╔╝███████╗██║ ╚████║
   ╚═╝   ╚═╝  ╚═╝╚══════╝     ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═══╝`;

const MOBILE_ASCII_ART = `████████╗██╗  ██╗███████╗
╚══██╔══╝██║  ██║██╔════╝
   ██║   ███████║█████╗  
   ██║   ██╔══██║██╔══╝  
   ██║   ██║  ██║███████╗
   ╚═╝   ╚═╝  ╚═╝╚══════╝

██████╗  █████╗ ██████╗ ██████╗ ███████╗███╗   ██╗
██╔════╝ ██╔══██╗██╔══██╗██╔══██╗██╔════╝████╗  ██║
██║  ███╗███████║██████╔╝██║  ██║█████╗  ██╔██╗ ██║
██║   ██║██╔══██║██╔══██╗██║  ██║██╔══╝  ██║╚██╗██║
╚██████╔╝██║  ██║██║  ██║██████╔╝███████╗██║ ╚████║
 ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═══╝`;

// Prefill the login email from ?email= — the ticket-site rooms handoff falls
// back to this page with the buyer's address when auto sign-in fails.
function getPrefilledEmail(): string {
  try {
    const raw = new URLSearchParams(window.location.search).get('email') ?? '';
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      // Already decoded — use as-is
    }
    return value.trim();
  } catch {
    return '';
  }
}

export function AnimatedTerminal({ onComplete }: Props) {
  const [asciiLines, setAsciiLines] = useState<string[]>([]);
  const [currentLine, setCurrentLine] = useState(0);
  const [currentChar, setCurrentChar] = useState(0);
  const [showBorder, setShowBorder] = useState(false);
  const [isAsciiLoaded, setIsAsciiLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [showLogin, setShowLogin] = useState(false);
  const [prefilledEmail] = useState(() => getPrefilledEmail());
  const [email, setEmail] = useState(prefilledEmail);
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [useMatrixTheme] = useState(() => Math.random() < 0.33);
  const navigate = useNavigate();
  const isMobile = window.innerWidth < 768;
  const [serverDown, setServerDown] = useState(false);
  const [lastOtpRequest, setLastOtpRequest] = useState<number>(0);

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        setDimensions({ width, height });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  useEffect(() => {
    setAsciiLines((isMobile ? MOBILE_ASCII_ART : ASCII_ART).split('\n'));
    setIsAsciiLoaded(true);
  }, [isMobile]);

  useEffect(() => {
    // Simple timer to show border after a delay
    const timer = setTimeout(() => {
      setShowBorder(true);
      setTimeout(() => setShowLogin(true), 1000);
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (asciiLines.length === 0 || currentLine >= asciiLines.length) return;

    const line = asciiLines[currentLine];
    if (currentChar >= line.length) {
      setTimeout(() => {
        setCurrentLine(prev => prev + 1);
        setCurrentChar(0);
      }, 100);
      return;
    }

    const timer = setTimeout(() => {
      setCurrentChar(prev => prev + 1);
    }, 7);

    return () => clearTimeout(timer);
  }, [asciiLines, currentLine, currentChar]);

  useEffect(() => {
    if (currentLine >= asciiLines.length && asciiLines.length > 0 && isAsciiLoaded) {
      console.log('[AnimatedTerminal] ASCII art animation complete');
      setTimeout(onComplete, 500);
    }
  }, [currentLine, asciiLines.length, onComplete, isAsciiLoaded]);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsLoading(true);
    setOtpSent(false);

    // Rate limiting - prevent requests more than once per 60 seconds
    const now = Date.now();
    if (now - lastOtpRequest < 60000) {
      const waitTime = Math.ceil((60000 - (now - lastOtpRequest)) / 1000);
      setError(`Please wait ${waitTime} seconds before requesting another code.`);
      setIsLoading(false);
      return;
    }

    // Normalize email to lowercase to match Supabase Auth behavior
    const normalizedEmail = email.toLowerCase().trim();

    try {
      console.log('[AnimatedTerminal] Requesting code for:', normalizedEmail);
      
      // STEP 1: Check access via the check-user-access edge function
      // (service role inside — anon can no longer read the guest list directly)
      console.log('[AnimatedTerminal] Checking access...');
      const { data: accessData, error: accessError } = await supabase.functions.invoke('check-user-access', {
        body: { email: normalizedEmail }
      });

      if (accessError || !accessData?.canAccess) {
        console.log('[AnimatedTerminal] Access denied for:', normalizedEmail);
        throw new Error(
          prefilledEmail
            ? 'Access denied. Email concierge@castle.community to get sorted.'
            : 'Access denied. Please contact an administrator to be added to the whitelist.'
        );
      }

      console.log('[AnimatedTerminal] Access granted, sending OTP...');

      // STEP 2: Send OTP code for ALL whitelisted users
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          shouldCreateUser: false, // Accounts are provisioned by rooms-sync/admin — never on login
          emailRedirectTo: undefined // No redirect, just OTP code
        }
      });
      
      if (error) throw error;
      setLastOtpRequest(now); // Update last request time
      setSuccess('Code sent! Check your email (and spam/junk folder).');
      setOtpSent(true);
      console.log('[AnimatedTerminal] OTP request successful for:', normalizedEmail);
    } catch (err) {
      console.error('[AnimatedTerminal] Error requesting code:', err);
      
      // Check if this looks like a server/database error
      const errorMessage = err instanceof Error ? err.message : 'Failed to send code';
      if (errorMessage.includes('Database error') || errorMessage.includes('AuthApiError')) {
        console.log('[AnimatedTerminal] Detected server issues, switching to fallback mode');
        setServerDown(true);
      } else {
        setError(errorMessage);
      }
      setOtpSent(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsLoading(true);

    // Normalize email to lowercase to match Supabase Auth behavior
    const normalizedEmail = email.toLowerCase().trim();

    try {
      console.log(`[AnimatedTerminal] Verifying code for: ${normalizedEmail} with token: ${otp}`);
      const { data, error } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: otp,
        type: 'email',
      });

      if (error) throw error;
      
      if (data.session) {
        console.log('[AnimatedTerminal] OTP verification successful, session:', data.session);
        setSuccess('Login successful!');
        onComplete();
      } else {
        console.warn('[AnimatedTerminal] OTP verified but no session returned.');
        throw new Error('Verification succeeded but failed to establish session.');
      }

    } catch (err) {
      console.error('[AnimatedTerminal] Error verifying code:', err);
      setError(err instanceof Error ? err.message : 'Invalid or expired code');
    } finally {
      setIsLoading(false);
    }
  };



  return (
    <div 
      className="h-[100dvh] bg-cover bg-center bg-no-repeat flex items-center justify-center"
      style={{
        backgroundImage: `url('https://guquxpxxycfmmlqajdyw.supabase.co/storage/v1/object/public/accommodations/castle-main.jpg')`
      }}
    >
      <div className="w-full h-full max-w-[1000px] relative flex items-center justify-center px-4" ref={containerRef}>
        {/* Hidden admin click area */}
        <div
          onClick={() => navigate('/retro2')}
          className="absolute top-0 right-0 w-[30px] h-[30px] cursor-default z-50"
          style={{ opacity: 0 }}
        />

        {/* Fluorescent border with glow */}
        <motion.div
          className="absolute inset-8 sm:inset-12 md:inset-16 lg:inset-20 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={showBorder ? { opacity: 1 } : {}}
          transition={{ duration: 1, ease: "easeOut" }}
        >
          {/* Castle golden border */}
          <div 
            className="absolute inset-0 border-2 rounded-sm castle-border"
            style={{
              borderColor: 'var(--castle-accent-gold)',
              boxShadow: 'var(--castle-shadow-glow)',
            }}
          />
          
          {/* Pulsing glow effect */}
          <motion.div 
            className="absolute inset-0 rounded-sm"
            animate={showBorder ? {
              boxShadow: [
                '0 0 10px rgba(0, 255, 0, 0.15)',
                '0 0 15px rgba(0, 255, 0, 0.2)',
                '0 0 10px rgba(0, 255, 0, 0.15)',
              ]
            } : {}}
            transition={{
              duration: 4,
              ease: "easeInOut",
              repeat: Infinity,
              repeatType: "loop"
            }}
          />
        </motion.div>

        <AnimatePresence>
          {showLogin && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              {/* Use padding instead of calculated width for better responsiveness */}
              <div className="w-full max-w-[300px] px-6 sm:px-0">
                <div className="p-4 sm:p-8">
                  {serverDown ? (
                    // Server down fallback UI
                    <>
                      <div className="flex items-center justify-center gap-3 mb-8">
                        <h1 className="text-lg font-display text-retro-accent whitespace-nowrap">
                          Server's Down
                        </h1>
                      </div>
                      
                      <div className="mb-6 text-center">
                        <p className="font-mono text-retro-accent/80 text-sm mb-4">
                          We're having technical difficulties.
                        </p>
                        <p className="font-mono text-retro-accent/60 text-xs mb-3">
                          Come back later.
                        </p>
                        <p className="font-mono text-retro-accent/60 text-xs">
                          For questions of the heart, contact the person who nominated you.
                        </p>
                      </div>

                      <button
                        onClick={() => {
                          setServerDown(false);
                          setError(null);
                        }}
                        className="w-full font-mono text-retro-accent/60 text-sm hover:text-retro-accent underline"
                      >
                        ← try login again
                      </button>
                    </>
                  ) : (
                    // Original login UI
                    <>
                      <div className="flex items-center justify-center mb-8">
                        <h1 className="text-2xl whitespace-nowrap" style={{ fontFamily: 'var(--castle-font-primary)', color: 'var(--castle-text-accent)' }}>
                          Enter The Castle
                        </h1>
                      </div>

                      <form onSubmit={otpSent ? handleVerifyOtp : handleSendOtp} className="space-y-4">
                        <div className="w-full">
                          <div className={`relative w-full ${ (error || success) ? 'mb-3' : '' }`}>
                            <input
                              type="email"
                              id="email-input"
                              name="email"
                              list="email-list"
                              value={email}
                              onChange={(e) => setEmail(e.target.value.trim())}
                              className="castle-input w-full min-w-[200px]"
                              style={{
                                clipPath: `polygon(
                                  0 4px, 4px 4px, 4px 0,
                                  calc(100% - 4px) 0, calc(100% - 4px) 4px, 100% 4px,
                                  100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px),
                                  calc(100% - 4px) 100%, 4px 100%, 4px calc(100% - 4px),
                                  0 calc(100% - 4px)
                                )`
                              }}
                              placeholder="email"
                              required
                              autoComplete="email"
                              spellCheck="false"
                              disabled={otpSent || isLoading}
                            />
                          </div>
                        </div>

                        {otpSent && (
                          <div>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              id="otp-input"
                              name="otp"
                              value={otp}
                              onChange={(e) => setOtp(e.target.value.trim())}
                              placeholder="Enter code"
                              required
                              disabled={isLoading}
                              className="castle-input w-full min-w-[200px] mt-2"
                              style={{
                                clipPath: `polygon(
                                  0 4px, 4px 4px, 4px 0,
                                  calc(100% - 4px) 0, calc(100% - 4px) 4px, 100% 4px,
                                  100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px),
                                  calc(100% - 4px) 100%, 4px 100%, 4px calc(100% - 4px),
                                  0 calc(100% - 4px)
                                )`
                              }}
                            />
                          </div>
                        )}

                        {error && (
                          <div className="font-mono text-red-500 text-sm">
                            {error}
                          </div>
                        )}

                        {success && (
                          <div className="font-mono text-retro-accent text-sm w-full whitespace-pre-wrap">
                            {success}
                          </div>
                        )}

                        <button
                          type="submit"
                          disabled={isLoading}
                          className="castle-btn primary w-full"
                          style={{
                            clipPath: `polygon(
                              0 4px, 4px 4px, 4px 0,
                              calc(100% - 4px) 0, calc(100% - 4px) 4px, 100% 4px,
                              100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px),
                              calc(100% - 4px) 100%, 4px 100%, 4px calc(100% - 4px),
                              0 calc(100% - 4px)
                            )`
                          }}
                        >
                          {isLoading ? (otpSent ? 'verifying...' : 'sending...') : (otpSent ? 'verify code' : 'send code')}
                        </button>
                      </form>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

