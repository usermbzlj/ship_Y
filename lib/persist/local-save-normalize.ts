/**

 * Normalize a loaded local-save payload to LocalSave v24.

 * Avoids importing app/ui/constants (path aliases break under node --test).

 */



import { STAR_SYSTEMS } from "../astro/star-catalog.ts";

import {

  createCaptainJournalSnapshot,

  validateCaptainJournalSnapshot,

  type CaptainJournalSnapshot,

} from "../llm/captain-journal.ts";

import {

  createCaptainWatchSnapshot,

  validateCaptainWatchSnapshot,

  type CaptainWatchSnapshot,

} from "../llm/captain-watch.ts";

import {

  createDepartmentStandingSnapshot,

  validateDepartmentStandingSnapshot,

  type DepartmentStandingSnapshot,

} from "../llm/department-standing.ts";

import {

  createDepartmentInboxSnapshot,

  validateDepartmentInboxSnapshot,

  type DepartmentInboxSnapshot,

} from "../llm/department-inbox.ts";

import {

  createPassengerSocietySnapshot,

  validatePassengerSocietySnapshot,

  type PassengerSocietySnapshot,

} from "../llm/passenger-society.ts";

import type { KeyPassengerPollingSnapshot } from "../llm/key-passenger-polling.ts";

import type { RuntimeSimulationSnapshot } from "../sim/protocol.ts";

import { verifyLocalSaveChecksum } from "./local-save-checksum.ts";



const KNOWN_VIEWS = new Set(["voyage", "ship", "people", "ai", "god"]);

const SUPPORTED_LOCAL_SAVE_VERSIONS = [19, 20, 21, 22, 23, 24] as const;



type ViewId = "voyage" | "ship" | "people" | "ai" | "god";



export type NormalizedLocalSave = {

  version: 24;

  activeView: ViewId;

  missionStarted: boolean;

  paused: boolean;

  timeScale: number;

  simulationSeconds: number;

  nextCaptainRoutineAtSimulationSeconds: number | null;

  origin: string;

  destination: string;

  directive: string;

  events: unknown[];

  keyPassengerLlm: KeyPassengerPollingSnapshot;

  captainJournal: CaptainJournalSnapshot;

  captainWatch: CaptainWatchSnapshot;

  departmentStanding: DepartmentStandingSnapshot;

  passengerSociety: PassengerSocietySnapshot;

  departmentInbox: DepartmentInboxSnapshot;

  runtimeSnapshot: RuntimeSimulationSnapshot | null;

  checksum?: string;

  slotId?: string;

};



export type NormalizeLocalSaveResult =

  | { ok: true; save: NormalizedLocalSave }

  | {

      ok: false;

      code: "v18-unsupported" | "unsupported-schema" | "checksum-mismatch";

    };



