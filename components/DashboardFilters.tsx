"use client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const currentYear = new Date().getFullYear();

const years = Array.from({ length: 5 }, (_, index) =>
  String(currentYear - index)
);

const locations = [
  { value: "LOWCOUNTRY", label: "Lowcountry" },
  { value: "MIDLANDS", label: "Midlands" },
];

const triggerClass =
    "h-10 data-[size=default]:h-10 rounded-[7px] border-border bg-card px-[11px] text-sm text-foreground shadow-none";

type DashboardFiltersProps = {
  selectedYear: string;
  selectedLocation: string;
  onYearChange: (year: string) => void;
  onLocationChange: (location: string) => void;
};

export function DashboardFilters({
  selectedYear,
  selectedLocation,
  onYearChange,
  onLocationChange,
}: DashboardFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-[11px]">
      {/* Year Filter */}
      <div className="flex items-center gap-2">
        <label className="whitespace-nowrap text-xs text-muted-foreground">
          Year
        </label>

        <Select value={selectedYear} onValueChange={onYearChange}>
          <SelectTrigger className={`w-[110px] ${triggerClass}`}>
            <SelectValue placeholder="Select year" />
          </SelectTrigger>

          <SelectContent>
            {years.map((year) => (
              <SelectItem key={year} value={year} className="text-sm">
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Location Filter */}
      <div className="flex items-center gap-2">
        <label className="whitespace-nowrap text-xs text-muted-foreground">
          Location
        </label>

        <Select value={selectedLocation} onValueChange={onLocationChange}>
          <SelectTrigger className={`w-[150px] ${triggerClass}`}>
            <SelectValue placeholder="Select location" />
          </SelectTrigger>

          <SelectContent>
            {locations.map((location) => (
              <SelectItem
                key={location.value}
                value={location.value}
                className="text-sm"
              >
                {location.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}