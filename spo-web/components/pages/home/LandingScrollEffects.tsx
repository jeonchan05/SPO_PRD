"use client";

import { useEffect } from "react";

export function LandingScrollEffects() {
  useEffect(() => {
    document.documentElement.classList.add("landing-snap-scroll");
    document.body.classList.add("landing-snap-scroll");

    return () => {
      document.documentElement.classList.remove("landing-snap-scroll");
      document.body.classList.remove("landing-snap-scroll");
    };
  }, []);

  return null;
}
