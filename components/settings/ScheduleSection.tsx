'use client';

import { Layers01Icon, PackageIcon, Time04Icon } from '@hugeicons/core-free-icons';
import { Field } from '@/components/settings/Field';
import { FormError } from '@/components/settings/FormError';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { SummaryBar } from '@/components/settings/SummaryBar';
import { UnsavedBar } from '@/components/settings/UnsavedBar';
import { useSettingsSection } from '@/components/settings/useSettingsSection';
import type { CronSummary } from '@/lib/cron';
import type { SettingsView } from '@/lib/db';

/** `summary` and `inventorySummary` describe the schedules currently in effect, so they only move once the form is saved. */
export function ScheduleSection({
    settings,
    summary,
    inventorySummary,
}: {
    settings: SettingsView;
    summary: CronSummary;
    inventorySummary: CronSummary;
}) {
    const { form, update, dirty, saving, error, discard, submit } = useSettingsSection(settings);

    return (
        <form onSubmit={submit} className="flex flex-col gap-4">
            {error && <FormError message={error} />}

            <SettingsSection
                icon={Time04Icon}
                title="Backup schedule"
                description="When the sites without a schedule of their own are backed up, and how long their backups stay in the history."
            >
                <SummaryBar
                    items={[
                        { label: 'Rule', value: summary.rule },
                        { label: 'Next', value: summary.next ?? 'never' },
                    ]}
                />

                <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
                    <Field
                        id="defaultCron"
                        label="Cron expression"
                        className="font-mono"
                        required
                        value={form.defaultCron}
                        onChange={(e) => update('defaultCron', e.target.value)}
                    />
                    <Field
                        id="retentionDays"
                        label="Retention in days"
                        type="number"
                        min={1}
                        max={3650}
                        required
                        hint="The last 5 backups of each site are always kept."
                        value={form.retentionDays}
                        onChange={(e) => update('retentionDays', e.target.value)}
                    />
                </div>

                <CronHelp />
            </SettingsSection>

            <SettingsSection
                icon={PackageIcon}
                title="Inventory schedule"
                description="When the sites without an inventory schedule of their own have their CMS, plugin and theme versions read from the live site, and how long those runs stay in the history. Every backup reads them too, from the files it has just synced."
            >
                <SummaryBar
                    items={[
                        { label: 'Rule', value: inventorySummary.rule },
                        { label: 'Next', value: inventorySummary.next ?? 'never' },
                    ]}
                />

                <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
                    <Field
                        id="defaultInventoryCron"
                        label="Cron expression"
                        className="font-mono"
                        required
                        value={form.defaultInventoryCron}
                        onChange={(e) => update('defaultInventoryCron', e.target.value)}
                    />
                    <Field
                        id="inventoryRetentionDays"
                        label="Retention in days"
                        type="number"
                        min={1}
                        max={3650}
                        required
                        hint="The last 5 inventory runs of each site are always kept."
                        value={form.inventoryRetentionDays}
                        onChange={(e) => update('inventoryRetentionDays', e.target.value)}
                    />
                </div>
            </SettingsSection>

            <SettingsSection
                icon={Layers01Icon}
                title="Queue"
                description="How many jobs run at the same time, backups and inventories together. A site never has more than one job at once, whatever this number."
            >
                <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
                    <Field
                        id="concurrency"
                        label="Concurrent jobs"
                        type="number"
                        min={1}
                        max={5}
                        required
                        hint="1 to 5."
                        value={form.concurrency}
                        onChange={(e) => update('concurrency', e.target.value)}
                    />
                </div>
            </SettingsSection>

            {dirty && <UnsavedBar onDiscard={discard} saving={saving} />}
        </form>
    );
}

/** Both default expressions govern every site without a schedule of its own, so the syntax is worth explaining in place, once. */
function CronHelp() {
    return (
        <div className="space-y-1.5 rounded-md border border-border p-3 text-xs text-muted-foreground">
            <p>
                <span className="font-medium text-foreground">Reading a cron expression.</span> Five
                fields separated by spaces:{' '}
                <code className="text-foreground">minute hour day-of-month month day-of-week</code>{' '}
                (minute 0&ndash;59, hour 0&ndash;23, day 1&ndash;31, month 1&ndash;12, weekday
                0&ndash;6 from Sunday).
            </p>
            <p>
                <code className="text-foreground">*</code> is every value,{' '}
                <code className="text-foreground">1,15</code> a list,{' '}
                <code className="text-foreground">1-5</code> a range and{' '}
                <code className="text-foreground">*/6</code> every sixth.
            </p>
            <p>
                So <code className="text-foreground">0 2 1,15 * *</code> fires at 02:00 on the 1st
                and the 15th of every month, <code className="text-foreground">30 3 * * 1</code>{' '}
                every Monday at 03:30, and <code className="text-foreground">0 */6 * * *</code>{' '}
                every six hours. Times follow the container&apos;s <code>TZ</code>.
            </p>
        </div>
    );
}
