"use client";

import { useEffect, useRef } from "react";
import { STAR_SYSTEMS } from "../constants";

export function StarMap({
  originId,
  destinationId,
  running,
}: {
  originId: string;
  destinationId: string;
  running: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
      canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, bounds.width, bounds.height);

      const gradient = context.createRadialGradient(
        bounds.width * 0.56,
        bounds.height * 0.46,
        10,
        bounds.width * 0.56,
        bounds.height * 0.46,
        bounds.width * 0.72,
      );
      gradient.addColorStop(0, "rgba(27, 47, 54, 0.34)");
      gradient.addColorStop(1, "rgba(4, 9, 12, 0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, bounds.width, bounds.height);

      for (let index = 0; index < 92; index += 1) {
        const x = ((index * 79) % 997) / 997;
        const y = ((index * 131 + 17) % 991) / 991;
        const alpha = 0.18 + ((index * 17) % 48) / 100;
        context.fillStyle = `rgba(205, 224, 221, ${alpha})`;
        context.fillRect(
          x * bounds.width,
          y * bounds.height,
          index % 11 === 0 ? 1.6 : 0.8,
          index % 11 === 0 ? 1.6 : 0.8,
        );
      }

      const originIndex = STAR_SYSTEMS.findIndex(
        (system) => system.id === originId,
      );
      const destinationIndex = STAR_SYSTEMS.findIndex(
        (system) => system.id === destinationId,
      );
      const start = Math.min(originIndex, destinationIndex);
      const end = Math.max(originIndex, destinationIndex);
      const route = STAR_SYSTEMS.slice(start, end + 1);

      context.lineWidth = 1;
      context.setLineDash([6, 9]);
      context.strokeStyle = running
        ? "rgba(235, 177, 77, 0.72)"
        : "rgba(121, 182, 183, 0.42)";
      context.beginPath();
      route.forEach((system, index) => {
        const x = (system.x / 100) * bounds.width;
        const y = (system.y / 100) * bounds.height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
      context.setLineDash([]);

      STAR_SYSTEMS.forEach((system) => {
        const x = (system.x / 100) * bounds.width;
        const y = (system.y / 100) * bounds.height;
        const selected =
          system.id === originId || system.id === destinationId;
        context.beginPath();
        context.arc(x, y, selected ? 4.5 : 2.5, 0, Math.PI * 2);
        context.fillStyle = selected ? "#eab34f" : "#9cc3c2";
        context.fill();
        if (selected) {
          context.beginPath();
          context.arc(x, y, 10, 0, Math.PI * 2);
          context.strokeStyle = "rgba(234, 179, 79, 0.4)";
          context.stroke();
        }
        context.font = selected
          ? '600 11px "Microsoft YaHei", sans-serif'
          : '400 10px "Microsoft YaHei", sans-serif';
        context.fillStyle = selected
          ? "rgba(244, 224, 181, 0.92)"
          : "rgba(160, 184, 182, 0.7)";
        context.fillText(system.name, x + 10, y - 8);
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [destinationId, originId, running]);

  return (
    <canvas
      ref={canvasRef}
      className="star-map"
      aria-label="星际航路图"
    />
  );
}
