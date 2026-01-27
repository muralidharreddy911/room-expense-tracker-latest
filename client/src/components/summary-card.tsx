import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SummaryCardProps {
  title: string;
  amount: number;
  icon?: React.ReactNode;
  description?: string;
  type?: "neutral" | "positive" | "negative";
  className?: string;
}

export function SummaryCard({ title, amount, icon, description, type = "neutral", className }: SummaryCardProps) {
  const isNegative = type === "negative" || (type === "neutral" && amount < 0);
  const isPositive = type === "positive" || (type === "neutral" && amount > 0);
  
  return (
    <Card className={cn("overflow-hidden border-l-4", 
      type === "neutral" && "border-l-primary",
      type === "positive" && "border-l-green-500",
      type === "negative" && "border-l-destructive",
      className
    )}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </CardTitle>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-bold font-display", 
           type === "negative" && "text-destructive",
           type === "positive" && "text-green-600"
        )}>
          ₹{Math.abs(amount).toFixed(2)}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">
            {description}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
