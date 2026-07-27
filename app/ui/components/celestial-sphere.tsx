"use client";

import { useEffect, useRef, useState } from "react";
import {
  STAR_CATALOG,
  starPositionLy,
  type StarPositionLy,
} from "@/lib/astro/star-catalog";
import styles from "./celestial-sphere.module.css";

const BACKGROUND_STAR_COUNT = 420;
/** 背景星场固定种子：非星表填充，挂载间保持确定性 */
const BACKGROUND_SEED = 0x5a17c3e1;

type CelestialSphereProps = {
  originId: string;
  destinationId: string;
  running: boolean;
  completedDistanceLightYears: number;
  totalDistanceLightYears: number;
};

type NamedStarRuntime = {
  id: string;
  nameZh: string;
  position: StarPositionLy;
  distanceFromSolLy: number;
  mesh: import("three").Mesh;
  glow: import("three").Mesh;
  label: HTMLSpanElement;
};

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = Math.imul(state ^ (state >>> 15), 1 | state);
    next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function lerpPosition(
  from: StarPositionLy,
  to: StarPositionLy,
  t: number,
): StarPositionLy {
  return {
    xLy: from.xLy + (to.xLy - from.xLy) * t,
    yLy: from.yLy + (to.yLy - from.yLy) * t,
    zLy: from.zLy + (to.zLy - from.zLy) * t,
  };
}

/** 沿起点→终点直线，按已完成航程 / 总航程插值日心位置；总距无效时停在起点 */
function shipHeliocentricPosition(
  origin: StarPositionLy,
  destination: StarPositionLy,
  completedDistanceLightYears: number,
  totalDistanceLightYears: number,
): StarPositionLy {
  const span = Math.max(totalDistanceLightYears, 0);
  if (span <= 0) return { ...origin };
  const t = Math.min(1, Math.max(0, completedDistanceLightYears / span));
  return lerpPosition(origin, destination, t);
}

