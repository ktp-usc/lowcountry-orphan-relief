import type { Metadata } from "next";
import "./globals.css";
import React from "react";

import { Providers } from "@/components/providers";

export const metadata: Metadata = {
    title: "Future KTP Web App",
    description: "KTP SP26"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <html lang="en">
        <body>
        <Providers>{ children }</Providers>
        </body>
        </html>
    );
}
