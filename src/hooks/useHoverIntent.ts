"use client";

import * as React from "react";

type HoverIntentDelays = {
  enter: number;
  leave: number;
};

export function useHoverIntent(
  isHovering: boolean,
  onIntent: (shouldOpen: boolean) => void,
  delays: HoverIntentDelays = { enter: 80, leave: 200 }
) {
  const enterTimeoutRef = React.useRef<number | null>(null);
  const leaveTimeoutRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (isHovering) {
      if (leaveTimeoutRef.current) {
        window.clearTimeout(leaveTimeoutRef.current);
        leaveTimeoutRef.current = null;
      }
      enterTimeoutRef.current = window.setTimeout(() => onIntent(true), delays.enter);
    } else {
      if (enterTimeoutRef.current) {
        window.clearTimeout(enterTimeoutRef.current);
        enterTimeoutRef.current = null;
      }
      leaveTimeoutRef.current = window.setTimeout(() => onIntent(false), delays.leave);
    }

    return () => {
      if (enterTimeoutRef.current) {
        window.clearTimeout(enterTimeoutRef.current);
        enterTimeoutRef.current = null;
      }
      if (leaveTimeoutRef.current) {
        window.clearTimeout(leaveTimeoutRef.current);
        leaveTimeoutRef.current = null;
      }
    };
  }, [isHovering, onIntent, delays.enter, delays.leave]);
}



