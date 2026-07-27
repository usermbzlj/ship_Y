"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { CompartmentZoneTelemetry } from "@/lib/sim/protocol";
import type { ZoneRole } from "@/lib/sim/compartments";
import { ZONE_ROLE_LABELS_ZH } from "@/lib/sim/compartments";
import {
  SHIP_DESIGN_LENGTH_M,
  SHIP_DESIGN_MAX_DIAMETER_M,
  SHIP_DESIGN_RING_RADIUS_M,
} from "../constants";
import styles from "./hull-section.module.css";

type ZoneTelemetry = CompartmentZoneTelemetry;

/** PRODUCT_SPEC §5.2 → scene units (1 unit = 100 m). */
const M_PER_UNIT = 100;
const SHIP_LENGTH_M = SHIP_DESIGN_LENGTH_M;
const MAX_DIAMETER_M = SHIP_DESIGN_MAX_DIAMETER_M;
const RING_RADIUS_M = SHIP_DESIGN_RING_RADIUS_M;

const SHIP_LENGTH = SHIP_LENGTH_M / M_PER_UNIT;
const RING_RADIUS = RING_RADIUS_M / M_PER_UNIT;
const MAX_RADIUS = MAX_DIAMETER_M / M_PER_UNIT / 2;
const SPINE_RADIUS = 0.22;
const RING_TUBE = 0.14;
const RING_A_X = 1.35;
const RING_B_X = -1.35;
const SHIELD_X = SHIP_LENGTH / 2 - 0.55;
const ENGINE_X = -(SHIP_LENGTH / 2 - 0.85);

type ConditionColorKey = "nominal" | "watch" | "critical" | "offline";

interface ThemeColors {
  nominal: string;
  watch: string;
  critical: string;
  offline: string;
  selected: string;
  structure: string;
  structureDim: string;
  void: string;
}

interface HoverInfo {
  zone: ZoneTelemetry;
  left: number;
  top: number;
}

function formatPa(value: number | null, digits = 2): string {
  return value === null ? "未联机" : `${(value / 1_000).toFixed(digits)} kPa`;
}

function formatTemp(value: number | null): string {
  return value === null ? "未联机" : `${value.toFixed(1)} K`;
}

function conditionLabel(condition: ZoneTelemetry["condition"]): string {
  switch (condition) {
    case "critical":
      return "危险";
    case "watch":
      return "关注";
    case "offline":
      return "离线";
    default:
      return "名义";
  }
}

function roleLabel(role: string): string {
  if (role in ZONE_ROLE_LABELS_ZH) {
    return ZONE_ROLE_LABELS_ZH[role as ZoneRole];
  }
  return role || "—";
}

function zoneIndex(zoneId: string): number {
  const match = /-(\d+)$/.exec(zoneId);
  return match ? Number(match[1]) : 1;
}

/**
 * Zone angular layout: catalog index 1–24 walks the ring circumference.
 * Roles are contiguous blocks (living → … → access); access sits nearest
 * the spoke/hub orientation (angle ≈ π toward -Y for visual “spoke down”).
 */
function zoneAngle(zoneId: string): number {
  const index = zoneIndex(zoneId);
  return ((index - 1) / 24) * Math.PI * 2 - Math.PI / 2;
}

function ringX(ring: "A" | "B"): number {
  return ring === "A" ? RING_A_X : RING_B_X;
}

function readTheme(el: HTMLElement): ThemeColors {
  const cs = getComputedStyle(el);
  return {
    nominal: cs.getPropertyValue("--green").trim() || "#6fba9a",
    watch: cs.getPropertyValue("--amber").trim() || "#d9a441",
    critical: cs.getPropertyValue("--danger").trim() || "#d45a4c",
    offline: cs.getPropertyValue("--dim").trim() || "#5f7278",
    selected: cs.getPropertyValue("--cyan-bright").trim() || "#b7e4e0",
    structure: cs.getPropertyValue("--cyan-deep").trim() || "#2a6b68",
    structureDim: cs.getPropertyValue("--line").trim() || "#1e2c32",
    void: cs.getPropertyValue("--void").trim() || "#020508",
  };
}