export function CelestialSphere({
  originId,
  destinationId,
  running,
  completedDistanceLightYears,
  totalDistanceLightYears,
}: CelestialSphereProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({
    originId,
    destinationId,
    running,
    completedDistanceLightYears,
    totalDistanceLightYears,
  });
  const [webglFailed, setWebglFailed] = useState(false);

  useEffect(() => {
    propsRef.current = {
      originId,
      destinationId,
      running,
      completedDistanceLightYears,
      totalDistanceLightYears,
    };
  }, [
    originId,
    destinationId,
    running,
    completedDistanceLightYears,
    totalDistanceLightYears,
  ]);

  useEffect(() => {
    const host = hostRef.current;
    const labelsHost = labelsRef.current;
    if (!host || !labelsHost) return;

    let disposed = false;
    let frameId = 0;
    let renderer: import("three").WebGLRenderer | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let motionQuery: MediaQueryList | null = null;
    let onMotionChange: (() => void) | null = null;
    let scene: import("three").Scene | null = null;
    const disposables: Array<{ dispose: () => void }> = [];
    const labelNodes: HTMLSpanElement[] = [];

    const track = <T extends { dispose: () => void }>(resource: T): T => {
      disposables.push(resource);
      return resource;
    };

    void (async () => {
      const THREE = await import("three");
      if (disposed) return;

      try {
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          powerPreference: "default",
        });
      } catch {
        if (!disposed) setWebglFailed(true);
        return;
      }

      if (!renderer.getContext()) {
        renderer.dispose();
        renderer = null;
        if (!disposed) setWebglFailed(true);
        return;
      }

      if (disposed) {
        renderer.dispose();
        renderer = null;
        return;
      }

      const activeScene = new THREE.Scene();
      scene = activeScene;
      const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 800);
      camera.position.set(0, 0, 0);

      const cyan = new THREE.Color(readCssVar("--cyan", "#7ec4c0"));
      const cyanBright = new THREE.Color(readCssVar("--cyan-bright", "#b7e4e0"));
      const amber = new THREE.Color(readCssVar("--amber", "#d9a441"));
      const amberPale = new THREE.Color(readCssVar("--amber-pale", "#f0d391"));
      const voidColor = new THREE.Color(readCssVar("--void", "#020508"));
      const dim = new THREE.Color(readCssVar("--dim", "#5f7278"));

      renderer.setClearColor(voidColor, 0);
      renderer.domElement.setAttribute("aria-hidden", "true");
      host.appendChild(renderer.domElement);

      const namedStarGeo = track(new THREE.SphereGeometry(1, 12, 12));
      const glowGeo = track(new THREE.SphereGeometry(1, 8, 8));
      const namedStars: NamedStarRuntime[] = STAR_CATALOG.map((entry) => {
        const material = track(
          new THREE.MeshBasicMaterial({
            color: cyanBright,
            transparent: true,
            opacity: 0.92,
            depthWrite: false,
          }),
        );
        const glowMaterial = track(
          new THREE.MeshBasicMaterial({
            color: cyan,
            transparent: true,
            opacity: 0.22,
            depthWrite: false,
          }),
        );
        const mesh = new THREE.Mesh(namedStarGeo, material);
        const glow = new THREE.Mesh(glowGeo, glowMaterial);
        activeScene.add(mesh);
        activeScene.add(glow);

        const label = document.createElement("span");
        label.className = styles.label;
        label.textContent = entry.nameZh;
        labelsHost.appendChild(label);
        labelNodes.push(label);

        return {
          id: entry.id,
          nameZh: entry.nameZh,
          position: entry.position,
          distanceFromSolLy: entry.distanceFromSolLy,
          mesh,
          glow,
          label,
        };
      });

      const random = mulberry32(BACKGROUND_SEED);
      const bgPositions = new Float32Array(BACKGROUND_STAR_COUNT * 3);
      const bgColors = new Float32Array(BACKGROUND_STAR_COUNT * 3);
      const bgHeliocentric: StarPositionLy[] = [];
      for (let index = 0; index < BACKGROUND_STAR_COUNT; index += 1) {
        const u = random();
        const v = random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        const distance = 55 + random() * 320;
        const x = distance * Math.sin(phi) * Math.cos(theta);
        const y = distance * Math.sin(phi) * Math.sin(theta);
        const z = distance * Math.cos(phi);
        bgHeliocentric.push({ xLy: x, yLy: y, zLy: z });
        const shade = 0.35 + random() * 0.55;
        bgColors[index * 3] = dim.r * shade + cyan.r * (1 - shade) * 0.2;
        bgColors[index * 3 + 1] = dim.g * shade + cyan.g * (1 - shade) * 0.2;
        bgColors[index * 3 + 2] = dim.b * shade + cyan.b * (1 - shade) * 0.2;
      }
      const bgGeometry = track(new THREE.BufferGeometry());
      bgGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(bgPositions, 3),
      );
      bgGeometry.setAttribute("color", new THREE.BufferAttribute(bgColors, 3));
      const bgMaterial = track(
        new THREE.PointsMaterial({
          size: 0.35,
          sizeAttenuation: true,
          vertexColors: true,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
        }),
      );
      const backgroundPoints = new THREE.Points(bgGeometry, bgMaterial);
      activeScene.add(backgroundPoints);

      const routePositions = new Float32Array(6);
      const routeGeometry = track(new THREE.BufferGeometry());
      routeGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(routePositions, 3),
      );
      const routeMaterial = track(
        new THREE.LineBasicMaterial({
          color: amber,
          transparent: true,
          opacity: 0.55,
        }),
      );
      const routeLine = new THREE.Line(routeGeometry, routeMaterial);
      activeScene.add(routeLine);

      const traveledPositions = new Float32Array(6);
      const traveledGeometry = track(new THREE.BufferGeometry());
      traveledGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(traveledPositions, 3),
      );
      const traveledMaterial = track(
        new THREE.LineBasicMaterial({
          color: cyan,
          transparent: true,
          opacity: 0.72,
        }),
      );
      const traveledLine = new THREE.Line(traveledGeometry, traveledMaterial);
      activeScene.add(traveledLine);

      const headingPositions = new Float32Array(6);
      const headingGeometry = track(new THREE.BufferGeometry());
      headingGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(headingPositions, 3),
      );
      const headingMaterial = track(
        new THREE.LineDashedMaterial({
          color: amberPale,
          transparent: true,
          opacity: 0.42,
          dashSize: 0.35,
          gapSize: 0.22,
        }),
      );
      const headingLine = new THREE.Line(headingGeometry, headingMaterial);
      activeScene.add(headingLine);

      const targetRingGeo = track(new THREE.RingGeometry(1.2, 1.55, 40));
      const targetRingMat = track(
        new THREE.MeshBasicMaterial({
          color: amber,
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      const targetRing = new THREE.Mesh(targetRingGeo, targetRingMat);
      activeScene.add(targetRing);

      const scratchShip = new THREE.Vector3();
      const scratchStar = new THREE.Vector3();
      const scratchRel = new THREE.Vector3();
      const scratchOrigin = new THREE.Vector3();
      const scratchDest = new THREE.Vector3();
      const scratchForward = new THREE.Vector3();
      const scratchLook = new THREE.Vector3();
      const scratchNdc = new THREE.Vector3();
      let basisForward = new THREE.Vector3(0, 1, 0);
      let basisUp = new THREE.Vector3(0, 0, 1);
      let basisRight = new THREE.Vector3(1, 0, 0);
      let driftAngle = 0;
      let lastRouteKey = "";
      let reduceMotion = false;

      const buildCameraBasis = (forward: import("three").Vector3) => {
        const unitForward = forward.clone().normalize();
        let upHint = new THREE.Vector3(0, 0, 1);
        if (Math.abs(unitForward.dot(upHint)) > 0.92) {
          upHint = new THREE.Vector3(0, 1, 0);
        }
        const right = new THREE.Vector3()
          .crossVectors(unitForward, upHint)
          .normalize();
        const up = new THREE.Vector3().crossVectors(right, unitForward).normalize();
        return { forward: unitForward, right, up };
      };

      onMotionChange = () => {
        reduceMotion = motionQuery?.matches ?? false;
      };
      motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      reduceMotion = motionQuery.matches;
      motionQuery.addEventListener("change", onMotionChange);

      const resize = () => {
        if (!renderer) return;
        const bounds = host.getBoundingClientRect();
        const width = Math.max(1, bounds.width);
        const height = Math.max(1, bounds.height);
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        renderer.setPixelRatio(ratio);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };

      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      resize();

      const projectLabel = (
        world: import("three").Vector3,
        label: HTMLSpanElement,
        isTarget: boolean,
        isOrigin: boolean,
      ) => {
        scratchNdc.copy(world).project(camera);
        const inFront = scratchNdc.z > -1 && scratchNdc.z < 1;
        const onScreen =
          scratchNdc.x > -1.2 &&
          scratchNdc.x < 1.2 &&
          scratchNdc.y > -1.2 &&
          scratchNdc.y < 1.2;
        if (!inFront || !onScreen) {
          label.style.visibility = "hidden";
          return;
        }
        const bounds = host.getBoundingClientRect();
        const x = (scratchNdc.x * 0.5 + 0.5) * bounds.width;
        const y = (-scratchNdc.y * 0.5 + 0.5) * bounds.height;
        label.style.visibility = "visible";
        label.style.transform = `translate(${x + 10}px, ${y}px) translateY(-50%)`;
        if (isTarget) {
          label.className = `${styles.label} ${styles.labelTarget}`;
        } else if (isOrigin) {
          label.className = `${styles.label} ${styles.labelOrigin}`;
        } else {
          label.className = styles.label;
        }
      };

      const syncScene = (nowMs: number) => {
        if (!renderer) return;
        const current = propsRef.current;
        let originPos: StarPositionLy;
        let destinationPos: StarPositionLy;
        try {
          originPos = starPositionLy(current.originId);
          destinationPos = starPositionLy(current.destinationId);
        } catch {
          originPos = STAR_CATALOG[0].position;
          destinationPos = STAR_CATALOG[STAR_CATALOG.length - 1].position;
        }

        const shipPos = shipHeliocentricPosition(
          originPos,
          destinationPos,
          current.completedDistanceLightYears,
          current.totalDistanceLightYears,
        );
        scratchShip.set(shipPos.xLy, shipPos.yLy, shipPos.zLy);
        scratchOrigin
          .set(originPos.xLy, originPos.yLy, originPos.zLy)
          .sub(scratchShip);
        scratchDest
          .set(destinationPos.xLy, destinationPos.yLy, destinationPos.zLy)
          .sub(scratchShip);
        scratchForward.copy(scratchDest).sub(scratchOrigin);
        if (scratchForward.lengthSq() < 1e-12) {
          scratchForward.set(0, 1, 0);
        }
        const basis = buildCameraBasis(scratchForward);
        basisForward = basis.forward;
        basisRight = basis.right;
        basisUp = basis.up;

        const routeKey = `${current.originId}|${current.destinationId}`;
        if (routeKey !== lastRouteKey) {
          lastRouteKey = routeKey;
          driftAngle = 0;
        }

        if (!reduceMotion && current.running) {
          driftAngle += 0.00032;
        }

        const yaw = reduceMotion ? 0 : driftAngle;
        scratchLook
          .copy(basisForward)
          .multiplyScalar(Math.cos(yaw))
          .addScaledVector(basisRight, Math.sin(yaw));
        camera.up.copy(basisUp);
        camera.lookAt(scratchLook);

        for (let index = 0; index < BACKGROUND_STAR_COUNT; index += 1) {
          const heliocentric = bgHeliocentric[index];
          bgPositions[index * 3] = heliocentric.xLy - shipPos.xLy;
          bgPositions[index * 3 + 1] = heliocentric.yLy - shipPos.yLy;
          bgPositions[index * 3 + 2] = heliocentric.zLy - shipPos.zLy;
        }
        bgGeometry.attributes.position.needsUpdate = true;

        routePositions[0] = scratchOrigin.x;
        routePositions[1] = scratchOrigin.y;
        routePositions[2] = scratchOrigin.z;
        routePositions[3] = scratchDest.x;
        routePositions[4] = scratchDest.y;
        routePositions[5] = scratchDest.z;
        routeGeometry.attributes.position.needsUpdate = true;

        traveledPositions[0] = scratchOrigin.x;
        traveledPositions[1] = scratchOrigin.y;
        traveledPositions[2] = scratchOrigin.z;
        traveledPositions[3] = 0;
        traveledPositions[4] = 0;
        traveledPositions[5] = 0;
        traveledGeometry.attributes.position.needsUpdate = true;

        headingPositions[0] = 0;
        headingPositions[1] = 0;
        headingPositions[2] = 0;
        headingPositions[3] = scratchDest.x;
        headingPositions[4] = scratchDest.y;
        headingPositions[5] = scratchDest.z;
        headingGeometry.attributes.position.needsUpdate = true;
        headingLine.computeLineDistances();

        routeMaterial.opacity = current.running ? 0.62 : 0.38;
        traveledMaterial.opacity = current.running ? 0.8 : 0.45;

        let targetRelative: import("three").Vector3 | null = null;

        for (const star of namedStars) {
          // r_rel = r_star − r_ship（光年）；相机在原点，近星方向随航程变化即视差
          scratchStar
            .set(star.position.xLy, star.position.yLy, star.position.zLy)
            .sub(scratchShip);
          const relativeLy = scratchStar.length();
          const isOrigin = star.id === current.originId;
          const isTarget = star.id === current.destinationId;

          if (relativeLy < 0.04) {
            star.mesh.visible = false;
            star.glow.visible = false;
            star.label.style.visibility = "hidden";
            continue;
          }

          scratchRel.copy(scratchStar);
          star.mesh.position.copy(scratchRel);
          star.glow.position.copy(scratchRel);

          const intrinsic =
            0.035 +
            0.09 / (star.distanceFromSolLy + 0.8) +
            (isTarget ? 0.04 : 0);
          star.mesh.scale.setScalar(intrinsic);
          star.glow.scale.setScalar(intrinsic * (isTarget ? 3.4 : 2.5));
          star.mesh.visible = true;
          star.glow.visible = true;

          const material = star.mesh.material;
          const glowMaterial = star.glow.material;
          if (
            !(material instanceof THREE.MeshBasicMaterial) ||
            !(glowMaterial instanceof THREE.MeshBasicMaterial)
          ) {
            continue;
          }

          if (isTarget) {
            material.color.copy(amberPale);
            glowMaterial.color.copy(amber);
            glowMaterial.opacity = 0.36;
            targetRelative = scratchRel.clone();
          } else if (isOrigin) {
            material.color.copy(cyanBright);
            glowMaterial.color.copy(cyan);
            glowMaterial.opacity = 0.24;
          } else {
            material.color.copy(cyanBright);
            glowMaterial.color.copy(cyan);
            glowMaterial.opacity = 0.14 + 0.2 / (relativeLy + 0.5);
          }
          material.opacity = Math.min(0.98, 0.5 + 0.45 / (relativeLy + 0.4));

          projectLabel(scratchRel, star.label, isTarget, isOrigin);
        }

        if (targetRelative) {
          targetRing.visible = true;
          targetRing.position.copy(targetRelative);
          const ringScale = Math.max(0.08, targetRelative.length() * 0.035);
          const pulse = reduceMotion
            ? 1
            : 1 + Math.sin(nowMs * 0.0024) * 0.05;
          targetRing.scale.setScalar(ringScale * pulse);
          targetRing.lookAt(0, 0, 0);
        } else {
          targetRing.visible = false;
        }

        renderer.render(activeScene, camera);
      };

      const animate = (nowMs: number) => {
        if (disposed) return;
        frameId = window.requestAnimationFrame(animate);
        syncScene(nowMs);
      };
      frameId = window.requestAnimationFrame(animate);
    })();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      if (motionQuery && onMotionChange) {
        motionQuery.removeEventListener("change", onMotionChange);
      }
      for (const label of labelNodes) {
        label.remove();
      }
      if (scene) {
        while (scene.children.length > 0) {
          scene.remove(scene.children[0]);
        }
      }
      for (const resource of disposables) {
        resource.dispose();
      }
      if (renderer) {
        renderer.dispose();
        if (renderer.domElement.parentElement === host) {
          host.removeChild(renderer.domElement);
        }
      }
    };
  }, []);

  if (webglFailed) {
    return (
      <div className={`star-map ${styles.fallback}`} aria-label="前向天球">
        <p className="offline-mark">WebGL 不可用 · 天球未联机</p>
      </div>
    );
  }

  return (
    <div
      className={`star-map ${styles.root}`}
      aria-label="前向天球 · 日心航路投影"
    >
      <div ref={hostRef} className={styles.canvasHost} />
      <div ref={labelsRef} className={styles.labels} />
    </div>
  );
}
