// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Speaks a message when it changes, for things that happen without a tap.
 *
 * A batch converting is the case this exists for. The progress bar updates ten times a
 * second and the screen reader says nothing, because nothing was focused and nothing was
 * pressed — so a blind user starts a conversion and then has no idea whether it is
 * running, finished, or failed. `accessibilityLiveRegion` covers this on Android and does
 * nothing on iOS, where an explicit announcement is the only mechanism.
 *
 * Announces on change only. Repeating the same sentence on every render would talk over
 * the user continuously, which is worse than silence.
 */
export function useAnnouncement(message: string | null): void {
  const spoken = useRef<string | null>(null);

  useEffect(() => {
    if (!message || message === spoken.current) return;
    spoken.current = message;

    // Android gets this from the live region on the view itself; announcing here too
    // would say it twice.
    if (Platform.OS !== 'ios') return;
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
}
