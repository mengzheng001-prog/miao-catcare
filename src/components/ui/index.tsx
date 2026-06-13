import React from "react";
import { cn } from "../../lib/utils";

export const Card = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("rounded-xl border border-slate-200 bg-white text-slate-950 shadow-sm", className)} {...props}>
    {children}
  </div>
);

export const CardHeader = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props}>
    {children}
  </div>
);

export const CardTitle = ({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn("text-lg font-semibold leading-none tracking-tight text-slate-900", className)} {...props}>
    {children}
  </h3>
);

export const CardContent = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("p-6 pt-0", className)} {...props}>
    {children}
  </div>
);

export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary', size?: 'default' | 'sm' | 'lg' }>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          {
            "bg-blue-600 text-white hover:bg-blue-700": variant === 'default',
            "border border-slate-200 bg-white hover:bg-slate-100 hover:text-slate-900": variant === 'outline',
            "hover:bg-slate-100 hover:text-slate-900": variant === 'ghost',
            "bg-red-500 text-slate-50 hover:bg-red-500/90": variant === 'destructive',
            "bg-slate-100 text-slate-700 hover:bg-slate-200": variant === 'secondary',
            "h-10 px-4 py-2": size === 'default',
            "h-9 rounded-md px-3": size === 'sm',
            "h-11 rounded-md px-8": size === 'lg',
          },
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export const Badge = ({ className, variant = 'default', ...props }: React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' }) => (
  <div className={cn(
    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2",
    {
      "border-transparent bg-slate-900 text-slate-50 hover:bg-slate-900/80": variant === 'default',
      "border-transparent bg-slate-100 text-slate-900 hover:bg-slate-100/80": variant === 'secondary',
      "border-transparent bg-red-100 text-red-700": variant === 'destructive',
      "border-transparent bg-green-100 text-green-700": variant === 'success',
      "border-transparent bg-amber-100 text-amber-700": variant === 'warning',
      "text-slate-950": variant === 'outline',
    },
    className
  )} {...props} />
);

export const Disclaimer = () => (
  <div className="mt-6 rounded-lg bg-slate-50 p-4 text-xs leading-relaxed text-slate-500 border border-slate-100 italic">
    * 免责声明：本产品仅用于猫咪健康档案整理、报告趋势追踪和复诊沟通辅助，不能替代兽医诊断、处方或治疗建议。如猫咪出现呼吸困难、无法排尿、持续呕吐、抽搐、严重精神沉郁等情况，请立即联系兽医或前往医院。
  </div>
);
