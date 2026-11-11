/** Transactional fixture client for the real KAN-18 saving function. */
export function createImportDatabase(items) {
  let state = { sources: [], activities: [], nextId: 1 };
  return {
    snapshot: () => structuredClone(state),
    async $transaction(callback) {
      const working = structuredClone(state);
      const tx = {
        item: {
          findMany: async ({ where: { code: { in: codes } } }) => items.filter((item) => codes.includes(item.code)),
        },
        sourceSubmission: {
          findUnique: async ({ where: { jotformFormId_jotformSubmissionId: key } }) => {
            const match = working.sources.find((row) => row.jotformFormId === key.jotformFormId && row.jotformSubmissionId === key.jotformSubmissionId);
            return match ? { id: match.id } : null;
          },
          create: async ({ data }) => {
            if (working.sources.some((row) => row.jotformFormId === data.jotformFormId && row.jotformSubmissionId === data.jotformSubmissionId)) {
              throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
            }
            const { inventoryActivities, ...source } = data;
            const id = working.nextId++;
            working.sources.push({ ...source, id });
            for (const movement of inventoryActivities.create) {
              if (!items.some((item) => item.id === movement.itemId) || !Number.isInteger(movement.quantity) || movement.quantity <= 0) {
                throw new Error("Inventory constraint violation");
              }
              working.activities.push({ ...movement, jotformFormId: source.jotformFormId, jotformSubmissionId: source.jotformSubmissionId });
            }
            return { id };
          },
        },
      };
      const result = await callback(tx);
      state = working;
      return result;
    },
  };
}
