import type { PrismaClient } from "../../generated/prisma/client.js";
import type {
  InventoryDirection,
  Location,
  SourceType,
} from "../../generated/prisma/enums.js";

export type SubmissionActivityInput = {
  itemCode: string;
  quantity: number;
  direction: InventoryDirection;
};

export type SubmissionRecordInput = {
  jotformFormId: string;
  jotformSubmissionId: string;
  location: Location;
  sourceType: SourceType;
  submissionDate: Date;
};

export type SubmissionSaveInput = {
  submission: SubmissionRecordInput;
  inventoryActivities: SubmissionActivityInput[];
};

export type SubmissionSaveResult =
  | { status: "skipped"; reason: "existing-submission" }
  | {
      status: "saved";
      sourceSubmissionId: number;
      savedActivityCount: number;
    };

type SaveSubmissionClient = Pick<PrismaClient, "$transaction">;

type SaveSubmissionTx = {
  item: {
    findMany(args: {
      where: { code: { in: string[] } };
      select: { id: true; code: true };
    }): Promise<Array<{ id: number; code: string }>>;
  };
  sourceSubmission: {
    findUnique(args: {
      where: {
        jotformFormId_jotformSubmissionId: {
          jotformFormId: string;
          jotformSubmissionId: string;
        };
      };
      select: { id: true };
    }): Promise<{ id: number } | null>;
    create(args: {
      data: {
        jotformFormId: string;
        jotformSubmissionId: string;
        location: Location;
        sourceType: SourceType;
        submissionDate: Date;
        inventoryActivities: {
          create: Array<{
            itemId: number;
            quantity: number;
            direction: InventoryDirection;
          }>;
        };
      };
      select: { id: true };
    }): Promise<{ id: number }>;
  };
};

function normalizeCode(code: string): string {
  return String(code ?? "").trim();
}

function validateInput(input: SubmissionSaveInput) {
  const formId = String(input.submission.jotformFormId ?? "").trim();
  const submissionId = String(input.submission.jotformSubmissionId ?? "").trim();

  if (!formId || !submissionId) {
    throw new Error("Submission must include jotformFormId and jotformSubmissionId.");
  }

  const allowedDirections: InventoryDirection[] = input.submission.sourceType === "INVENTORY" ? ["IN", "OUT"] : ["OUT"];
  for (const activity of input.inventoryActivities) {
    const normalizedCode = normalizeCode(activity.itemCode);
    if (!normalizedCode) {
      throw new Error("Activity itemCode is required.");
    }
    if (!Number.isInteger(activity.quantity) || activity.quantity <= 0) {
      throw new Error(`Invalid quantity for item ${normalizedCode}: ${String(activity.quantity)}`);
    }
    if (!allowedDirections.includes(activity.direction)) {
      throw new Error(
        `Direction ${activity.direction} does not match source type ${input.submission.sourceType}.`,
      );
    }
  }
}

export async function saveSubmission(
  client: SaveSubmissionClient,
  input: SubmissionSaveInput,
): Promise<SubmissionSaveResult> {
  validateInput(input);

  const key = {
    jotformFormId: String(input.submission.jotformFormId).trim(),
    jotformSubmissionId: String(input.submission.jotformSubmissionId).trim(),
  };

  return client.$transaction(async (tx) => {
    const typedTx = tx as unknown as SaveSubmissionTx;

    const existing = await typedTx.sourceSubmission.findUnique({
      where: { jotformFormId_jotformSubmissionId: key },
      select: { id: true },
    });

    if (existing) {
      return { status: "skipped", reason: "existing-submission" };
    }

    const uniqueCodes = Array.from(
      new Set(input.inventoryActivities.map((activity) => normalizeCode(activity.itemCode))),
    );

    const items = await typedTx.item.findMany({
      where: { code: { in: uniqueCodes } },
      select: { id: true, code: true },
    });

    const itemIdByCode = new Map(items.map((item) => [item.code, item.id]));
    const missingCodes = uniqueCodes.filter((code) => !itemIdByCode.has(code));

    if (missingCodes.length > 0) {
      throw new Error(
        `No Item rows found for codes: ${missingCodes.sort().join(", ")}. Submission was not saved.`,
      );
    }

    const created = await typedTx.sourceSubmission.create({
      data: {
        jotformFormId: key.jotformFormId,
        jotformSubmissionId: key.jotformSubmissionId,
        location: input.submission.location,
        sourceType: input.submission.sourceType,
        submissionDate: input.submission.submissionDate,
        inventoryActivities: {
          create: input.inventoryActivities.map((activity) => ({
            itemId: itemIdByCode.get(normalizeCode(activity.itemCode))!,
            quantity: activity.quantity,
            direction: activity.direction,
          })),
        },
      },
      select: { id: true },
    });

    return {
      status: "saved",
      sourceSubmissionId: created.id,
      savedActivityCount: input.inventoryActivities.length,
    };
  });
}

