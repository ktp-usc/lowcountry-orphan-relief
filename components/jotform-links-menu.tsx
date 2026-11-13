"use client";

import { ChevronDown, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SHEET_SOURCES } from "@/lib/sheets/sources";

export function JotformLinksMenu({ location }: { location: string }) {
    const sources = SHEET_SOURCES.filter(
        (source) => source.location === location,
    );

    const locationName =
        location === "MIDLANDS" ? "Midlands" : "Lowcountry";

    const sections = [
        { key: "forms", label: "Submit new data" },
        { key: "sheets", label: "Review & correct data" },
    ] as const;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" className="shrink-0">
                    Forms & Sheets
                    <ChevronDown aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-72">
                <div className="px-2 py-1.5 text-sm font-semibold">
                    {locationName}
                </div>

                {sections.map((section) => (
                    <div key={section.key}>
                        <div
                            role="separator"
                            className="my-1 h-px bg-border"
                        />

                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                            {section.label}
                        </div>

                        {sources.map((source) => {
                            const isForm = section.key === "forms";
                            const label =
                                source.sourceType === "INVENTORY"
                                    ? "Inventory"
                                    : "Referral";

                            const href = isForm
                                ? `https://form.jotform.com/${source.jotformFormId}`
                                : `https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/edit#gid=${source.tabId}`;

                            return (
                                <DropdownMenuItem
                                    key={source.key}
                                    asChild
                                    className="cursor-pointer"
                                >
                                    <a
                                        href={href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex w-full items-center justify-between gap-4"
                                    >
                                        {label} {isForm ? "form" : "sheet"}
                                        <ExternalLink
                                            aria-hidden="true"
                                            className="size-3.5 text-muted-foreground"
                                        />
                                        <span className="sr-only">
                      {" "}(opens in a new tab)
                    </span>
                                    </a>
                                </DropdownMenuItem>
                            );
                        })}
                    </div>
                ))}

            </DropdownMenuContent>
        </DropdownMenu>
    );
}