import type {
  InventoryDirection,
  Location,
  SourceType,
} from "../../generated/prisma/enums.js";
import type {
  NormalizedSheetRecord,
  SyncDatabase,
  SyncSubmissionResult,
} from "../sheets/types.js";
import type { SubmissionSaveInput } from "./save-submission.js";

type SubmissionKey = {
  jotformFormId: string;
  jotformSubmissionId: string;
};

type ExistingSubmission = {
  id: number;
  location: Location;
  sourceType: SourceType;
  submissionDate: Date;
  inventoryActivities: Array<{
    quantity: number;
    direction: InventoryDirection;
    item: { code: string };
  }>;
};

type SyncTx = {
  item: {
    findMany(args: {
      where: { code: { in: string[] } };
      select: { id: true; code: true };
    }): Promise<Array<{ id: number; code: string }>>;
  };
  sourceSubmission: {
    findUnique(args: {
      where: { jotformFormId_jotformSubmissionId: SubmissionKey };
      select: object;
    }): Promise<ExistingSubmission | null>;
    create(args: { data: object; select: { id: true } }): Promise<{ id: number }>;
    update(args: {
      where: { jotformFormId_jotformSubmissionId: SubmissionKey };
      data: {
        location: Location;
        sourceType: SourceType;
        submissionDate: Date;
      };
      select: { id: true };
    }): Promise<{ id: number }>;
  };
  inventoryActivity: {
    deleteMany(args: { where: SubmissionKey }): Promise<{ count: number }>;
    createMany(args: {
      data: Array<
        SubmissionKey & {
          itemId: number;
          quantity: number;
          direction: InventoryDirection;
        }
      >;
    }): Promise<{ count: number }>;
  };
};

type ActivityValue = {
  code: string;
  quantity: number;
  direction: InventoryDirection;
};

const LOCATIONS: Location[] = ["LOWCOUNTRY", "MIDLANDS"];
const SOURCE_TYPES: SourceType[] = ["INVENTORY", "REFERRAL"];

// Same lookup shape everywhere so the cancel and active paths share it
const EXISTING_SELECT = {
  id: true,
  location: true,
  sourceType: true,
  submissionDate: true,
  inventoryActivities: {
    select: {
      quantity: true,
      direction: true,
      item: { select: { code: true } },
    },
  },
};

const result = (
  status: SyncSubmissionResult["status"],
): SyncSubmissionResult => ({ status });

function normalizeCode(code: string): string {
  return String(code ?? "").trim();
}

function buildKey(formId: string, submissionId: string): SubmissionKey {
  const jotformFormId = String(formId ?? "").trim();
  const jotformSubmissionId = String(submissionId ?? "").trim();
  if (!jotformFormId || !jotformSubmissionId) {
    throw new Error(
      "Submission must include jotformFormId and jotformSubmissionId.",
    );
  }
  return { jotformFormId, jotformSubmissionId };
}

// Checks everything before the database is touched.
function validateActive(input: SubmissionSaveInput): {
  key: SubmissionKey;
  activities: ActivityValue[];
} {
  const { submission } = input;
  const key = buildKey(submission.jotformFormId, submission.jotformSubmissionId);

  if (!LOCATIONS.includes(submission.location)) {
    throw new Error(`Invalid location: ${String(submission.location)}`);
  }
  if (!SOURCE_TYPES.includes(submission.sourceType)) {
    throw new Error(`Invalid source type: ${String(submission.sourceType)}`);
  }
  if (
    !(submission.submissionDate instanceof Date) ||
    Number.isNaN(submission.submissionDate.getTime())
  ) {
    throw new Error("Submission must include a valid submissionDate.");
  }

  const allowedDirections: InventoryDirection[] =
    submission.sourceType === "INVENTORY" ? ["IN", "OUT"] : ["OUT"];

  const activities = input.inventoryActivities.map((activity) => {
    const code = normalizeCode(activity.itemCode);
    if (!code) {
      throw new Error("Activity itemCode is required.");
    }
    if (!Number.isInteger(activity.quantity) || activity.quantity <= 0) {
      throw new Error(
        `Invalid quantity for item ${code}: ${String(activity.quantity)}`,
      );
    }
    if (!allowedDirections.includes(activity.direction)) {
      throw new Error(
        `Direction ${activity.direction} does not match source type ${submission.sourceType}.`,
      );
    }
    return { code, quantity: activity.quantity, direction: activity.direction };
  });

  return { key, activities };
}

