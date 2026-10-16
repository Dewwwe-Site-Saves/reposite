'use client';

import { Time04Icon } from '@hugeicons/core-free-icons';
import { Field } from '@/components/settings/Field';
import { FormError } from '@/components/settings/FormError';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { SummaryBar } from '@/components/settings/SummaryBar';
import { UnsavedBar } from '@/components/settings/UnsavedBar';
import { useSettingsSection } from '@/components/settings/useSettingsSection';
import type { CronSummary } from '@/lib/cron';
import type { SettingsView } from '@/lib/db';

/** `summary` describes the schedule currently in effect, so it only moves once the form is saved. */
export function ScheduleSection({
    settings,
    summary,
}: {
    settings: SettingsView;
    summary: CronSummary;
}) {
    const { form, update, dirty, saving, error, discard, submit } = useSettingsSection(settings);

    return (
        <form onSubmit={submit} className="flex flex-col gap-4">
            {error && <FormError message={error} />}

            <SettingsSection
                icon={Time04Icon}
                title="Schedule & Queue"
                description="When the sites without a schedule of their own are backed up, how many runs share the machine, and how long the history is kept."
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
                        id="concurrency"
                        label="Concurrent backups"
                        type="number"
                        min={1}
                        max={5}
                        required
                        hint="1 to 5."
                        value={form.concurrency}
                        onChange={(e) => update('concurrency', e.target.value)}
                    />
                    <Field
                        id="retentionDays"
                        label="Retention in days"
                        type="number"
                        min={1}
                        max={3650}
                        required
                        hint="The last 5 runs of each site are always kept."
                        value={form.retentionDays}
                        onChange={(e) => update('retentionDays', e.target.value)}
                    />
                </div>

                <CronHelp />
            </SettingsSection>

            {dirty && <UnsavedBar onDiscard={discard} saving={saving} />}
        </form>
    );
}

/** The expression governs every site without its own schedule, so it is worth explaining in place. */
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
