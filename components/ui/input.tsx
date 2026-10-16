import * as React from 'react';
import { Input as InputPrimitive } from '@base-ui/react/input';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const inputVariants = cva(
    'w-full min-w-0 rounded-md border transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs/relaxed file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
    {
        variants: {
            size: {
                default:
                    'h-7 border-input bg-input/20 px-2 py-0.5 text-sm md:text-xs/relaxed dark:bg-input/30',
                // The roomier field of the design: sunk into the background rather than raised above it.
                lg: 'h-10 border-transparent bg-background px-3 text-xs/relaxed shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]',
            },
        },
        defaultVariants: {
            size: 'default',
        },
    },
);

/** `size` shadows the native attribute, which sets a width in characters and is of no use here. */
function Input({
    className,
    type,
    size,
    ...props
}: Omit<React.ComponentProps<'input'>, 'size'> & VariantProps<typeof inputVariants>) {
    return (
        <InputPrimitive
            type={type}
            data-slot="input"
            className={cn(inputVariants({ size }), className)}
            {...props}
        />
    );
}

export { Input, inputVariants };
