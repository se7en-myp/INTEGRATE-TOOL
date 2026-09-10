import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const buttonVariants = cva('inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50', {
  variants: { variant: { default: 'bg-black text-white', outline: 'border border-gray-300' } }, defaultVariants: { variant: 'default' },
});
export function Button({ className, variant, asChild = false, ...props }: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, className }))} {...props} />;
}
