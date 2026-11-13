// Keep these catalogue records for imports/history; omit them from dashboard
// rows, totals, and the dashboard's count/valuation editors.
export const HIDDEN_DASHBOARD_ITEM_CODES = [
  "BABY_BLANKET",
  "CARE_KIT_LAUNDRY_BAGS",
];

export const dashboardItemWhere = {
  code: { notIn: HIDDEN_DASHBOARD_ITEM_CODES },
};
