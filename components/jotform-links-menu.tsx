"use client";

import { ChevronDown, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Set these to the corresponding Jotform URLs.
const forms = [
    {
        label: "Lowcountry: Inventory Form",
        href: "https://form.jotform.com/241895593214161",
    },
    {
        label: "Midlands: Inventory Form",
        href: "https://form.jotform.com/250054265404145",
    },
    {
        label: "Lowcountry: Referral Form",
        href: "https://form.jotform.com/261498369429070",
    },
    {
        label: "Midlands: Referral Form",
        href: "https://form.jotform.com/261526295444158",
    },
];

export function JotformLinksMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="shrink-0">
          Jotform Forms
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {forms.map(({ label, href }) => (
          href ? (
            <DropdownMenuItem key={label} asChild>
              <a href={href} target="_blank" rel="noreferrer" className="flex w-full items-center justify-between gap-4">
                {label}
                <ExternalLink aria-hidden="true" className="size-3.5 text-muted-foreground" />
              </a>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={label} disabled>
              <span>{label}</span>
            </DropdownMenuItem>
          )
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
