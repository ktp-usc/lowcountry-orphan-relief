"use client";
import { useState } from "react";
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
  "All Locations",
  "Low Country",
  "Midlands"
  
];

export function DashboardFilters() {
  const [selectedYear, setSelectedYear] = useState(String(currentYear));
  const [selectedLocation, setSelectedLocation] =
    useState("All Locations");

  return (
    <div className="flex flex-wrap items-end gap-4">
      {/* Year Filter */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground">
          Year
        </label>

        <Select
          value={selectedYear}
          onValueChange={setSelectedYear}
        >
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
        <label className="text-sm font-medium text-foreground">
          Location
        </label>

        <Select
          value={selectedLocation}
          onValueChange={setSelectedLocation}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Select location" />
          </SelectTrigger>

          <SelectContent>
            {locations.map((location) => (
              <SelectItem key={location} value={location}>
                {location}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}