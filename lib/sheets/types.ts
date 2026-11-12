import type { PrismaClient } from "../../generated/prisma/client.js";
import type { SubmissionSaveInput } from "../inventory/save-submission.js";

export type SheetSource = {
  key: string;
  spreadsheetId: string;
  tabId: number;
  jotformFormId: string;
  location: "LOWCOUNTRY" | "MIDLANDS";
  sourceType: "INVENTORY" | "REFERRAL";
  submissionIdHeader: string;
  submissionDateHeader: string;
};

export type SheetRow = {
  rowNumber: number;
  values: Record<string, string>;
  cancelled: boolean;
};

export type ReadSheetOptions = {
  limit?: number;
};

export type ReadSheetResult = {
  sourceKey: string;
  rows: SheetRow[];
};

export type NormalizedSheetRecord =
  | {
      kind: "active";
      input: SubmissionSaveInput;
    }
  | {
      kind: "cancelled";
      jotformFormId: string;
      jotformSubmissionId: string;
    };

export type SyncDatabase = Pick<PrismaClient, "$transaction">;

export type SyncSubmissionResult = {
  status: "created" | "updated" | "unchanged" | "cancelled";
};

export type SyncSheetsOptions = {
  limitPerSource?: number;
};
export type SyncSheetsSummary = {
  created: number;
  updated: number;
  unchanged: number;
  cancelled: number;
  failed: number;
  sourceErrors: {
    sourceKey: string;
    message: string;
  }[];
  rowErrors: {
    sourceKey: string;
    rowNumber: number;
    submissionId?: string;
    message: string;
  }[];
};
