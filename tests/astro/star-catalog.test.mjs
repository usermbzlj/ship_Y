import assert from "node:assert/strict";
import test from "node:test";

import {
  STAR_CATALOG,
  estimateMinLegs,
  findStarCatalogEntry,
  preferCatalogRouteDistanceLy,
  routeDistanceLy,
} from "../../lib/astro/star-catalog.ts";

test("each star |r| matches distanceFromSolLy within 0.05 ly", () => {
  for (const entry of STAR_CATALOG) {
    const { xLy, yLy, zLy } = entry.position;
    const radius = Math.hypot(xLy, yLy, zLy);
    assert.ok(
      Math.abs(radius - entry.distanceFromSolLy) < 0.05,
      `${entry.id}: |r|=${radius} vs distanceFromSolLy=${entry.distanceFromSolLy}`,
    );
  }
});

test("Sol → Tau Ceti ≈ 11.9 ly", () => {
  const distance = routeDistanceLy("sol", "tau-ceti");
  assert.ok(Math.abs(distance - 11.9) < 0.05, `got ${distance}`);
});

test("Barnard → Tau Ceti exceeds naive |dSol| subtract", () => {
  const barnard = STAR_CATALOG.find((entry) => entry.id === "barnard");
  const tau = STAR_CATALOG.find((entry) => entry.id === "tau-ceti");
  assert.ok(barnard && tau);
  const naive = Math.abs(tau.distanceFromSolLy - barnard.distanceFromSolLy);
  const honest = routeDistanceLy("barnard", "tau-ceti");
  assert.ok(
    honest > naive,
    `honest ${honest} should exceed naive ${naive}`,
  );
});

test("estimateMinLegs(11.9) === 3 under 5 ly max leg", () => {
  assert.equal(estimateMinLegs(11.9), 3);
  assert.equal(estimateMinLegs(5), 1);
  assert.equal(estimateMinLegs(5.01), 2);
});

test("aliases resolve Tau Ceti and free-text miss returns null", () => {
  assert.equal(findStarCatalogEntry("天仓五")?.id, "tau-ceti");
  assert.equal(findStarCatalogEntry("鲸鱼座 τ")?.id, "tau-ceti");
  assert.equal(
    preferCatalogRouteDistanceLy("巴纳德星", "天仓五"),
    routeDistanceLy("barnard", "tau-ceti"),
  );
  assert.equal(
    preferCatalogRouteDistanceLy("太阳系", "未知星云前哨"),
    null,
  );
});
