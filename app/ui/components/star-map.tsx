"use client";

import { CelestialSphere } from "./celestial-sphere";

export function StarMap({
  originId,
  destinationId,
  running,
  completedDistanceLightYears,
  totalDistanceLightYears,
}: {
  originId: string;
  destinationId: string;
  running: boolean;
  completedDistanceLightYears: number;
  totalDistanceLightYears: number;
}) {
  return (
    <CelestialSphere
      originId={originId}
      destinationId={destinationId}
      running={running}
      completedDistanceLightYears={completedDistanceLightYears}
      totalDistanceLightYears={totalDistanceLightYears}
    />
  );
}
