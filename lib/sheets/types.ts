import type { LocationValue, NormalizedInventoryResult, SourceTypeValue } from "../jotform/normalize-inventory.js";

// Local Sheet ingestion contract; reconcile its structure with KAN-30 when available.
export type ColumnReference = { readonly header: string } | { readonly index: number; readonly expectedHeader: string };

export type SheetRow = {
  readonly headers: readonly string[];
  readonly values: readonly string[];
  readonly rowNumber?: number;
};

export type SheetSource = {
  readonly key: string;
  readonly fileName: string;
  readonly jotformFormId: string;
  readonly location: LocationValue;
  readonly sourceType: SourceTypeValue;
  readonly submissionId: ColumnReference;
  readonly submissionDate: ColumnReference | null;
  readonly cancellation: {
    readonly column: ColumnReference;
    readonly cancelledValues: readonly string[];
    readonly activeValues?: readonly string[];
  } | null;
  readonly answers: Readonly<Record<string, ColumnReference>>;
};

export type NormalizedSheetRecord =
  | { kind: "active"; input: NormalizedInventoryResult }
  | { kind: "cancelled"; jotformFormId: string; jotformSubmissionId: string };
