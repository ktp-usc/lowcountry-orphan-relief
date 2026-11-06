"use client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type DashboardLocation = "ALL" | "LOWCOUNTRY" | "MIDLANDS";

const currentYear = new Date().getFullYear();

const years = Array.from({ length: 5 }, (_, index) =>
  String(currentYear - index),
);

const locations = [
  { value: "ALL", label: "All Locations" },
  { value: "LOWCOUNTRY", label: "Low Country" },
  { value: "MIDLANDS", label: "Midlands" },
] as const;

type DashboardFiltersProps = {
  selectedYear: string;
  selectedLocation: DashboardLocation;
  onYearChange: (year: string) => void;
  onLocationChange: (location: DashboardLocation) => void;
};

export function DashboardFilters({
  selectedYear,
  selectedLocation,
  onYearChange,
  onLocationChange,
}: DashboardFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      {/* Year Filter */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground">Year</label>

        <Select value={selectedYear} onValueChange={onYearChange}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Select year" />
          </SelectTrigger>

          <SelectContent>
            {years.map((year) => (
              <SelectItem key={year} value={year}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Location Filter */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground">Location</label>

        <Select value={selectedLocation} onValueChange={onLocationChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Select location" />
          </SelectTrigger>

          <SelectContent>
            {locations.map((location) => (
              <SelectItem key={location.value} value={location.value}>
                {location.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}