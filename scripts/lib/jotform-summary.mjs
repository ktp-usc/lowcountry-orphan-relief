/** @param {Array<{ created_at?: string | null }>} submissions */
export function formatSubmissionSummary(submissions) {
  if (submissions.length === 0) return "Submissions: 0\nDate range: none";

  let earliest;
  let latest;
  for (const { created_at: timestamp } of submissions) {
    // Jotform timestamps have no timezone offset. Compare their canonical
    // format directly rather than assigning the machine's local timezone.
    if (typeof timestamp !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp)) {
      return `Submissions: ${submissions.length}\nDate range: unavailable`;
    }
    if (earliest === undefined || timestamp < earliest) earliest = timestamp;
    if (latest === undefined || timestamp > latest) latest = timestamp;
  }
  return `Submissions: ${submissions.length}\nDate range: ${earliest} to ${latest}`;
}
