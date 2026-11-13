import { EXISTING_SELECT, type ExistingSubmission } from "../inventory/sync-submission.js";
import type { SheetSource, SyncDatabase } from "./types.js";

export async function loadExistingSubmissions(
  client: SyncDatabase,
  source: SheetSource,
  ids: string[],
): Promise<Map<string, ExistingSubmission>> {
  if (!client.sourceSubmission) throw new Error("Submission batch lookup is unavailable.");
  const rows = await client.sourceSubmission.findMany({
    where: { jotformFormId: source.jotformFormId, jotformSubmissionId: { in: ids } },
    select: { ...EXISTING_SELECT, jotformSubmissionId: true },
  });
  return new Map(rows.map((row) => [row.jotformSubmissionId, row]));
}