export async function normalizeLoadedLocalSave(

  raw: unknown,

  options: { captainRoutineSeconds: number },

): Promise<NormalizeLocalSaveResult> {

  if (raw === null || typeof raw !== "object") {

    return { ok: false, code: "unsupported-schema" };

  }



  const save = raw as {

    version?: unknown;

    activeView?: unknown;

    missionStarted?: unknown;

    paused?: unknown;

    timeScale?: unknown;

    simulationSeconds?: unknown;

    nextCaptainRoutineAtSimulationSeconds?: unknown;

    origin?: unknown;

    destination?: unknown;

    directive?: unknown;

    events?: unknown;

    keyPassengerLlm?: unknown;

    captainJournal?: unknown;

    captainWatch?: unknown;

    departmentStanding?: unknown;

    passengerSociety?: unknown;

    departmentInbox?: unknown;

    runtimeSnapshot?: unknown;

    checksum?: unknown;

    slotId?: unknown;

  };



  if (save.version === 18) {

    return { ok: false, code: "v18-unsupported" };

  }



  if (

    typeof save.checksum === "string" &&

    save.checksum.length > 0 &&

    !(await verifyLocalSaveChecksum(raw))

  ) {

    return { ok: false, code: "checksum-mismatch" };

  }



  const knownSystems = new Set(STAR_SYSTEMS.map((system) => system.id));



  if (

    typeof save.version !== "number" ||

    !(SUPPORTED_LOCAL_SAVE_VERSIONS as readonly number[]).includes(

      save.version,

    ) ||

    typeof save.activeView !== "string" ||

    !KNOWN_VIEWS.has(save.activeView) ||

    typeof save.origin !== "string" ||

    !knownSystems.has(save.origin) ||

    typeof save.destination !== "string" ||

    !knownSystems.has(save.destination) ||

    typeof save.directive !== "string" ||

    !Array.isArray(save.events) ||

    typeof save.simulationSeconds !== "number" ||

    !Number.isFinite(save.simulationSeconds) ||

    // A06修复:timeScale必须为正数
    typeof save.timeScale !== "number" ||

    !Number.isFinite(save.timeScale) ||

    save.timeScale <= 0 ||

    ("nextCaptainRoutineAtSimulationSeconds" in save &&

      save.nextCaptainRoutineAtSimulationSeconds !== null &&

      save.nextCaptainRoutineAtSimulationSeconds !== undefined &&

      (typeof save.nextCaptainRoutineAtSimulationSeconds !== "number" ||

        !Number.isFinite(save.nextCaptainRoutineAtSimulationSeconds))) ||

    (save.missionStarted === true && !save.runtimeSnapshot)

  ) {

    return { ok: false, code: "unsupported-schema" };

  }

  // A06修复:events数组不能含null或无效元素
  for (const event of save.events) {
    if (event === null || event === undefined || typeof event !== "object") {
      return { ok: false, code: "unsupported-schema" };
    }
    // 基本字段校验
    if (
      typeof event.id !== "number" ||
      typeof event.at !== "string" ||
      typeof event.source !== "string" ||
      typeof event.text !== "string"
    ) {
      return { ok: false, code: "unsupported-schema" };
    }
  }



  const simulationSeconds = save.simulationSeconds;

  const missionStarted = Boolean(save.missionStarted);

  const runtimeSnapshot =

    (save.runtimeSnapshot as RuntimeSimulationSnapshot | null) ?? null;



  // Runtime v19+ sidecars are authoritative when present.

  const runtimeHasSidecars =

    runtimeSnapshot !== null && runtimeSnapshot.snapshotVersion >= 19;



  const outerNextCaptain =

    "nextCaptainRoutineAtSimulationSeconds" in save &&

    typeof save.nextCaptainRoutineAtSimulationSeconds === "number"

      ? Math.max(

          simulationSeconds,

          save.nextCaptainRoutineAtSimulationSeconds,

        )

      : missionStarted

        ? simulationSeconds + options.captainRoutineSeconds

        : null;



  const runtimeNextCaptain =

    runtimeHasSidecars &&

    "nextCaptainRoutineAtSimulationSeconds" in runtimeSnapshot &&

    (runtimeSnapshot.nextCaptainRoutineAtSimulationSeconds === null ||

      typeof runtimeSnapshot.nextCaptainRoutineAtSimulationSeconds ===

        "number")

      ? runtimeSnapshot.nextCaptainRoutineAtSimulationSeconds === null

        ? null

        : Math.max(

            simulationSeconds,

            runtimeSnapshot.nextCaptainRoutineAtSimulationSeconds,

          )

      : null;



  const nextCaptainRoutineAtSimulationSeconds = runtimeHasSidecars

    ? (runtimeNextCaptain ?? outerNextCaptain)

    : outerNextCaptain;



  const captainJournal =

    (runtimeHasSidecars

      ? validateCaptainJournalSnapshot(runtimeSnapshot.captainJournal)

      : null) ??

    validateCaptainJournalSnapshot(save.captainJournal) ??

    createCaptainJournalSnapshot();



  const captainWatch =

    (runtimeHasSidecars

      ? validateCaptainWatchSnapshot(runtimeSnapshot.captainWatch)

      : null) ??

    validateCaptainWatchSnapshot(save.captainWatch) ??

    createCaptainWatchSnapshot();



  const departmentStanding =

    (runtimeHasSidecars

      ? validateDepartmentStandingSnapshot(

          runtimeSnapshot.departmentStanding,

        )

      : null) ??

    validateDepartmentStandingSnapshot(save.departmentStanding) ??

    createDepartmentStandingSnapshot();



  const runtimeHasSociety =

    runtimeSnapshot !== null && runtimeSnapshot.snapshotVersion >= 20;



  const passengerSociety =

    (runtimeHasSociety

      ? validatePassengerSocietySnapshot(runtimeSnapshot.passengerSociety)

      : null) ??

    validatePassengerSocietySnapshot(save.passengerSociety) ??

    createPassengerSocietySnapshot();



  const runtimeHasInbox =

    runtimeSnapshot !== null && runtimeSnapshot.snapshotVersion >= 21;



  const departmentInbox =

    (runtimeHasInbox

      ? validateDepartmentInboxSnapshot(runtimeSnapshot.departmentInbox)

      : null) ??

    validateDepartmentInboxSnapshot(save.departmentInbox) ??

    createDepartmentInboxSnapshot();



  const normalized: NormalizedLocalSave = {

    ...(raw as object),

    version: 24,

    activeView: save.activeView as ViewId,

    missionStarted,

    paused: Boolean(save.paused),

    timeScale: save.timeScale,

    simulationSeconds,

    nextCaptainRoutineAtSimulationSeconds,

    origin: save.origin,

    destination: save.destination,

    directive: save.directive,

    events: save.events,

    keyPassengerLlm: save.keyPassengerLlm as KeyPassengerPollingSnapshot,

    captainJournal,

    captainWatch,

    departmentStanding,

    passengerSociety,

    departmentInbox,

    runtimeSnapshot,

  };



  if (typeof save.checksum === "string" && save.checksum.length > 0) {

    normalized.checksum = save.checksum;

  }

  if (typeof save.slotId === "string" && save.slotId.length > 0) {

    normalized.slotId = save.slotId;

  }



  return {

    ok: true,

    save: normalized,

  };

}


