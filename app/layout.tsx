import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import "./globals.css";
import React from "react";

import { Providers } from "@/components/providers";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });

export const metadata: Metadata = {
    title: "Orphan Relief Inventory",
    description:
        "Inventory dashboard for Lowcountry and Midlands Orphan Relief.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <html lang="en" className={`${dmSans.variable} ${manrope.variable}`}>
        <body>
        <Providers>{ children }</Providers>
        </body>
        </html>
    );
}