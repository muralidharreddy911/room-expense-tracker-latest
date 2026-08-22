import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useApp } from "@/hooks/use-app-store";

interface SummaryStats {
  userId: string;
  roomCleaning: number;
  vesselCleaning: number;
  total: number;
}

export function AttendanceSummary() {
  const { cleaningAttendance, users, availableMonths } = useApp();

  // Use most recent month by default
  const defaultMonth = availableMonths.length > 0 ? availableMonths[0] : format(new Date(), "yyyy-MM");
  const [selectedMonth, setSelectedMonth] = React.useState<string>(defaultMonth);

  // Calculate summary stats
  const summary = useMemo(() => {
    const stats: Record<string, SummaryStats> = {};

    // Initialize all users
    users.forEach(user => {
      stats[user.id] = {
        userId: user.id,
        roomCleaning: 0,
        vesselCleaning: 0,
        total: 0,
      };
    });

    // Count approved and completed records
    cleaningAttendance
      .filter(a => a.month === selectedMonth && (a.status === "approved" || a.status === "completed"))
      .forEach(a => {
        if (stats[a.userId]) {
          if (a.cleaningType === "room_cleaning") {
            stats[a.userId].roomCleaning += 1;
          } else if (a.cleaningType === "vessel_cleaning") {
            stats[a.userId].vesselCleaning += 1;
          }
          stats[a.userId].total += 1;
        }
      });

    return Object.values(stats)
      .filter(s => s.total > 0) // Only show users with attendance
      .sort((a, b) => b.total - a.total); // Sort by total descending
  }, [cleaningAttendance, selectedMonth, users]);

  // Get user info
  const getUserInfo = (userId: string) => users.find(u => u.id === userId);

  return (
    <div className="space-y-6">
      {/* Month Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Month Selection</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs">
            <Label className="text-sm font-medium mb-2 block">Month</Label>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableMonths.map(month => (
                  <SelectItem key={month} value={month}>
                    {format(parseISO(`${month}-01`), "MMMM yyyy")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Summary Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Monthly Summary - {format(parseISO(`${selectedMonth}-01`), "MMMM yyyy")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summary.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No approved cleaning attendance records for {format(parseISO(`${selectedMonth}-01`), "MMMM yyyy")}
            </div>
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead className="text-right">Room Cleaning</TableHead>
                    <TableHead className="text-right">Vessel Cleaning</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map(stat => {
                    const user = getUserInfo(stat.userId);
                    return (
                      <TableRow key={stat.userId}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={user?.avatar} />
                              <AvatarFallback>{user?.name.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <span className="font-medium">{user?.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary">{stat.roomCleaning}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary">{stat.vesselCleaning}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="default" className="bg-primary">
                            {stat.total}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import React from "react";
