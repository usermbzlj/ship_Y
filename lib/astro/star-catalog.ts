/**
 * 轻量日心星表：用三维光年坐标做航路欧氏距离，避免 |dSol_a − dSol_b| 假航程。
 * 方位取自赤道坐标近似换算，精度服务于游戏一致性而非精密星历。
 */

export const MAX_JUMP_LEG_LY = 5;

export type StarPositionLy = {
  xLy: number;
  yLy: number;
  zLy: number;
};

export type StarCatalogEntry = {
  id: string;
  nameZh: string;
  portZh: string;
  distanceFromSolLy: number;
  position: StarPositionLy;
  /** 舰桥星图装饰用百分比坐标，非物理量 */
  mapX: number;
  mapY: number;
  aliases: readonly string[];
};

/**
 * 赤道近似：x = d cosδ cosα，y = d cosδ sinα，z = d sinδ（ly）。
 * Sol 原点；其余 |r| 与 distanceFromSolLy 对齐到 0.05 ly 以内。
 */
export const STAR_CATALOG: readonly StarCatalogEntry[] = [
  {
    id: "sol",
    nameZh: "太阳系",
    portZh: "拉格朗日港",
    distanceFromSolLy: 0,
    position: { xLy: 0, yLy: 0, zLy: 0 },
    mapX: 14,
    mapY: 68,
    aliases: ["Sol", "太阳", "地球", "Terra"],
  },
  {
    id: "barnard",
    nameZh: "巴纳德星",
    portZh: "赫尔墨斯中继站",
    distanceFromSolLy: 5.96,
    position: { xLy: -0.0568, yLy: -5.9397, zLy: 0.4876 },
    mapX: 29,
    mapY: 45,
    aliases: ["Barnard's Star", "Barnard", "巴纳德"],
  },
  {
    id: "wolf359",
    nameZh: "沃尔夫 359",
    portZh: "远望补给环",
    distanceFromSolLy: 7.86,
    position: { xLy: -7.5036, yLy: 2.1345, zLy: 0.9586 },
    mapX: 43,
    mapY: 72,
    aliases: ["Wolf 359", "Wolf359", "沃尔夫359"],
  },
  {
    id: "sirius",
    nameZh: "天狼星",
    portZh: "晨星自治领",
    distanceFromSolLy: 8.6,
    position: { xLy: -1.6121, yLy: 8.0773, zLy: -2.4736 },
    mapX: 55,
    mapY: 34,
    aliases: ["Sirius", "Alpha Canis Majoris", "天狼"],
  },
  {
    id: "epsilon",
    nameZh: "波江座 ε",
    portZh: "阿斯特拉殖民地",
    distanceFromSolLy: 10.47,
    position: { xLy: 6.1818, yLy: 8.2733, zLy: -1.7205 },
    mapX: 72,
    mapY: 57,
    aliases: ["Epsilon Eridani", "ε Eridani", "Ran", "波江座ε"],
  },
  {
    id: "tau-ceti",
    nameZh: "鲸鱼座 τ",
    portZh: "新海岸",
    distanceFromSolLy: 11.9,
    position: { xLy: 10.2829, yLy: 5.0191, zLy: -3.2681 },
    mapX: 86,
    mapY: 29,
    aliases: ["Tau Ceti", "τ Ceti", "天仓五", "鲸鱼座τ"],
  },
] as const;

const catalogById = new Map(
  STAR_CATALOG.map((entry) => [entry.id, entry] as const),
);

function normalizeStarQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/** 按 id / 中文名 / 别名解析星表项；未命中返回 undefined。 */
export function findStarCatalogEntry(
  query: string,
): StarCatalogEntry | undefined {
  const trimmed = query.trim();
  if (!trimmed) return undefined;
  const byId = catalogById.get(trimmed);
  if (byId) return byId;
  const needle = normalizeStarQuery(trimmed);
  for (const entry of STAR_CATALOG) {
    if (normalizeStarQuery(entry.nameZh) === needle) return entry;
    if (normalizeStarQuery(entry.portZh) === needle) return entry;
    for (const alias of entry.aliases) {
      if (normalizeStarQuery(alias) === needle) return entry;
    }
  }
  return undefined;
}

export function starPositionLy(id: string): StarPositionLy {
  const entry = catalogById.get(id);
  if (!entry) {
    throw new RangeError(`unknown star catalog id: ${id}`);
  }
  return entry.position;
}

/** 两星欧氏航距（ly）。未知 id 抛错。 */
export function routeDistanceLy(
  originId: string,
  destinationId: string,
): number {
  const origin = catalogById.get(originId);
  const destination = catalogById.get(destinationId);
  if (!origin || !destination) {
    throw new RangeError(
      `unknown star catalog id: ${origin ? destinationId : originId}`,
    );
  }
  const a = origin.position;
  const b = destination.position;
  return Math.hypot(b.xLy - a.xLy, b.yLy - a.yLy, b.zLy - a.zLy);
}

/**
 * 目的地可解析到星表时，用日心欧氏距离覆盖 LLM 给出的假航程；
 * 任一侧未知则返回 null（保留自由文本目的地）。
 */
export function preferCatalogRouteDistanceLy(
  originQuery: string,
  destinationQuery: string,
): number | null {
  const origin = findStarCatalogEntry(originQuery);
  const destination = findStarCatalogEntry(destinationQuery);
  if (!origin || !destination || origin.id === destination.id) return null;
  return routeDistanceLy(origin.id, destination.id);
}

export function estimateMinLegs(
  distanceLy: number,
  maxLegLy = MAX_JUMP_LEG_LY,
): number {
  if (!Number.isFinite(distanceLy) || distanceLy <= 0) return 1;
  if (!Number.isFinite(maxLegLy) || maxLegLy <= 0) {
    throw new RangeError("maxLegLy must be positive and finite");
  }
  return Math.max(1, Math.ceil(distanceLy / maxLegLy));
}

/** UI 星表列表：由物理星表派生，保留装饰用 map 坐标。 */
export const STAR_SYSTEMS = STAR_CATALOG.map((entry) => ({
  id: entry.id,
  name: entry.nameZh,
  port: entry.portZh,
  x: entry.mapX,
  y: entry.mapY,
  distanceFromSolLy: entry.distanceFromSolLy,
}));
