// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Speaks a message when it changes, for things that happen without a tap.
 *
 * A batch converting is the case this exists for. The progress bar updates ten times a
 * second and the screen reader says nothing, because nothing was focused and nothing was
 * pressed — so a blind user starts a conversion and then has no idea whether it is
 * running, finished, or failed.
 *
 * Announces on change only. Repeating the same sentence on every render would talk over
 * the user continuously, which is worse than silence.
 */
export function useAnnouncement(message: string | null): void {
  const spoken = useRef<string | null>(null);

  useEffect(() => {
    if (!message || message === spoken.current) return;
    spoken.current = message;

    // Both platforms: none of these outcomes has a live region, so TalkBack said nothing.
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
}