// Item code + quantity + direction, sorted, so order and IDs don't matter.
function signature(activities: ActivityValue[]): string {
  return activities
    .map((a) => JSON.stringify([a.code, a.quantity, a.direction]))
    .sort()
    .join("\n");
}

async function syncCancelled(
  client: SyncDatabase,
  key: SubmissionKey,
): Promise<SyncSubmissionResult> {
  return client.$transaction(async (tx) => {
    const db = tx as unknown as SyncTx;

    const existing = await db.sourceSubmission.findUnique({
      where: { jotformFormId_jotformSubmissionId: key },
      select: EXISTING_SELECT,
    });

    // Never imported: create nothing. Imported: keep the SourceSubmission,
    // remove only its activities.
    if (existing) {
      await db.inventoryActivity.deleteMany({ where: key });
    }

    return result("cancelled");
  });
}

export async function syncSubmission(
  client: SyncDatabase,
  record: NormalizedSheetRecord,
): Promise<SyncSubmissionResult> {
  if (record.kind === "cancelled") {
    const key = buildKey(record.jotformFormId, record.jotformSubmissionId);
    return syncCancelled(client, key);
  }

  const { submission } = record.input;
  const { key, activities } = validateActive(record.input);

  return client.$transaction(async (tx) => {
    const db = tx as unknown as SyncTx;

    const existing = await db.sourceSubmission.findUnique({
      where: { jotformFormId_jotformSubmissionId: key },
      select: EXISTING_SELECT,
    });

    // Resolve every item code before writing anything
    const codes = Array.from(new Set(activities.map((a) => a.code)));
    const items =
      codes.length > 0
        ? await db.item.findMany({
            where: { code: { in: codes } },
            select: { id: true, code: true },
          })
        : [];
    const itemIdByCode = new Map(items.map((item) => [item.code, item.id]));
    const missingCodes = codes.filter((code) => !itemIdByCode.has(code));
    if (missingCodes.length > 0) {
      throw new Error(
        `No Item rows found for codes: ${missingCodes.sort().join(", ")}. Submission was not saved.`,
      );
    }

    const rows = activities.map((a) => ({
      itemId: itemIdByCode.get(a.code)!,
      quantity: a.quantity,
      direction: a.direction,
    }));

    // New and active
    if (!existing) {
      await db.sourceSubmission.create({
        data: {
          ...key,
          location: submission.location,
          sourceType: submission.sourceType,
          submissionDate: submission.submissionDate,
          inventoryActivities: { create: rows },
        },
        select: { id: true },
      });
      return result("created");
    }

    // Compare real values, not IDs or order
    const metadataChanged =
      existing.location !== submission.location ||
      existing.sourceType !== submission.sourceType ||
      existing.submissionDate.getTime() !== submission.submissionDate.getTime();

    const existingActivities: ActivityValue[] = existing.inventoryActivities.map(
      (a) => ({
        code: a.item.code,
        quantity: a.quantity,
        direction: a.direction,
      }),
    );
    const activitiesChanged =
      signature(existingActivities) !== signature(activities);

    if (!metadataChanged && !activitiesChanged) {
      return result("unchanged");
    }

    // Changed (or restored after a cancellation): replace the activities
    await db.sourceSubmission.update({
      where: { jotformFormId_jotformSubmissionId: key },
      data: {
        location: submission.location,
        sourceType: submission.sourceType,
        submissionDate: submission.submissionDate,
      },
      select: { id: true },
    });
    await db.inventoryActivity.deleteMany({ where: key });
    if (rows.length > 0) {
      await db.inventoryActivity.createMany({
        data: rows.map((row) => ({ ...key, ...row })),
      });
    }
    return result("updated");
  });
}