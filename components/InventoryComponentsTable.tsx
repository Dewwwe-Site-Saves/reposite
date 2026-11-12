'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { COMPONENT_TYPE_LABELS } from '@/lib/format';
import type { ComponentUsage } from '@/lib/inventory';

const SELECT_CLASS =
    'h-7 rounded-md border border-input bg-input/20 px-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30 md:text-xs/relaxed';

/** The components of every site, filtered as one types. Under each component its installed versions, newest first, each with the sites that run it: a version older than the newest one seen stands out. */
export function InventoryComponentsTable({ components }: { components: ComponentUsage[] }) {
    const [search, setSearch] = useState('');
    const [type, setType] = useState('');

    const needle = search.trim().toLowerCase();
    const shown = components.filter(
        (component) =>
            (type === '' || component.type === type) &&
            (needle === '' ||
                component.name.toLowerCase().includes(needle) ||
                component.slug.toLowerCase().includes(needle)),
    );

    return (
        <>
            <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
                <Input
                    aria-label="Search a component"
                    placeholder="Search a plugin or a theme"
                    className="w-64"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <select
                    aria-label="Type"
                    className={SELECT_CLASS}
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                >
                    <option value="">All types</option>
                    {Object.entries(COMPONENT_TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    ))}
                </select>
                <span className="text-xs text-muted-foreground">
                    {shown.length} of {components.length}
                </span>
            </div>

            {shown.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                    No component matches.
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Component</TableHead>
                                <TableHead className="hidden sm:table-cell">Type</TableHead>
                                <TableHead>Sites</TableHead>
                                <TableHead>Versions installed</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {shown.map((component) => (
                                <TableRow
                                    key={`${component.type}:${component.slug}`}
                                    className="align-top"
                                >
                                    <TableCell>
                                        <p className="font-medium">{component.name}</p>
                                        <p className="font-mono text-xs text-muted-foreground">
                                            {component.slug}
                                        </p>
                                    </TableCell>
                                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                                        {typeLabel(component.type)}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {component.siteCount}
                                    </TableCell>
                                    <TableCell>
                                        <ul className="space-y-1">
                                            {component.versions.map(({ version, sites }, index) => (
                                                <li
                                                    key={version ?? 'none'}
                                                    className="flex flex-wrap items-baseline gap-x-2"
                                                >
                                                    <span
                                                        className={`font-mono text-xs ${
                                                            index > 0 && version !== null
                                                                ? 'text-warning'
                                                                : ''
                                                        }`}
                                                    >
                                                        {version ?? 'no version'}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {sites.map((site, position) => (
                                                            <span key={site.id}>
                                                                {position > 0 && ', '}
                                                                <Link
                                                                    href={`/sites/${site.id}/inventory`}
                                                                    className="hover:underline"
                                                                >
                                                                    {site.domain}
                                                                </Link>
                                                            </span>
                                                        ))}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </>
    );
}

/** Singular heading of a type, the raw value for one this build does not know. */
function typeLabel(type: string): string {
    const plural = (COMPONENT_TYPE_LABELS as Record<string, string>)[type];
    return plural ? plural.replace(/s$/, '') : type;
}