function conditionColor(
  colors: ThemeColors,
  condition: ZoneTelemetry["condition"],
): string {
  const key = condition as ConditionColorKey;
  if (key === "watch" || key === "critical" || key === "offline") {
    return colors[key];
  }
  return colors.nominal;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.trim().replace("#", "");
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return {
      r: parseInt(cleaned.slice(0, 2), 16) / 255,
      g: parseInt(cleaned.slice(2, 4), 16) / 255,
      b: parseInt(cleaned.slice(4, 6), 16) / 255,
    };
  }
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    return {
      r: parseInt(cleaned[0]! + cleaned[0]!, 16) / 255,
      g: parseInt(cleaned[1]! + cleaned[1]!, 16) / 255,
      b: parseInt(cleaned[2]! + cleaned[2]!, 16) / 255,
    };
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(hex);
  if (rgb) {
    return {
      r: Number(rgb[1]) / 255,
      g: Number(rgb[2]) / 255,
      b: Number(rgb[3]) / 255,
    };
  }
  return null;
}

export function HullSection({
  zones,
  selectedZoneId,
  onSelectZone,
  focusPulse = false,
}: {
  zones: ZoneTelemetry[];
  selectedZoneId: string;
  onSelectZone: (zoneId: string) => void;
  focusPulse?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const zonesRef = useRef(zones);
  const selectedRef = useRef(selectedZoneId);
  const focusPulseRef = useRef(focusPulse);
  const onSelectRef = useRef(onSelectZone);

  const [webglFailed, setWebglFailed] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  useEffect(() => {
    zonesRef.current = zones;
    selectedRef.current = selectedZoneId;
    focusPulseRef.current = focusPulse;
    onSelectRef.current = onSelectZone;
  }, [zones, selectedZoneId, focusPulse, onSelectZone]);

  useEffect(() => {
    const host = hostRef.current;
    const root = rootRef.current;
    if (!host || !root) return;

    let disposed = false;
    let raf = 0;
    let THREE: typeof import("three") | null = null;
    let renderer: import("three").WebGLRenderer | null = null;
    let scene: import("three").Scene | null = null;
    let camera: import("three").PerspectiveCamera | null = null;
    let shipGroup: import("three").Group | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let motionQuery: MediaQueryList | null = null;
    let allowSpin = true;
    const disposables: Array<{ dispose: () => void }> = [];
    const zoneMeshes = new Map<string, import("three").Mesh>();
    let raycaster: import("three").Raycaster | null = null;
    const pointer = { x: 0, y: 0 };

    const track = <T extends { dispose: () => void }>(obj: T): T => {
      disposables.push(obj);
      return obj;
    };

    const onMotionChange = () => {
      allowSpin = !(motionQuery?.matches ?? false);
    };

    const setSize = () => {
      if (!renderer || !camera || !host) return;
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const syncZoneMaterials = (colors: ThemeColors, elapsed: number) => {
      for (const zone of zonesRef.current) {
        const mesh = zoneMeshes.get(zone.zoneId);
        if (!mesh) continue;
        const material = mesh.material as import("three").MeshStandardMaterial;
        const selected = zone.zoneId === selectedRef.current;
        let colorHex = conditionColor(colors, zone.condition);
        if (selected) colorHex = colors.selected;
        const rgb = hexToRgb(colorHex);
        if (rgb) material.color.setRGB(rgb.r, rgb.g, rgb.b);

        material.emissiveIntensity = 0.15;
        material.opacity = zone.condition === "offline" ? 0.35 : 0.92;
        material.transparent = true;
        material.wireframe = zone.condition === "offline";

        if (zone.hasBreach) {
          const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(elapsed * 4.2));
          const breachRgb = hexToRgb(colors.critical);
          if (breachRgb) {
            material.emissive.setRGB(breachRgb.r, breachRgb.g, breachRgb.b);
          }
          material.emissiveIntensity = pulse;
          mesh.scale.setScalar(1.15 + pulse * 0.2);
        } else if (selected && focusPulseRef.current) {
          const pulse = 0.5 + 0.5 * Math.sin(elapsed * 8);
          material.emissiveIntensity = 0.2 + pulse * 0.55;
          mesh.scale.setScalar(1.08 + pulse * 0.08);
          const selRgb = hexToRgb(colors.selected);
          if (selRgb) material.emissive.setRGB(selRgb.r, selRgb.g, selRgb.b);
        } else if (selected) {
          const selRgb = hexToRgb(colors.selected);
          if (selRgb) material.emissive.setRGB(selRgb.r, selRgb.g, selRgb.b);
          material.emissiveIntensity = 0.45;
          mesh.scale.setScalar(1.12);
        } else {
          material.emissive.setRGB(0, 0, 0);
          mesh.scale.setScalar(1);
        }

        mesh.userData.zoneId = zone.zoneId;
      }
    };

    const pickZone = (
      clientX: number,
      clientY: number,
    ): ZoneTelemetry | null => {
      if (!THREE || !renderer || !camera || !raycaster) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(pointer.x, pointer.y), camera);
      const hits = raycaster.intersectObjects([...zoneMeshes.values()], false);
      const zoneId = hits[0]?.object.userData.zoneId as string | undefined;
      if (!zoneId) return null;
      return zonesRef.current.find((z) => z.zoneId === zoneId) ?? null;
    };

    const onPointerMove = (event: PointerEvent) => {
      const zone = pickZone(event.clientX, event.clientY);
      if (zone) {
        host.style.cursor = "pointer";
        const rect = host.getBoundingClientRect();
        const left = Math.min(
          Math.max(12, event.clientX - rect.left + 14),
          rect.width - 200,
        );
        const top = Math.min(
          Math.max(12, event.clientY - rect.top + 14),
          rect.height - 140,
        );
        setHover({ zone, left, top });
      } else {
        host.style.cursor = "default";
        setHover(null);
      }
    };

    const onPointerLeave = () => {
      host.style.cursor = "default";
      setHover(null);
    };

    const onClick = (event: MouseEvent) => {
      const zone = pickZone(event.clientX, event.clientY);
      if (zone) onSelectRef.current(zone.zoneId);
    };

    void (async () => {
      const threeMod = await import("three");
      if (disposed) return;
      THREE = threeMod;

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

      if (disposed) {
        renderer.dispose();
        return;
      }

      const colors = readTheme(root);
      renderer.setClearColor(new THREE.Color(colors.void), 0);
      renderer.domElement.setAttribute("aria-hidden", "true");
      host.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
      camera.position.set(6.8, 3.6, 7.4);
      camera.lookAt(0, 0, 0);

      raycaster = new THREE.Raycaster();
      shipGroup = new THREE.Group();
      scene.add(shipGroup);

      const ambient = new THREE.AmbientLight(0xffffff, 0.55);
      const key = new THREE.DirectionalLight(0xffffff, 0.85);
      key.position.set(4, 8, 5);
      const fill = new THREE.DirectionalLight(0x7ec4c0, 0.35);
      fill.position.set(-5, -2, -4);
      scene.add(ambient, key, fill);

      const structureMat = track(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(colors.structure),
          metalness: 0.72,
          roughness: 0.38,
          transparent: true,
          opacity: 0.55,
        }),
      );
      const structureDimMat = track(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(colors.structureDim),
          metalness: 0.55,
          roughness: 0.5,
          transparent: true,
          opacity: 0.4,
        }),
      );
      const ringMatA = track(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(colors.structure),
          metalness: 0.6,
          roughness: 0.42,
          transparent: true,
          opacity: 0.28,
          side: THREE.DoubleSide,
        }),
      );
      const ringMatB = track(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(colors.structureDim),
          metalness: 0.6,
          roughness: 0.42,
          transparent: true,
          opacity: 0.28,
          side: THREE.DoubleSide,
        }),
      );

      // Central engineering spine — length 900 m.
      const spineGeo = track(
        new THREE.CylinderGeometry(SPINE_RADIUS, SPINE_RADIUS, SHIP_LENGTH, 24),
      );
      const spine = new THREE.Mesh(spineGeo, structureMat);
      spine.rotation.z = Math.PI / 2;
      shipGroup.add(spine);

      // Forward debris / radiation shield.
      const shieldGeo = track(new THREE.CylinderGeometry(0.95, 0.35, 1.1, 20));
      const shield = new THREE.Mesh(shieldGeo, structureDimMat);
      shield.rotation.z = Math.PI / 2;
      shield.position.x = SHIELD_X;
      shipGroup.add(shield);

      const shieldCapGeo = track(new THREE.SphereGeometry(0.95, 20, 12, 0, Math.PI));
      const shieldCap = new THREE.Mesh(shieldCapGeo, structureDimMat);
      shieldCap.rotation.z = -Math.PI / 2;
      shieldCap.position.x = SHIELD_X + 0.55;
      shipGroup.add(shieldCap);

      // Aft fusion propulsion cluster.
      for (const [offsetY, offsetZ, scale] of [
        [0, 0, 1],
        [0.38, 0.22, 0.72],
        [0.38, -0.22, 0.72],
        [-0.38, 0.22, 0.72],
        [-0.38, -0.22, 0.72],
      ] as const) {
        const nozzleGeo = track(
          new THREE.CylinderGeometry(0.18 * scale, 0.32 * scale, 1.35 * scale, 14),
        );
        const nozzle = new THREE.Mesh(nozzleGeo, structureMat);
        nozzle.rotation.z = Math.PI / 2;
        nozzle.position.set(ENGINE_X, offsetY, offsetZ);
        shipGroup.add(nozzle);
      }

      // Counter-rotating habitat rings — mean radius 224 m.
      const torusA = track(
        new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 14, 72),
      );
      const ringA = new THREE.Mesh(torusA, ringMatA);
      ringA.rotation.y = Math.PI / 2;
      ringA.position.x = RING_A_X;
      shipGroup.add(ringA);

      const torusB = track(
        new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 14, 72),
      );
      const ringB = new THREE.Mesh(torusB, ringMatB);
      ringB.rotation.y = Math.PI / 2;
      ringB.position.x = RING_B_X;
      shipGroup.add(ringB);

      // Spoke hints toward access zones (not pressure zones themselves).
      for (const x of [RING_A_X, RING_B_X]) {
        const spokeGeo = track(
          new THREE.CylinderGeometry(0.04, 0.04, RING_RADIUS * 0.92, 8),
        );
        const spoke = new THREE.Mesh(spokeGeo, structureDimMat);
        spoke.position.set(x, -RING_RADIUS * 0.46, 0);
        shipGroup.add(spoke);
      }

      // Envelope reference (max diameter 480 m) — faint ghost torus at max radius.
      const envelopeGeo = track(
        new THREE.TorusGeometry(MAX_RADIUS, 0.02, 6, 64),
      );
      const envelope = new THREE.Mesh(
        envelopeGeo,
        track(
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(colors.structureDim),
            transparent: true,
            opacity: 0.12,
          }),
        ),
      );
      envelope.rotation.y = Math.PI / 2;
      envelope.position.x = 0;
      shipGroup.add(envelope);

      const markerGeo = track(new THREE.BoxGeometry(0.16, 0.22, 0.28));

      for (const zone of zonesRef.current) {
        const material = track(
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(conditionColor(colors, zone.condition)),
            metalness: 0.2,
            roughness: 0.55,
            transparent: true,
            opacity: zone.condition === "offline" ? 0.35 : 0.92,
          }),
        );
        const mesh = new THREE.Mesh(markerGeo, material);
        const angle = zoneAngle(zone.zoneId);
        // access roles sit slightly inward (spoke/hub side).
        const radius =
          zone.role === "access" ? RING_RADIUS * 0.82 : RING_RADIUS;
        mesh.position.set(
          ringX(zone.ring),
          Math.sin(angle) * radius,
          Math.cos(angle) * radius,
        );
        mesh.lookAt(ringX(zone.ring), 0, 0);
        mesh.userData.zoneId = zone.zoneId;
        zoneMeshes.set(zone.zoneId, mesh);
        shipGroup.add(mesh);
      }

      motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      allowSpin = !motionQuery.matches;
      motionQuery.addEventListener("change", onMotionChange);

      resizeObserver = new ResizeObserver(() => setSize());
      resizeObserver.observe(host);
      setSize();

      host.addEventListener("pointermove", onPointerMove);
      host.addEventListener("pointerleave", onPointerLeave);
      host.addEventListener("click", onClick);

      const clock = new THREE.Clock();
      const animate = () => {
        if (disposed || !renderer || !scene || !camera || !shipGroup) return;
        raf = requestAnimationFrame(animate);
        const elapsed = clock.getElapsedTime();
        if (allowSpin) {
          shipGroup.rotation.y = elapsed * 0.12;
        }
        syncZoneMaterials(colors, elapsed);
        renderer.render(scene, camera);
      };
      animate();
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
      host.removeEventListener("click", onClick);
      motionQuery?.removeEventListener("change", onMotionChange);
      resizeObserver?.disconnect();

      zoneMeshes.clear();

      if (shipGroup && scene) {
        scene.remove(shipGroup);
      }

      for (const item of disposables) {
        item.dispose();
      }
      disposables.length = 0;

      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
        const canvas = renderer.domElement;
        canvas.parentElement?.removeChild(canvas);
      }

      scene = null;
      camera = null;
      shipGroup = null;
      renderer = null;
      raycaster = null;
      THREE = null;
      setHover(null);
    };
  }, []);

  const overlayStyle: CSSProperties | undefined = hover
    ? { left: hover.left, top: hover.top }
    : undefined;

  const hoverZone =
    hover &&
    (zones.find((z) => z.zoneId === hover.zone.zoneId) ?? hover.zone);

  const ringZonesA = zones.filter((z) => z.ring === "A");
  const ringZonesB = zones.filter((z) => z.ring === "B");

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.stage} aria-label="舰体剖视三维模型">
        <div className={styles.canvasHost} ref={hostRef} />
        {webglFailed && (
          <div className={styles.fallback}>
            <span className="offline-mark">WebGL 不可用 · 舰体剖视未联机</span>
          </div>
        )}
        <div className={styles.chrome} aria-hidden="true">
          <i className={styles.chromeCorner} />
          <i className={styles.chromeCorner} />
          <i className={styles.chromeCorner} />
          <i className={styles.chromeCorner} />
          <span className={styles.scaleHint}>
            L {SHIP_LENGTH_M} m · Ø {MAX_DIAMETER_M} m · R {RING_RADIUS_M} m
          </span>
        </div>
        {hoverZone && overlayStyle && (
          <div className={styles.overlay} style={overlayStyle} role="status">
            <div className={styles.overlayHead}>
              <strong>{hoverZone.labelZh || hoverZone.zoneId}</strong>
              <span>{hoverZone.zoneId}</span>
            </div>
            <p className={styles.overlayPurpose}>
              {hoverZone.purposeZh || roleLabel(hoverZone.role)}
            </p>
            <dl className={styles.overlayMeta}>
              <dt>环</dt>
              <dd>{hoverZone.ring}</dd>
              <dt>状态</dt>
              <dd>
                {hoverZone.hasBreach ? (
                  <span className={styles.breachTag}>破口</span>
                ) : (
                  conditionLabel(hoverZone.condition)
                )}
              </dd>
              <dt>压力</dt>
              <dd>{formatPa(hoverZone.observed.pressurePa)}</dd>
              <dt>温度</dt>
              <dd>{formatTemp(hoverZone.observed.temperatureK)}</dd>
              <dt>O₂</dt>
              <dd>{formatPa(hoverZone.observed.oxygenPartialPressurePa)}</dd>
              <dt>CO₂</dt>
              <dd>
                {formatPa(hoverZone.observed.carbonDioxidePartialPressurePa)}
              </dd>
            </dl>
          </div>
        )}
      </div>

      <div className={styles.zoneList} aria-label="压力区键盘列表">
        <span className={styles.ringLabel}>A</span>
        <div className={styles.ringButtons}>
          {ringZonesA.map((zone) => (
            <ZoneListButton
              key={zone.zoneId}
              zone={zone}
              selected={selectedZoneId === zone.zoneId}
              onSelect={onSelectZone}
            />
          ))}
        </div>
        <span className={styles.ringLabel}>B</span>
        <div className={styles.ringButtons}>
          {ringZonesB.map((zone) => (
            <ZoneListButton
              key={zone.zoneId}
              zone={zone}
              selected={selectedZoneId === zone.zoneId}
              onSelect={onSelectZone}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ZoneListButton({
  zone,
  selected,
  onSelect,
}: {
  zone: ZoneTelemetry;
  selected: boolean;
  onSelect: (zoneId: string) => void;
}) {
  const conditionClass =
    zone.condition === "critical"
      ? styles.zoneButtonCritical
      : zone.condition === "watch"
        ? styles.zoneButtonWatch
        : zone.condition === "offline"
          ? styles.zoneButtonOffline
          : "";

  const handlePointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.focus();
  };

  return (
    <button
      type="button"
      className={[
        styles.zoneButton,
        conditionClass,
        selected ? styles.zoneButtonSelected : "",
        zone.hasBreach ? styles.zoneButtonBreach : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-pressed={selected}
      aria-label={`${zone.labelZh} ${zone.zoneId}，${conditionLabel(zone.condition)}${
        zone.hasBreach ? "，有破口" : ""
      }`}
      title={`${zone.zoneId} · ${zone.labelZh}`}
      onClick={() => onSelect(zone.zoneId)}
      onPointerDown={handlePointer}
    >
      {zone.zoneId.replace(/^[AB]-/, "")}
    </button>
  );
}
